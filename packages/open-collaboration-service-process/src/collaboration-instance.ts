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
import { BinaryData, BinaryResponse, ClientTextSelection, EditorOpenedNotification, fromBinaryMessage, GetDocumentContent, JoinSessionRequest, OnInitNotification, PeerInfoNotification, PeerJoinedNotification, PeerLeftNotification, SessionClosedNotification, TextDocumentInsert, toBinaryMessage, UpdateDocumentContent, UpdateTextSelection } from './messages.js';
import { MessageConnection } from 'vscode-jsonrpc';

export class CollaborationInstance implements types.Disposable {

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
    private decoder = new TextDecoder();

    isDisposed = false;

    constructor(public octConnection: types.ProtocolBroadcastConnection, protected clientConnection: MessageConnection, protected isHost: boolean, workspace?: types.Workspace) {
        process.on('beforeExit', () => {
            this.leaveRoom();
        });

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

        this.yjsProvider = new OpenCollaborationYjsProvider(octConnection, this.YjsDoc, this.yjsAwareness, {
            resyncTimer: 10_000
        });
        this.yjsProvider.connect();
        this.connectionDisposables.push(octConnection.onReconnect(() => {
            this.yjsProvider?.connect();
        }));

        octConnection.onDisconnect(() => {
            this.dispose();
        });

        octConnection.room.onClose(() => {
            this.dispose();
        });

        octConnection.onRequest(async (origin, method, ...params) => {
            const result = await this.clientConnection.sendRequest(method, ...this.convertBinaryParams(params), origin);
            return BinaryData.is(result) ? fromBinaryMessage(result.data) : result;
        });

        octConnection.onNotification((origin, method, ...params) => {
            this.clientConnection.sendNotification(method, ...this.convertBinaryParams(params), origin);
        });

        octConnection.onBroadcast((origin, method, ...params) => {
            this.clientConnection.sendNotification(method, ...this.convertBinaryParams(params), origin);
        });

        octConnection.peer.onJoinRequest(async (_, user) => {
            const accepted = await this.clientConnection.sendRequest(JoinSessionRequest, user);
            return accepted ? { workspace: workspace! } : undefined;
        });

        octConnection.peer.onInfo((_, peer) => {
            this.yjsAwareness.setLocalStateField('peer', peer.id);
            this.identity.resolve(peer);
            this.clientConnection.sendNotification(PeerInfoNotification, peer);
        });

        octConnection.editor.onOpen(async (peerId, documentPath) => {
            if(!this.YjsDoc.share.has(documentPath)) {
                // editor.open is addressed at the host (see registerYjsObject's
                // guest branch below), so this only ever fires on the host's own
                // instance. Read the real file content from disk — via this
                // peer's own native client — instead of seeding with '', which
                // otherwise leaves every peer's replica blank until *something
                // else* happens to overwrite it later (e.g. the host's own
                // editor eventually opening and reseeding the path).
                const text = this.isHost ? this.decoder.decode((await this.readOwnFile(documentPath)).content) : '';
                this.registerYjsObject('text', documentPath, text);
            }
            this.clientConnection.sendNotification(EditorOpenedNotification, documentPath, peerId);
        });

        octConnection.room.onJoin(async (_, peer) => {
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
                octConnection.peer.init(peer.id, initData);
            }
            this.clientConnection.sendNotification(PeerJoinedNotification, peer);
        });

        octConnection.room.onLeave(async (_, peer) => {
            this.peers.delete(peer.id);
            this.clientConnection.sendNotification(PeerLeftNotification, peer);
        });

        octConnection.peer.onInit((_, initData) => {
            this.peers.set(initData.host.id, initData.host);
            this.hostInfo.resolve(initData.host);
            for (const guest of initData.guests) {
                this.peers.set(guest.id, guest);
            }
            this.clientConnection.sendNotification(OnInitNotification, initData);
        });

        clientConnection.onRequest(GetDocumentContent, async (documentPath) => {
            let fileContent: types.FileData | undefined = undefined;
            if(this.YjsDoc.share.has(documentPath)) {
                const text = this.YjsDoc.getText(documentPath);
                fileContent = {
                    content: this.encoder.encode(text.toString()),
                } as types.FileData;

            } else if (this.isHost) {
                fileContent = await this.readOwnFile(documentPath);
            } else {
                fileContent = await octConnection.fs.readFile((await this.hostInfo.promise).id, documentPath);
            }

            return {
                type: 'binaryData',
                data: toBinaryMessage(fileContent),
                method: GetDocumentContent.method,
            } as BinaryResponse;

        });
    }

    /**
     * Reads a file directly from this peer's own native client (e.g. Eclipse
     * or IntelliJ) over the local stdio `clientConnection`, without going
     * through the OCT server at all. Only ever call this when `this.isHost`
     * — a host reading its own file.
     *
     * Routing this through `octConnection.fs.readFile(target, path)` with
     * `target` set to this peer's own id — i.e. addressing a request at
     * *ourselves* — is not an option: the connection's encryption layer keys
     * outgoing requests by the target's public key, and a peer's own public
     * key is never registered in its own key cache (key exchange only ever
     * happens with *other* peers during their handshake). That throws
     * "No public key found for origin <ownId>", killing the whole process.
     * Talking to our own native client directly sidesteps the server (and
     * that bug) entirely, and is cheaper besides — the file is already
     * local to this process' own client.
     *
     * The native clients' `fileSystem/readFile` handlers all take
     * `(path, origin)` — the `origin` is unused by them (see the Eclipse and
     * IntelliJ plugins' `FileSystemMessageHandler`) but is passed along for
     * consistency with how `octConnection.onRequest` forwards cross-peer
     * requests to this same handler.
     */
    private async readOwnFile(documentPath: string): Promise<types.FileData> {
        const id = (await this.identity.promise).id;
        // Mirrors the decoding octConnection.onRequest's generic forwarding
        // handler above does for cross-peer requests: the native client may
        // wrap its FileContent response as a BinaryData envelope.
        const result = await this.clientConnection.sendRequest('fileSystem/readFile', documentPath, id);
        return (BinaryData.is(result) ? fromBinaryMessage(result.data) : result) as types.FileData;
    }

    async registerYjsObject(type: string, documentPath: string, text: string) {
        if(type === 'text') {
            const normalizedDocument = this.getNormalizedDocument(documentPath);
            if (this.isHost) {
                normalizedDocument.update({changes: text});
            } else {
                this.octConnection.editor.open((await this.hostInfo.promise).id, documentPath);
            }
        }
    }

    private getNormalizedDocument(path: string): YjsNormalizedTextDocument {
        let yjsDocument = this.yjsDocuments.get(path);
        if (!yjsDocument) {
            yjsDocument = new YjsNormalizedTextDocument(this.YjsDoc.getText(path), async changes => {
                this.clientConnection.sendNotification(UpdateDocumentContent, path, changes.map(change => {
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
            this.clientConnection.sendNotification(UpdateTextSelection, document, this.selectionState.get(document) ?? []);
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
        await this.octConnection.room.leave();
        await new Promise(resolve => setTimeout(resolve, 100));
        this.dispose();
    }

    private convertBinaryParams(params: unknown[]): unknown[] {
        return params.map(param => BinaryData.shouldConvert(param) ? { type: 'binaryData', data: toBinaryMessage(param) } as BinaryData: param);
    }

    dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;
        this.clientConnection.sendNotification(SessionClosedNotification);
        this.octConnection.dispose();
        this.yjsProvider?.dispose();
        this.YjsDoc.destroy();
        this.connectionDisposables.dispose();
    }
}
