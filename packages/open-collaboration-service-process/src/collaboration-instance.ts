// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';
import { DisposableCollection, Deferred } from 'open-collaboration-protocol';
import { LineEnding, LOCAL_ORIGIN, OpenCollaborationYjsProvider, TextDocumentAdapter, YjsTextDocumentSync, YTextChange } from 'open-collaboration-yjs';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { ApplyEditRequest, BinaryData, BinaryResponse, ClientTextSelection, EditorOpenedNotification, GetBufferRequest, OpenTextDocumentParams, fromBinaryMessage, GetDocumentContent, JoinSessionRequest, OnInitNotification, PeerInfoNotification, PeerJoinedNotification, PeerLeftNotification, SessionClosedNotification, TextDocumentInsert, toBinaryMessage, UpdateDocumentContent, UpdateTextSelection } from './messages.js';
import { MessageConnection } from 'vscode-jsonrpc';
import { VersionedClientDocument } from './versioned-client-document.js';

export interface CollaborationInstanceOptions {
    /** See {@link VersionedClientDocumentOptions.editTimeout} */
    editTimeout?: number;
}

/** A document of the client that is kept in sync with the shared text */
interface SyncedDocument extends types.Disposable {
    readonly sync: YjsTextDocumentSync;
}

export class CollaborationInstance implements types.Disposable {

    protected peers = new Map<string, types.Peer>();
    protected hostInfo = new Deferred<types.Peer>();
    protected peerInfo: types.Peer;

    protected yjsProvider?: OpenCollaborationYjsProvider;
    protected YjsDoc: Y.Doc;
    protected yjsAwareness;

    protected connectionDisposables: DisposableCollection = new DisposableCollection();

    private yjsDocuments = new Map<string, SyncedDocument>();

    /**
     * Whether the client has opened a document with `document/open`. Such a client tracks the
     * documents it syncs itself, so no legacy document is created on its behalf.
     */
    private versionedClient = false;

    protected identity = new Deferred<types.Peer>();

    private encoder = new TextEncoder();
    private decoder = new TextDecoder();

    isDisposed = false;

    constructor(public octConnection: types.ProtocolBroadcastConnection, protected clientConnection: MessageConnection, protected isHost: boolean, workspace?: types.Workspace,
        protected options: CollaborationInstanceOptions = {}) {
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
                if (this.versionedClient) {
                    // The client opens the document with `document/open` once it wants to sync it
                    const ytext = this.YjsDoc.getText(documentPath);
                    if (ytext.length === 0 && text.length > 0) {
                        ytext.insert(0, text);
                    }
                } else {
                    this.registerYjsObject('text', documentPath, text);
                }
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
            // Track the peer *after* building initData (a peer isn't its own
            // "guest"), so later joiners' initData.guests - and thus their
            // encryption key cache - includes everyone already in the room.
            this.peers.set(peer.id, peer);
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
            // As a guest, getDocumentContent reads the file straight from the host
            // while the path is unshared, so the client's content does not come from
            // the shared document. The sync is told what the client holds, so that the
            // host's seeding update is reconciled with it, not inserted on top.
            this.yjsDocuments.get(documentPath)?.dispose();
            const document = this.createClientDocument(documentPath, text);
            await this.shareDocument(documentPath, document);
        }
    }

    /**
     * Starts the versioned synchronization of a document, see `document/open`.
     */
    async openTextDocument(params: OpenTextDocumentParams): Promise<void> {
        const path = params.path;
        this.versionedClient = true;
        this.yjsDocuments.get(path)?.dispose();
        const document: VersionedClientDocument = new VersionedClientDocument(path, params, this.YjsDoc.getText(path), {
            applyEdit: edit => this.clientConnection.sendRequest(ApplyEditRequest, edit),
            getBuffer: request => this.clientConnection.sendRequest(GetBufferRequest, request)
        }, {
            editTimeout: this.options.editTimeout,
            // The offsets of selections could only be estimated while the client's document was behind
            onDidSync: () => this.checkSelectionUpdated(),
            onDidChangeSelection: selections => this.updateYjsObjectSelection(path, selections),
            onDidClose: () => this.closeTextDocument(path, document)
        });
        this.yjsDocuments.set(path, document);
        await this.shareDocument(path, document);
    }

    /**
     * Stops the synchronization of a document. Only closes the given document, if one is given.
     */
    closeTextDocument(path: string, document = this.yjsDocuments.get(path)): void {
        if (document && this.yjsDocuments.get(path) === document) {
            this.yjsDocuments.delete(path);
            document.dispose();
        }
    }

    didChangeTextDocument(path: string, version: number, changes: TextDocumentInsert[]): void {
        this.getVersionedDocument(path)?.didChange(version, changes);
    }

    didChangeTextSelection(path: string, version: number, selections: ClientTextSelection[]): void {
        this.getVersionedDocument(path)?.didChangeSelection(version, selections);
    }

    private getVersionedDocument(path: string): VersionedClientDocument | undefined {
        const document = this.yjsDocuments.get(path);
        if (document instanceof VersionedClientDocument) {
            return document;
        }
        console.error(`Document ${path} has not been opened with document/open`);
        return undefined;
    }

    private async shareDocument(documentPath: string, document: SyncedDocument): Promise<void> {
        if (this.isHost) {
            // A non-empty shared document is authoritative: it may hold unsaved guest
            // edits, and re-seeding would discard those and invalidate every relative
            // position. The sync pulls it into our client instead.
            if (this.YjsDoc.getText(documentPath).length === 0) {
                document.sync.seed();
            }
        } else {
            this.octConnection.editor.open((await this.hostInfo.promise).id, documentPath);
        }
    }

    private createClientDocument(path: string, text: string): ClientDocument {
        const document = new ClientDocument(text, this.YjsDoc.getText(path), changes => {
            this.clientConnection.sendNotification(UpdateDocumentContent, path, changes.map(change => ({
                startOffset: change.start,
                endOffset: change.end,
                text: change.text
            } as TextDocumentInsert)));
        }, () => {
            // The offsets of selections could only be estimated while the client's document was behind
            this.checkSelectionUpdated();
        });
        this.yjsDocuments.set(path, document);
        return document;
    }

    updateYjsObjectContent(documentPath: string, changes: TextDocumentInsert[]) {
        if (changes.length === 0) {
            return;
        }
        if (documentPath) {
            const existing = this.yjsDocuments.get(documentPath);
            if (existing && !(existing instanceof ClientDocument)) {
                console.error(`Document ${documentPath} is synced with document/didChange, ignoring awareness/updateDocument`);
                return;
            }
            // A client that never opened the document can only have got its content from the shared document
            const document = existing ?? this.createClientDocument(documentPath, this.YjsDoc.getText(documentPath).toString());
            document.update(changes.map(change => ({
                start: change.startOffset,
                end: change.endOffset ?? change.startOffset,
                text: change.text
            })));
        }
    }

    private selectionState: Map<string, ClientTextSelection[]> = new Map();

    checkSelectionUpdated() {
        const states = this.yjsAwareness.getStates() as Map<number, types.ClientAwareness>;

        const currentSelections: Map<string, ClientTextSelection[]> = new Map();

        for (const [clientId, state] of states.entries()) {
            if (types.ClientTextSelection.is(state.selection) && clientId !== this.yjsAwareness.clientID) {
                // Offsets are the ones of the client's document, if the client has opened it
                const sync = this.yjsDocuments.get(state.selection.path)?.sync;

                const selections = state.selection.textSelections.map(s => {
                    const start = Y.createAbsolutePositionFromRelativePosition(s.start, this.YjsDoc)?.index ?? 0;
                    const end =  Y.createAbsolutePositionFromRelativePosition(s.end, this.YjsDoc)?.index;
                    return {
                        peer: state.peer,
                        start: sync ? sync.editorOffset(start) : start,
                        end: sync ? sync.editorOffset(end ?? start) : end ?? start,
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
            const sync = this.yjsDocuments.get(documentPath)?.sync;
            const toShared = (offset: number) => sync ? sync.normalizedOffset(offset) : offset;
            const selections: types.RelativeTextSelection[] = [];
            for (const clientSelection of clientSelections) {
                selections.push({
                    direction: clientSelection.isReversed ?
                        types.SelectionDirection.RightToLeft :
                        types.SelectionDirection.LeftToRight,
                    start: Y.createRelativePositionFromTypeIndex(ytext, toShared(clientSelection.start)),
                    end: Y.createRelativePositionFromTypeIndex(ytext, toShared(clientSelection.end ?? clientSelection.start))
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
        this.yjsDocuments.forEach(document => document.dispose());
        this.yjsDocuments.clear();
        this.YjsDoc.destroy();
        this.connectionDisposables.dispose();
    }
}

/**
 * The document of the native client, as far as the service process knows it.
 *
 * The client applies the changes it is sent without confirming them, and it does not report them
 * back. Other than an editor that rejects an outdated edit, every change is therefore taken as
 * applied the moment it is sent. A change the client makes before it has received one of ours
 * addresses a document that we already consider changed. Clients that open a document with
 * `document/open` avoid this, see {@link VersionedClientDocument}.
 */
class ClientDocument implements types.Disposable {

    /**
     * Holds the only copy of the client's document: what the sync takes a change for
     * is what the next change is computed from.
     */
    readonly sync: YjsTextDocumentSync;

    constructor(text: string, ytext: Y.Text, send: (changes: YTextChange[]) => void, onDidSync: () => void) {
        // The sync reads the text it starts with while it is being created
        let initialText: string | undefined = text;
        const getText = () => initialText ?? this.sync.text;
        const adapter: TextDocumentAdapter = {
            getText,
            getEol: (): LineEnding => getText().includes('\r\n') ? '\r\n' : '\n',
            applyChanges: async changes => {
                send(changes);
                this.update(changes);
                return true;
            }
        };
        this.sync = new YjsTextDocumentSync(ytext, adapter, {
            // stdout is the channel to the client
            onError: error => console.error('Failed to sync document', error),
            onDidSync
        });
        initialText = undefined;
    }

    /**
     * Follows a change of the client's document. All changes address the document as it was before.
     */
    update(changes: YTextChange[]): void {
        this.sync.onDidChangeContent(changes);
    }

    dispose(): void {
        this.sync.dispose();
    }
}
