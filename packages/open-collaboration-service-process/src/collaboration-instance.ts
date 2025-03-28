// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';
import { DisposableCollection, Deferred } from 'open-collaboration-protocol';
import { LOCAL_ORIGIN, OpenCollaborationYjsProvider } from 'open-collaboration-yjs';
import * as Y from 'yjs';
import { Mutex } from 'async-mutex';
import * as awarenessProtocol from 'y-protocols/awareness';
import { BinaryResponse, ClientTextSelection, JoinSessionRequest, OCPBroadCast, OCPNotification, OCPRequest, OnInitNotification, TextDocumentInsert, toEncodedOCPMessage, UpdateDocumentContent, UpdateTextSelection } from './messages.js';
import { MessageConnection } from 'vscode-jsonrpc';

export class CollaborationInstance implements types.Disposable{

    protected peers = new Map<string, types.Peer>();
    protected hostInfo = new Deferred<types.Peer>();
    protected peerInfo: types.Peer;

    protected yjsProvider?: OpenCollaborationYjsProvider;
    protected YjsDoc: Y.Doc;
    protected yjsAwareness;
    private yjsMutex = new Mutex();

    protected connectionDisposables: DisposableCollection = new DisposableCollection();

    protected identity = new Deferred<types.Peer>();

    constructor(public currentConnection: types.ProtocolBroadcastConnection, protected communicationHandler: MessageConnection, protected host: boolean, workspace?: types.Workspace) {
        if(host && !workspace) {
            throw new Error('Host must provide workspace');
        }
        this.YjsDoc = new Y.Doc();
        this.yjsAwareness = new awarenessProtocol.Awareness(this.YjsDoc);
        this.yjsAwareness.on('change', ((_: any, origin: string) => {
            if (origin !== LOCAL_ORIGIN) {
                this.checkSelectionUpdated();
            }
        }));

        this.connectionDisposables.push({
            dispose: () => {
                this.YjsDoc.destroy();
                this.yjsAwareness.destroy();
            }});

        this.yjsProvider = new OpenCollaborationYjsProvider(currentConnection, this.YjsDoc, this.yjsAwareness, {
            resyncTimer: 10_000
        });
        this.yjsProvider.connect();
        this.connectionDisposables.push(currentConnection.onReconnect(() => {
            this.yjsProvider?.connect();
        }));

        currentConnection.onDisconnect(() => {
            this.dispose();
        });

        currentConnection.onRequest(async (origin, method, ...params) => {
            const result = await this.communicationHandler.sendRequest(OCPRequest, toEncodedOCPMessage({
                method,
                params
            }));
            return BinaryResponse.is(result) ? types.Encoding.decode(Uint8Array.from(Buffer.from(result.data, 'base64'))) : result;
        });

        currentConnection.onNotification((origin, method, ...params) => {
            this.communicationHandler.sendNotification(OCPNotification, toEncodedOCPMessage({method, params}));
        });

        currentConnection.onBroadcast((origin, method, ...params) => {
            this.communicationHandler.sendNotification(OCPBroadCast, toEncodedOCPMessage({method, params}));
        });

        currentConnection.peer.onJoinRequest(async (_, user) => {
            const accepted = await this.communicationHandler.sendRequest(JoinSessionRequest, user);
            return accepted ? { workspace: workspace! } : undefined;
        });

        currentConnection.peer.onInfo((_, peer) => {
            this.yjsAwareness.setLocalStateField('peer', peer.id);
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
            this.communicationHandler.sendNotification(OnInitNotification, initData);
        });
    }

    async registerYjsObject(type: string, documentPath: string, text: string) {
        if(type === 'text') {
            const yjsText = this.YjsDoc.getText(documentPath);
            if (this.host) {
                this.YjsDoc.transact(() => {
                    yjsText.delete(0, yjsText.length);
                    yjsText.insert(0, text);
                });
            } else {
                this.currentConnection.editor.open((await this.hostInfo.promise).id, documentPath);
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
                this.communicationHandler.sendNotification(UpdateDocumentContent, documentPath, edits);
            };
            yjsText.observe(observer);
        }
    }

    updateYjsObjectContent(documentPath: string, changes: TextDocumentInsert[]) {
        if (changes.length === 0) {
            return;
        }
        this.yjsMutex.runExclusive(async () => {
            const yjsText = this.YjsDoc.getText(documentPath);
            this.YjsDoc.transact(() => {
                for(const change of changes) {
                    if(change.endOffset) {
                        yjsText.delete(change.startOffset, change.endOffset - change.startOffset);
                    }
                    yjsText.insert(change.startOffset, change.text);
                }
            });
        });
    }

    private selectionState: Map<string, ClientTextSelection[]> = new Map();

    checkSelectionUpdated() {
        const states = this.yjsAwareness.getStates() as Map<number, types.ClientAwareness>;

        const currentSelections: Map<string, ClientTextSelection[]> = new Map();

        for (const [clientId, state] of states.entries()) {
            if (types.ClientTextSelection.is(state.selection) && clientId !== this.yjsAwareness.clientID) {
                const selections = state.selection.textSelections.map(s => ({
                    peer: state.peer,
                    start: Y.createAbsolutePositionFromRelativePosition(s.start, this.YjsDoc)?.index ?? 0,
                    end: Y.createAbsolutePositionFromRelativePosition(s.end, this.YjsDoc)?.index,
                    isReversed: s.direction === types.SelectionDirection.RightToLeft
                }));
                currentSelections.has(state.selection.path) ?
                    currentSelections.get(state.selection.path)!.push(...selections) :
                    currentSelections.set(state.selection.path, selections);
            }
        }

        const documentUpdates: string[] = [];

        for (const [documentPath, selections] of currentSelections.entries()) {
            if (JSON.stringify(this.selectionState.get(documentPath)) !== JSON.stringify(selections)) {
                documentUpdates.push(documentPath);
            }
        }

        this.selectionState = currentSelections;

        for (const document of documentUpdates) {
            this.communicationHandler.sendNotification(UpdateTextSelection, document, this.selectionState.get(document) ?? []);
        }

    }

    updateYjsObjectSelection(documentPath: string, clientSelections: ClientTextSelection[]) {
        if (documentPath) {
            const ytext = this.YjsDoc.getText(documentPath);
            const selections: types.RelativeTextSelection[] = [];
            for (const clientSelection of clientSelections) {
                selections.push({
                    direction: clientSelection.isReversed ?
                        types.SelectionDirection.RightToLeft :
                        types.SelectionDirection.LeftToRight,
                    start: Y.createRelativePositionFromTypeIndex(ytext, clientSelection.start),
                    end: Y.createRelativePositionFromTypeIndex(ytext, clientSelection.end ?? clientSelection.start)
                });
            }
            const textSelection: types.ClientTextSelection = {
                path: documentPath,
                textSelections: selections
            };
            this.setSharedSelection(textSelection);
        } else {
            this.setSharedSelection(undefined);
        }

    }

    private setSharedSelection(selection?: types.ClientSelection): void {
        this.yjsAwareness.setLocalStateField('selection', selection);
    }

    dispose(): void {
        this.yjsProvider?.dispose();
        this.connectionDisposables.dispose();
    }
}
