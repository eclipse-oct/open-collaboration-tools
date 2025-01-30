// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';
import { DisposableCollection, Emitter, Deferred } from 'open-collaboration-protocol';
import { OpenCollaborationYjsProvider } from 'open-collaboration-yjs';
import * as Y from 'yjs';
import { Mutex } from 'async-mutex';
import * as awarenessProtocol from 'y-protocols/awareness';
import { ClientRequests, DaemonMessage, JoinRequestResponse, OCPMessage, OpenDocument, TextDocumentInsert, UpdateDocumentContent, UpdateTextSelection } from './messages';

export class CollaborationInstance implements types.Disposable{

    protected peers = new Map<string, types.Peer>();
    protected hostInfo = new Deferred<types.Peer>();
    protected peerInfo: types.Peer;

    protected yjsProvider?: OpenCollaborationYjsProvider;
    protected YjsDoc: Y.Doc;
    private yjsMutex = new Mutex();

    protected connectionDisposables: DisposableCollection = new DisposableCollection();

    protected identity = new Deferred<types.Peer>();

    protected sendMessageEmitter = new Emitter<DaemonMessage>();
    onSendMessage = this.sendMessageEmitter.event;

    protected sendRequestEmitter = new Emitter<ClientRequests | OCPMessage>();
    onSendRequest = this.sendRequestEmitter.event;

    constructor(public currentConnection: types.ProtocolBroadcastConnection, protected host: boolean, workspace?: types.Workspace) {
        if(host && !workspace) {
            throw new Error('Host must provide workspace');
        }
        this.YjsDoc = new Y.Doc();
        const awareness = new awarenessProtocol.Awareness(this.YjsDoc);
        this.connectionDisposables.push({
            dispose: () => {
                this.YjsDoc.destroy();
                awareness.destroy();
            }});

        this.yjsProvider = new OpenCollaborationYjsProvider(currentConnection, this.YjsDoc, awareness);
        this.yjsProvider.connect();
        this.connectionDisposables.push(currentConnection.onReconnect(() => {
            this.yjsProvider?.connect();
        }));

        currentConnection.onDisconnect(() => {
            this.dispose();
        });

        currentConnection.onUnhandledRequest(async (origin, method, ...params) => {
            return await this.sendRequestEmitter.fire({
                method,
                params
            })[0];
        });

        currentConnection.onUnhandledNotification((origin, method, ...params) => {
            this.sendMessageEmitter.fire({
                kind: 'notification',
                content: {
                    method,
                    params
                }
            });
        });

        currentConnection.onUnhandledBroadcast((origin, method, ...params) => {
            this.sendMessageEmitter.fire({
                kind: 'broadcast',
                content: {
                    method,
                    params
                }
            });
        });

        currentConnection.peer.onJoinRequest(async (_, user) => {
            const res = await this.sendRequestEmitter.fire({
                method: 'peer/onJoinRequest',
                user
            })[0] as JoinRequestResponse;
            return res.accepted ? { workspace: workspace! } : undefined;
        });

        currentConnection.peer.onInfo((_, peer) => {
            awareness.setLocalStateField('peer', peer.id);
            this.identity.resolve(peer);
        });

        currentConnection.room.onJoin(async (_, peer) => {
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
                currentConnection.peer.init(peer.id, initData);
            }
        });

        currentConnection.peer.onInit((_, initData) => {
            this.peers.set(initData.host.id, initData.host);
            this.hostInfo.resolve(initData.host);
            for (const guest of initData.guests) {
                this.peers.set(guest.id, guest);
            }
            this.sendMessageEmitter.fire({
                kind: 'notification',
                content: {
                    method: 'init',
                    initData
                },
            });
        });
    }

    async registerYjsObject(message: OpenDocument) {
        if(message.type === 'text') {
            const yjsText = this.YjsDoc.getText(message.documentUri);
            if (this.host) {
                this.YjsDoc.transact(() => {
                    yjsText.delete(0, yjsText.length);
                    yjsText.insert(0, message.text);
                });
            } else {
                this.currentConnection.editor.open((await this.hostInfo.promise).id, message.documentUri);
            }
            const observer = (textEvent: Y.YTextEvent) => {
                if (textEvent.transaction.local) {
                    // Ignore own events or if the document is already in sync
                    return;
                }
                const edits: TextDocumentInsert[] = [];
                let index = 0;
                textEvent.delta.forEach(delta => {
                    if (typeof delta.retain === 'number') {
                        index += delta.retain;
                    } else if (typeof delta.insert === 'string') {
                        edits.push({
                            startOffset: index,
                            text: delta.insert,
                        });
                        index += delta.insert.length;
                    } else if (typeof delta.delete === 'number') {
                        edits.push({
                            startOffset: index,
                            endOffset: index + delta.delete,
                            text: '',
                        });
                    }
                });
                this.sendMessageEmitter.fire({
                    kind: 'notification',
                    content: {
                        method: 'awareness/updateDocument',
                        documentUri: message.documentUri,
                        changes: edits
                    }
                });
            };
            yjsText.observe(observer);
        }
    }

    updateYjsObjectContent(update: UpdateDocumentContent) {
        if (update.changes.length === 0) {
            return;
        }
        this.yjsMutex.runExclusive(async () => {
            const yjsText = this.YjsDoc.getText(update.documentUri);
            this.YjsDoc.transact(() => {
                for(const change of update.changes) {
                    if(change.endOffset) {
                        yjsText.delete(change.startOffset, change.endOffset - change.startOffset);
                    }
                    yjsText.insert(change.startOffset, change.text);
                }
            });
        });
    }

    updateYjsObjectSelection(update: UpdateTextSelection) {
        update.method;
    }

    dispose(): void {
        this.yjsProvider?.dispose();
        this.connectionDisposables.dispose();
    }
}
