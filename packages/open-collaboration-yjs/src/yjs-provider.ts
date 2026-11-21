// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as types from 'open-collaboration-protocol';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { ObservableV2 } from 'lib0/observable';

export interface AwarenessChange {
    added: number[];
    updated: number[];
    removed: number[];
}

export const LOCAL_ORIGIN = 'local';

export const DEFAULT_RESYNC_TIMER = 10_000;

export interface YjsProviderOptions {
    /**
     * Interval in milliseconds at which the provider asks its peers for updates it is missing.
     * This is how a peer recovers an update that never reached it. Defaults to {@link DEFAULT_RESYNC_TIMER};
     * `0` or a negative value disables it.
     */
    resyncTimer?: number;
    /**
     * Returns the peer id of the session's host, or `undefined` if this peer is the host or does not
     * know the host yet. It is read on every resync, so it may start returning an id later on.
     *
     * A peer that knows the host resyncs with the host alone, and the host resyncs with everyone, which
     * keeps the number of resync messages linear in the number of peers. A peer that does not know the
     * host asks everyone, which is quadratic once every peer does it.
     */
    getHostId?: () => string | undefined;
}

export class OpenCollaborationYjsProvider extends ObservableV2<string> {

    private connection: types.ProtocolBroadcastConnection;
    private doc: Y.Doc;
    private awareness: awarenessProtocol.Awareness;
    private applyingRemoteUpdate = false;
    private resyncInterval?: ReturnType<typeof setInterval>;
    private getHostId?: () => string | undefined;

    constructor(connection: types.ProtocolBroadcastConnection, doc: Y.Doc, awareness: awarenessProtocol.Awareness, options?: YjsProviderOptions) {
        super();
        this.connection = connection;
        this.doc = doc;
        this.awareness = awareness;
        this.getHostId = options?.getHostId;
        this.doc.on('update', this.yjsUpdateHandler.bind(this));
        this.awareness.on('update', this.yjsAwarenessUpdateHandler.bind(this));

        connection.sync.onDataUpdate(this.ocpDataUpdateHandler.bind(this));
        connection.sync.onAwarenessUpdate(this.ocpAwarenessUpdateHandler.bind(this));
        connection.sync.onAwarenessQuery(this.ocpAwarenessQueryHandler.bind(this));
        const resyncTimer = options?.resyncTimer ?? DEFAULT_RESYNC_TIMER;
        if (resyncTimer > 0) {
            this.setResyncInterval(resyncTimer);
        }
    }

    private setResyncInterval(timeout: number): void {
        this.resyncInterval = setInterval(() => {
            const encoder = encoding.createEncoder();
            syncProtocol.writeSyncStep1(encoder, this.doc);
            // The host receives every edit directly from its author and asks everyone for what it
            // is missing, so it is enough for a guest to ask the host.
            const hostId = this.getHostId?.();
            if (hostId) {
                this.connection.sync.dataUpdate(hostId, this.encode(encoder));
            } else {
                this.connection.sync.dataUpdate(this.encode(encoder));
            }
        }, timeout);
        this.doc.on('destroy', () => this.clearResyncInterval());
    }

    private clearResyncInterval(): void {
        clearInterval(this.resyncInterval);
        this.resyncInterval = undefined;
    }

    private ocpDataUpdateHandler(origin: string, update: types.Binary): void {
        const decoder = this.decode(update);
        const encoder = encoding.createEncoder();
        let syncMessageType: number;
        this.applyingRemoteUpdate = true;
        try {
            syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, origin);
        } finally {
            this.applyingRemoteUpdate = false;
        }
        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
            this.connection.sync.dataUpdate(origin, this.encode(encoder));
        }
    }

    private ocpAwarenessUpdateHandler(origin: string, update: types.Binary): void {
        const decoder = this.decode(update);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), origin);
    }

    private ocpAwarenessQueryHandler(origin: string): void {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(this.awareness.getStates().keys()))
        );
        this.connection.sync.awarenessUpdate(origin, this.encode(encoder));
    }

    private yjsUpdateHandler(update: Uint8Array, origin: unknown, _doc: Y.Doc, transaction: Y.Transaction): void {
        // A received update is not sent again. A change that an observer makes in response to it is
        // a change of our own though: it is a local transaction that runs while the update is applied.
        const received = this.applyingRemoteUpdate && !transaction.local;
        if (origin !== this && !received) {
            const encoder = encoding.createEncoder();
            syncProtocol.writeUpdate(encoder, update);
            this.connection.sync.dataUpdate(this.encode(encoder));
        }
    }

    private yjsAwarenessUpdateHandler(changed: AwarenessChange): void {
        const changedClients = changed.added.concat(changed.updated).concat(changed.removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients));
        this.connection.sync.awarenessUpdate(this.encode(encoder));
    }

    connect(): void {
        // write sync step 1
        const encoderSync = encoding.createEncoder();
        syncProtocol.writeSyncStep1(encoderSync, this.doc);
        this.connection.sync.dataUpdate(this.encode(encoderSync));
        // broadcast local state
        const encoderState = encoding.createEncoder();
        syncProtocol.writeSyncStep2(encoderState, this.doc);
        this.connection.sync.dataUpdate(this.encode(encoderState));
        // query awareness info
        this.connection.sync.awarenessQuery();
        // broadcast local awareness info
        const encoderAwareness = encoding.createEncoder();
        encoding.writeVarUint8Array(
            encoderAwareness,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
                this.doc.clientID
            ])
        );
        this.connection.sync.awarenessUpdate(this.encode(encoderAwareness));
    }

    dispose(): void {
        this.clearResyncInterval();
        awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'client disconnected');
    }

    private encode(encoder: encoding.Encoder): types.Binary {
        return encoding.toUint8Array(encoder);
    }

    private decode(data: types.Binary): decoding.Decoder {
        return decoding.createDecoder(data);
    }
}
