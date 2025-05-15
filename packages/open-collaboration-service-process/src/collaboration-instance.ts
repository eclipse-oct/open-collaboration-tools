// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';
import { DisposableCollection, Deferred } from 'open-collaboration-protocol';
import { LOCAL_ORIGIN, OpenCollaborationYjsProvider, YjsNormalizedTextDocument, YTextChange } from 'open-collaboration-yjs';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { BinaryData, BinaryResponse, ClientTextSelection, EditorOpenedNotification, fromBinaryMessage, GetDocumentContent, JoinSessionRequest, OnInitNotification, PeerJoinedNotification, PeerLeftNotification, TextDocumentInsert, toBinaryMessage, UpdateDocumentContent, UpdateTextSelection } from './messages.js';
import { MessageConnection } from 'vscode-jsonrpc';

export class CollaborationInstance implements types.Disposable{

    protected peers = new Map<string, types.Peer>();
    protected hostInfo = new Deferred<types.Peer>();
    protected peerInfo: types.Peer;

    protected yjsProvider?: OpenCollaborationYjsProvider;
    protected YjsDoc: Y.Doc;
    protected yjsAwareness;

    protected connectionDisposables: DisposableCollection = new DisposableCollection();

    private yjsDocuments = new Map<string, YjsNormalizedTextDocument>();

    protected identity = new Deferred<types.Peer>();

    private encoder = new TextEncoder();

    constructor(public currentConnection: types.ProtocolBroadcastConnection, protected communicationHandler: MessageConnection, protected isHost: boolean, workspace?: types.Workspace) {
        if(isHost && !workspace) {
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
            const result = await this.communicationHandler.sendRequest(method, ...this.convertBinaryParams(params), origin);
            return BinaryData.is(result) ? fromBinaryMessage(result.data) : result;
        });

        currentConnection.onNotification((origin, method, ...params) => {
            this.communicationHandler.sendNotification(method, ...this.convertBinaryParams(params), origin);
        });

        currentConnection.onBroadcast((origin, method, ...params) => {
            this.communicationHandler.sendNotification(method, ...this.convertBinaryParams(params), origin);
        });

        currentConnection.peer.onJoinRequest(async (_, user) => {
            const accepted = await this.communicationHandler.sendRequest(JoinSessionRequest, user);
            return accepted ? { workspace: workspace! } : undefined;
        });

        currentConnection.peer.onInfo((_, peer) => {
            this.yjsAwareness.setLocalStateField('peer', peer.id);
            this.identity.resolve(peer);
        });

        currentConnection.editor.onOpen(async (peerId, documentPath) => {
            this.registerYjsObject('text', documentPath, '');
            this.communicationHandler.sendNotification(EditorOpenedNotification, documentPath, peerId);
        });

        currentConnection.room.onJoin(async (_, peer) => {
            if (isHost && workspace) {
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
            this.communicationHandler.sendNotification(PeerJoinedNotification, peer);
        });

        currentConnection.room.onLeave(async (_, peer) => {
            this.peers.delete(peer.id);
            this.communicationHandler.sendNotification(PeerLeftNotification, peer);
        });

        currentConnection.peer.onInit((_, initData) => {
            this.peers.set(initData.host.id, initData.host);
            this.hostInfo.resolve(initData.host);
            for (const guest of initData.guests) {
                this.peers.set(guest.id, guest);
            }
            this.communicationHandler.sendNotification(OnInitNotification, initData);
        });

        communicationHandler.onRequest(GetDocumentContent, async (documentPath) => {
            let fileContent: types.FileData | undefined = undefined;
            if(this.YjsDoc.share.has(documentPath)) {
                const text = this.YjsDoc.getText(documentPath);
                fileContent = {
                    content: this.encoder.encode(text.toString()),
                } as types.FileData;

            } else {
                fileContent = await currentConnection.fs.readFile((await this.hostInfo.promise).id, documentPath);
            }

            return {
                type: 'binaryData',
                data: toBinaryMessage(fileContent),
                method: GetDocumentContent.method,
            } as BinaryResponse;

        });
    }

    async registerYjsObject(type: string, documentPath: string, text: string) {
        if(type === 'text') {
            const normalizedDocument = this.getNormalizedDocument(documentPath);
            if (this.isHost) {
                normalizedDocument.update({changes: text});
            } else {
                this.currentConnection.editor.open((await this.hostInfo.promise).id, documentPath);
            }
        }
    }

    private getNormalizedDocument(path: string): YjsNormalizedTextDocument {
        let yjsDocument = this.yjsDocuments.get(path);
        if (!yjsDocument) {
            yjsDocument = new YjsNormalizedTextDocument(this.YjsDoc.getText(path), async changes => {
                this.communicationHandler.sendNotification(UpdateDocumentContent, path, changes.map(change => {
                    const start = yjsDocument!.normalizedOffset(change.start);
                    const end = yjsDocument!.normalizedOffset(change.end);
                    return {
                        startOffset: start,
                        endOffset: end,
                        text: change.text
                    } as TextDocumentInsert;
                }));
            });
            this.yjsDocuments.set(path, yjsDocument);
        }
        return yjsDocument;
    }

    updateYjsObjectContent(documentPath: string, changes: TextDocumentInsert[]) {
        if (changes.length === 0) {
            return;
        }
        if (documentPath) {

            const normalizedDocument = this.getNormalizedDocument(documentPath);
            const textChanges: YTextChange[] = [];
            for (const change of changes) {
                const start = change.startOffset;
                const end = change.endOffset ?? change.startOffset;
                textChanges.push({
                    start,
                    end,
                    text: change.text
                });
            }
            normalizedDocument.update({ changes: textChanges });
        }
    }

    private selectionState: Map<string, ClientTextSelection[]> = new Map();

    checkSelectionUpdated() {
        const states = this.yjsAwareness.getStates() as Map<number, types.ClientAwareness>;

        const currentSelections: Map<string, ClientTextSelection[]> = new Map();

        for (const [clientId, state] of states.entries()) {
            if (types.ClientTextSelection.is(state.selection) && clientId !== this.yjsAwareness.clientID) {
                const normalizedDocument = this.getNormalizedDocument(state.selection.path);

                const selections = state.selection.textSelections.map(s => {
                    const start = Y.createAbsolutePositionFromRelativePosition(s.start, this.YjsDoc)?.index ?? 0;
                    const end =  Y.createAbsolutePositionFromRelativePosition(s.end, this.YjsDoc)?.index;
                    return {
                        peer: state.peer,
                        start: normalizedDocument.normalizedOffset(start),
                        end: normalizedDocument.normalizedOffset(end ?? start),
                        isReversed: s.direction === types.SelectionDirection.RightToLeft
                    };
                });
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

    async leaveRoom(): Promise<void> {
        await this.currentConnection.room.leave();
        this.dispose();
    }

    private convertBinaryParams(params: unknown[]): unknown[] {
        return params.map(param => BinaryData.shouldConvert(param) ? toBinaryMessage(param): param);
    }

    dispose(): void {
        this.currentConnection.dispose();
        this.yjsProvider?.dispose();
        this.YjsDoc.destroy();
        this.connectionDisposables.dispose();
    }
}
