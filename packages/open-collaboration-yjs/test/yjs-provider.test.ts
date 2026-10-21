// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import type * as types from 'open-collaboration-protocol';
import { OpenCollaborationYjsProvider } from '../src/yjs-provider.js';

type Handler = (origin: string, data: Uint8Array) => void;

interface Peer {
    doc: Y.Doc;
    handlers: { data: Handler[]; awareness: Handler[]; query: Handler[] };
}

/**
 * Stands in for the server: a frame reaches every other peer in the room (or the one
 * it targets) with the sender's id as its origin.
 */
class Room {
    readonly peers = new Map<string, Peer>();
    readonly updateFrames: string[] = [];
    readonly delays = new Map<string, number>();
    readonly dropped = new Set<string>();
    readonly errors: unknown[] = [];
    readonly sendAs = new Map<string, (data: Uint8Array) => void>();

    join(id: string, options?: { resyncTimer?: number }): Y.Doc {
        const doc = new Y.Doc();
        const peer: Peer = { doc, handlers: { data: [], awareness: [], query: [] } };
        this.peers.set(id, peer);
        const send = (kind: keyof Peer['handlers'], target: string | undefined, data: Uint8Array) => {
            for (const [peerId, receiver] of this.peers) {
                const link = `${id}>${peerId}`;
                if (peerId === id || (target && target !== peerId) || this.dropped.has(link)) {
                    continue;
                }
                setTimeout(() => {
                    if (kind === 'data' && decoding.readVarUint(decoding.createDecoder(data)) === syncProtocol.messageYjsUpdate) {
                        this.updateFrames.push(link);
                    }
                    for (const handler of receiver.handlers[kind]) {
                        try {
                            handler(id, data);
                        } catch (error) {
                            this.errors.push(error);
                        }
                    }
                }, this.delays.get(link) ?? 0);
            }
        };
        const either = (kind: keyof Peer['handlers']) => (a: string | Uint8Array, b?: Uint8Array) =>
            typeof a === 'string' ? send(kind, a, b!) : send(kind, undefined, a);
        this.sendAs.set(id, data => send('data', undefined, data));
        const connection = {
            sync: {
                dataUpdate: either('data'),
                awarenessUpdate: either('awareness'),
                awarenessQuery: () => send('query', undefined, new Uint8Array()),
                onDataUpdate: (handler: Handler) => peer.handlers.data.push(handler),
                onAwarenessUpdate: (handler: Handler) => peer.handlers.awareness.push(handler),
                onAwarenessQuery: (handler: Handler) => peer.handlers.query.push(handler)
            }
        };
        // Only the sync channel is used by the provider.
        new OpenCollaborationYjsProvider(connection as unknown as types.ProtocolBroadcastConnection, doc, new awarenessProtocol.Awareness(doc), options);
        return doc;
    }

    destroy(): void {
        this.peers.forEach(peer => peer.doc.destroy());
    }
}

describe('OpenCollaborationYjsProvider', () => {
    let room: Room;

    beforeEach(() => {
        vi.useFakeTimers();
        room = new Room();
    });

    afterEach(() => {
        room.destroy();
        vi.useRealTimers();
    });

    test('sends an edit to each peer once, without other peers sending it again', async () => {
        room.join('host');
        const alice = room.join('alice');
        const bob = room.join('bob');

        alice.getText('file').insert(0, 'a');
        await vi.advanceTimersByTimeAsync(100);

        expect(room.updateFrames.sort()).toEqual(['alice>bob', 'alice>host']);
        expect(bob.getText('file').toString()).toBe('a');
    });

    test('applies an edit with its author as the origin when the author\'s link is slowest', async () => {
        const host = room.join('host');
        const alice = room.join('alice');
        room.join('bob');
        room.delays.set('alice>host', 20);
        const origins: unknown[] = [];
        host.getText('file').observe(event => origins.push(event.transaction.origin));

        alice.getText('file').insert(0, 'a');
        await vi.advanceTimersByTimeAsync(100);

        expect(origins).toEqual(['alice']);
    });

    test('still sends its own edits after a frame it cannot read', async () => {
        const host = room.join('host');
        const alice = room.join('alice');
        room.sendAs.get('host')!(new Uint8Array([7]));
        await vi.advanceTimersByTimeAsync(100);
        expect(room.errors).toHaveLength(1);

        alice.getText('file').insert(0, 'a');
        await vi.advanceTimersByTimeAsync(100);

        expect(host.getText('file').toString()).toBe('a');
    });

    test('brings a peer that missed an edit up to date through the resync timer', async () => {
        room.join('host', { resyncTimer: 50 });
        const alice = room.join('alice', { resyncTimer: 50 });
        const bob = room.join('bob', { resyncTimer: 50 });
        room.dropped.add('alice>bob');

        alice.getText('file').insert(0, 'a');
        await vi.advanceTimersByTimeAsync(10);
        expect(bob.getText('file').toString()).toBe('');

        await vi.advanceTimersByTimeAsync(200);
        expect(bob.getText('file').toString()).toBe('a');
    });
});
