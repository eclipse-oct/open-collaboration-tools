// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';
import { DisposableCollection, Emitter, Deferred } from 'open-collaboration-protocol';
import { OpenCollaborationYjsProvider } from 'open-collaboration-yjs';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { ClientRequests, DaemonMessage, JoinRequestResponse, OCPMessage } from './messages';

export class CollaborationInstance implements types.Disposable{

    protected peers = new Map<string, types.Peer>();

    currentConnection: types.ProtocolBroadcastConnection;
    protected yjsProvider?: OpenCollaborationYjsProvider;

    protected connectionDisposables: DisposableCollection = new DisposableCollection();

    protected identity = new Deferred<types.Peer>();

    protected sendMessageEmitter = new Emitter<DaemonMessage>();
    onSendMessage = this.sendMessageEmitter.event;

    protected sendRequestEmitter = new Emitter<ClientRequests | OCPMessage>();
    onSendRequest = this.sendRequestEmitter.event;

    constructor(connection: types.ProtocolBroadcastConnection, host: boolean, workspace?: types.Workspace) {
        if(host && !workspace) {
            throw new Error('Host must provide workspace');
        }
        this.currentConnection = connection;
        const YjsDoc = new Y.Doc();
        const awareness = new awarenessProtocol.Awareness(YjsDoc);
        this.connectionDisposables.push({
            dispose: () => {
                YjsDoc.destroy();
                awareness.destroy();
            }});

        this.yjsProvider = new OpenCollaborationYjsProvider(connection, YjsDoc, awareness);
        this.yjsProvider.connect();
        this.connectionDisposables.push(connection.onReconnect(() => {
            this.yjsProvider?.connect();
        }));

        connection.onDisconnect(() => {
            this.dispose();
        });

        connection.onUnhandledRequest(async (origin, method, ...parameters) => {
            return await this.sendRequestEmitter.fire({
                method,
                parameters
            })[0];
        });

        connection.onUnhandledNotification((origin, method, ...parameters) => {
            this.sendMessageEmitter.fire({
                kind: 'notification',
                content: {
                    method,
                    parameters
                }
            });
        });

        connection.onUnhandledBroadcast((origin, method, ...parameters) => {
            this.sendMessageEmitter.fire({
                kind: 'broadcast',
                content: {
                    method,
                    parameters
                }
            });
        });

        connection.peer.onJoinRequest(async (_, user) => {
            const res = await this.sendRequestEmitter.fire({
                method: 'join-request',
                user
            })[0] as JoinRequestResponse;
            return res.accepted ? { workspace: workspace! } : undefined;
        });

        connection.peer.onInfo((_, peer) => {
            awareness.setLocalStateField('peer', peer.id);
            this.identity.resolve(peer);
        });

        connection.room.onJoin(async (_, peer) => {
            if (host && workspace) {
                // Only initialize the user if we are the host
                const initData: types.InitData = {
                    protocol: types.VERSION,
                    host: await this.identity.promise,
                    guests: Array.from(this.peers.values()),
                    capabilities: {},
                    permissions: { readonly: false },
                    workspace: {
                        name: workspace.name ?? 'Collaboration',
                        folders: workspace.folders ?? []
                    }
                };
                connection.peer.init(peer.id, initData);
            }
        });
    }

    dispose(): void {
        this.yjsProvider?.dispose();
        this.connectionDisposables.dispose();
    }
}