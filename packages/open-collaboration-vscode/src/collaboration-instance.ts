// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ProtocolBroadcastConnection, Deferred, DisposableCollection } from 'open-collaboration-protocol';
import * as vscode from 'vscode';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as types from 'open-collaboration-protocol';
import { CollaborationFileSystemProvider } from './collaboration-file-system';
import { LOCAL_ORIGIN, OpenCollaborationYjsProvider } from 'open-collaboration-yjs';
import debounce from 'lodash/debounce';
import throttle from 'lodash/throttle';
import { inject, injectable, postConstruct } from 'inversify';
import { removeWorkspaceFolders } from './utils/workspace';
import { Mutex } from 'async-mutex';
import { CollaborationUri } from './utils/uri';
import { userColors } from './utils/package';

export interface PeerWithColor extends types.Peer {
    color?: string;
}

export class DisposablePeer implements vscode.Disposable {

    readonly peer: types.Peer;
    private disposables: vscode.Disposable[] = [];
    private yjsAwareness: awarenessProtocol.Awareness;

    readonly decoration: ClientTextEditorDecorationType;

    get clientId(): number | undefined {
        const states = this.yjsAwareness.getStates() as Map<number, types.ClientAwareness>;
        for (const [clientID, state] of states.entries()) {
            if (state.peer === this.peer.id) {
                return clientID;
            }
        }
        return undefined;
    }

    get lastUpdated(): number | undefined {
        const clientId = this.clientId;
        if (clientId !== undefined) {
            const meta = this.yjsAwareness.meta.get(clientId);
            if (meta) {
                return meta.lastUpdated;
            }
        }
        return undefined;
    }

    constructor(yAwareness: awarenessProtocol.Awareness, peer: types.Peer) {
        this.peer = peer;
        this.yjsAwareness = yAwareness;
        this.decoration = this.createDecorationType();
        this.disposables.push(this.decoration);
    }

    private createDecorationType(): ClientTextEditorDecorationType {
        const color = nextColor();
        const colorCss = `var(--vscode-${color.replaceAll('.', '-')})`;
        const selection: vscode.DecorationRenderOptions = {
            backgroundColor: `color-mix(in srgb, ${colorCss} 25%, transparent)`,
            borderRadius: '0.1em'
        };
        const cursor: vscode.ThemableDecorationAttachmentRenderOptions = {
            color: colorCss,
            contentText: 'ᛙ',
            margin: '0px 0px 0px -0.25ch',
            fontWeight: 'bold',
            textDecoration: 'none; position: absolute; display: inline-block; top: 0; font-size: 200%; font-weight: bold; z-index: 1;'
        };
        const before = vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            ...selection,
            before: cursor
        });
        const after = vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            ...selection,
            after: cursor
        });
        const nameTag = this.createNameTag(colorCss, 'top: -1rem;');
        const invertedNameTag = this.createNameTag(colorCss, 'bottom: -1rem;');

        return new ClientTextEditorDecorationType(before, after, {
            default: nameTag,
            inverted: invertedNameTag
        }, color);
    }

    private createNameTag(color: string, textDecoration?: string): vscode.TextEditorDecorationType {
        const options: vscode.ThemableDecorationAttachmentRenderOptions = {
            contentText: this.peer.name,
            backgroundColor: color,
            textDecoration: `none; position: absolute; border-radius: 0.15rem; padding:0px 0.5ch; display: inline-block;
                                pointer-events: none; color: #000; font-size: 0.7rem; z-index: 10; font-weight: bold;${textDecoration ?? ''}`
        };
        return vscode.window.createTextEditorDecorationType({
            backgroundColor: color,
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            before: options
        });
    }

    dispose() {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

}

let colorIndex = 0;

function nextColor(): string {
    colorIndex %= userColors.length;
    return userColors[colorIndex++];
}

export class ClientTextEditorDecorationType implements vscode.Disposable {
    protected readonly toDispose: vscode.Disposable;
    constructor(
        readonly before: vscode.TextEditorDecorationType,
        readonly after: vscode.TextEditorDecorationType,
        readonly nameTags: {
            default: vscode.TextEditorDecorationType,
            inverted: vscode.TextEditorDecorationType
        },
        readonly color: string
    ) {
        this.toDispose = vscode.Disposable.from(
            before, after,
            nameTags.default,
            nameTags.inverted,
        );
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    getThemeColor(): vscode.ThemeColor | undefined {
        return new vscode.ThemeColor(this.color);
    }
}

export const CollaborationInstanceFactory = Symbol('CollaborationInstanceFactory');

export const CollaborationInstanceOptions = Symbol('CollaborationInstanceOptions');

export interface CollaborationInstanceOptions {
    connection: ProtocolBroadcastConnection;
    host: boolean;
    hostId?: string;
    roomId: string;
}

export type CollaborationInstanceFactory = (options: CollaborationInstanceOptions) => CollaborationInstance;

@injectable()
export class CollaborationInstance implements vscode.Disposable {

    static Current: CollaborationInstance | undefined;

    private yjs: Y.Doc = new Y.Doc();
    private yjsAwareness = new awarenessProtocol.Awareness(this.yjs);
    private identity = new Deferred<types.Peer>();
    private toDispose = new DisposableCollection();
    protected yjsProvider: OpenCollaborationYjsProvider;
    private yjsMutex = new Mutex();
    private updates = new Set<string>();
    private documentDisposables = new Map<string, DisposableCollection>();
    private peers = new Map<string, DisposablePeer>();
    private throttles = new Map<string, () => void>();
    private fileSystem?: CollaborationFileSystemProvider;

    private _following?: string;
    get following(): string | undefined {
        return this._following;
    }

    private _ready = new Deferred<void>();
    get ready(): Promise<void> {
        return Promise.all([this._ready.promise, this.identity.promise]).then(() => { });
    }

    private readonly onDidUsersChangeEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidUsersChange: vscode.Event<void> = this.onDidUsersChangeEmitter.event;

    private readonly onDidDisposeEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidDispose: vscode.Event<void> = this.onDidDisposeEmitter.event;

    get connectedUsers(): Promise<PeerWithColor[]> {
        return this.ownUserData.then(own => {
            const all = Array.from(this.peers.values()).map(e => ({
                ...e.peer,
                color: e.decoration.color
            }) as PeerWithColor);
            all.push(own);
            return Array.from(all);
        });
    }

    get ownUserData(): Promise<types.Peer> {
        return this.identity.promise;
    }

    get host(): boolean {
        return this.options.host;
    }

    get roomId(): string {
        return this.options.roomId;
    }

    get connection(): ProtocolBroadcastConnection {
        return this.options.connection;
    }

    @inject(CollaborationInstanceOptions)
    private readonly options: CollaborationInstanceOptions;

    @postConstruct()
    protected init(): void {
        if (this.options.host) {
            // The host is always ready
            this._ready.resolve();
        }
        CollaborationInstance.Current = this;
        const connection = this.options.connection;
        this.yjsProvider = new OpenCollaborationYjsProvider(connection, this.yjs, this.yjsAwareness);
        this.yjsProvider.connect();
        this.toDispose.push(connection);
        this.toDispose.push(connection.onDisconnect(() => {
            this.dispose();
        }));
        this.toDispose.push(connection.onConnectionError(message => {
            vscode.window.showErrorMessage(vscode.l10n.t('Connection error: {0}', message));
        }));
        this.toDispose.push(connection.onReconnect(() => {
            // Reconnect the Yjs provider
            // This will resync all missed messages
            this.yjsProvider.connect();
        }));
        this.toDispose.push(this.yjsProvider);
        this.toDispose.push({
            dispose: () => {
                this.yjs.destroy();
                this.yjsAwareness.destroy();
            }
        });
        this.toDispose.push(this.onDidUsersChangeEmitter);
        this.toDispose.push(this.onDidDisposeEmitter);

        connection.peer.onJoinRequest(async (_, user) => {
            const message = vscode.l10n.t(
                'User {0} via {1} login wants to join the collaboration session',
                user.email ? `${user.name} (${user.email})` : user.name,
                user.authProvider ?? 'unknown'
            );
            const allow = vscode.l10n.t('Allow');
            const deny = vscode.l10n.t('Deny');
            const result = await vscode.window.showInformationMessage(message, allow, deny);
            const roots = vscode.workspace.workspaceFolders ?? [];
            return result === allow ? {
                workspace: {
                    name: vscode.workspace.name ?? 'Collaboration',
                    folders: roots.map(e => e.name)
                }
            } : {
                accessGranted: false,
                reason: 'Access denied'
            };
        });
        connection.peer.onInit(async (_, initData) => {
            await this.initialize(initData);
        });
        connection.room.onJoin(async (_, peer) => {
            if (this.host) {
                // Only initialize the user if we are the host
                const roots = vscode.workspace.workspaceFolders ?? [];
                const initData: types.InitData = {
                    protocol: types.VERSION,
                    host: await this.identity.promise,
                    guests: Array.from(this.peers.values()).map(e => e.peer),
                    capabilities: {},
                    permissions: { readonly: false },
                    workspace: {
                        name: vscode.workspace.name ?? 'Collaboration',
                        folders: roots.map(e => e.name)
                    }
                };
                connection.peer.init(peer.id, initData);
            }
            this.peers.set(peer.id, new DisposablePeer(this.yjsAwareness, peer));
            this.onDidUsersChangeEmitter.fire();
        });
        connection.room.onLeave(async (_, peer) => {
            const disposable = this.peers.get(peer.id);
            if (disposable) {
                disposable.dispose();
                this.peers.delete(peer.id);
                this.onDidUsersChangeEmitter.fire();
            }
            this.rerenderPresence();
        });
        connection.room.onClose(async () => {
            if (!this.options.host) {
                vscode.window.showInformationMessage(vscode.l10n.t('Collaboration session closed'));
                removeWorkspaceFolders();
                this.dispose();
            }
        });
        connection.peer.onInfo((_, peer) => {
            this.yjsAwareness.setLocalStateField('peer', peer.id);
            this.identity.resolve(peer);
            this.onDidUsersChangeEmitter.fire();
        });

        this.registerFileEvents();
        this.registerEditorEvents();
    }

    private registerFileEvents() {
        const connection = this.connection;
        connection.fs.onStat(async (_, path) => {
            const uri = CollaborationUri.getResourceUri(path);
            if (uri) {
                const stat = await vscode.workspace.fs.stat(uri);
                return {
                    type: stat.type === vscode.FileType.Directory ? types.FileType.Directory : types.FileType.File,
                    mtime: stat.mtime,
                    ctime: stat.ctime,
                    size: stat.size
                };
            } else {
                throw new Error('Could not stat file');
            }
        });
        connection.fs.onReaddir(async (_, path) => {
            const uri = CollaborationUri.getResourceUri(path);
            if (uri) {
                const result = await vscode.workspace.fs.readDirectory(uri);
                return result.reduce((acc, [name, type]) => { acc[name] = type; return acc; }, {} as types.FileSystemDirectory);
            } else {
                throw new Error('Could not read directory');
            }
        });
        connection.fs.onReadFile(async (_, path) => {
            const uri = CollaborationUri.getResourceUri(path);
            if (uri) {
                const content = await vscode.workspace.fs.readFile(uri);
                return {
                    content
                };
            } else {
                throw new Error('Could not read file');
            }
        });
        connection.fs.onDelete(async (_, path) => {
            const uri = CollaborationUri.getResourceUri(path);
            if (uri) {
                await vscode.workspace.fs.delete(uri, { recursive: true });
            } else {
                throw new Error('Could not delete file');
            }
        });
        connection.fs.onRename(async (_, oldPath, newPath) => {
            const oldUri = CollaborationUri.getResourceUri(oldPath);
            const newUri = CollaborationUri.getResourceUri(newPath);
            if (oldUri && newUri) {
                await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: true });
            } else {
                throw new Error('Could not rename file');
            }
        });
        connection.fs.onMkdir(async (_, path) => {
            const uri = CollaborationUri.getResourceUri(path);
            if (uri) {
                await vscode.workspace.fs.createDirectory(uri);
            } else {
                throw new Error('Could not create directory');
            }
        });
        connection.fs.onChange(async (_, changes) => {
            if (this.fileSystem) {
                const vscodeChanges: vscode.FileChangeEvent[] = [];
                for (const change of changes.changes) {
                    const uri = CollaborationUri.getResourceUri(change.path);
                    if (uri) {
                        vscodeChanges.push({
                            type: this.convertChangeType(change.type),
                            uri
                        });
                    }
                }
                this.fileSystem.triggerEvent(vscodeChanges);
            }
        });
        connection.fs.onWriteFile(async (_, path, content) => {
            const uri = CollaborationUri.getResourceUri(path);
            if (uri) {
                const document = this.findDocument(uri);
                if (document) {
                    const textContent = new TextDecoder().decode(content.content);
                    // In case the supplied content differs from the current document content, apply the change first
                    if (textContent !== document.getText()) {
                        await this.applyEdit(this.createFullDocumentEdit(document, textContent));
                    }
                    // Then save the document
                    await document.save();
                } else {
                    await vscode.workspace.fs.writeFile(uri, content.content);
                }
            }
        });
    }

    private convertChangeType(type: types.FileChangeEventType): vscode.FileChangeType {
        switch (type) {
            case types.FileChangeEventType.Create:
                return vscode.FileChangeType.Created;
            case types.FileChangeEventType.Delete:
                return vscode.FileChangeType.Deleted;
            case types.FileChangeEventType.Update:
                return vscode.FileChangeType.Changed;
        }
    }

    async leave(): Promise<void> {
        try {
            await this.connection.room.leave();
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch {
            // Connection is likely already disposed
        }
    }

    dispose(): void {
        CollaborationInstance.Current = undefined;
        this.peers.forEach(e => e.dispose());
        this.peers.clear();
        this.documentDisposables.forEach(e => e.dispose());
        this.documentDisposables.clear();
        this.onDidDisposeEmitter.fire();
        this.toDispose.dispose();
    }

    private pushDocumentDisposable(path: string, disposable: vscode.Disposable) {
        let disposables = this.documentDisposables.get(path);
        if (!disposables) {
            disposables = new DisposableCollection();
            this.documentDisposables.set(path, disposables);
        }
        disposables.push(disposable);
    }

    private registerEditorEvents() {

        this.connection.editor.onOpen(async (_, path) => {
            const uri = CollaborationUri.getResourceUri(path);
            if (uri) {
                await vscode.workspace.openTextDocument(uri);
            } else {
                throw new Error('Could not open file');
            }
        });

        vscode.workspace.textDocuments.forEach(document => {
            if (!this.isNotebookCell(document)) {
                this.registerTextDocument(document);
            }
        });

        this.toDispose.push(vscode.workspace.onDidOpenTextDocument(document => {
            if (!this.isNotebookCell(document)) {
                this.registerTextDocument(document);
            }
        }));

        this.toDispose.push(vscode.workspace.onDidChangeTextDocument(event => {
            if (!this.isNotebookCell(event.document)) {
                this.updateTextDocument(event);
            }
        }));

        this.toDispose.push(vscode.window.onDidChangeVisibleTextEditors(() => {
            this.updateTextSelection(vscode.window.activeTextEditor);
            this.rerenderPresence();
        }));

        this.toDispose.push(vscode.workspace.onDidCloseTextDocument(document => {
            const uri = document.uri.toString();
            this.documentDisposables.get(uri)?.dispose();
            this.documentDisposables.delete(uri);
        }));

        this.toDispose.push(vscode.window.onDidChangeTextEditorSelection(event => {
            this.updateTextSelection(event.textEditor);
        }));
        this.toDispose.push(vscode.window.onDidChangeTextEditorVisibleRanges(event => {
            this.updateTextSelection(event.textEditor);
        }));

        if (this.host) {
            // Only the host should create the watcher
            this.createFileWatcher();
        }

        const awarenessDebounce = debounce(() => {
            this.rerenderPresence();
        }, 2000);

        this.yjsAwareness.on('change', async (_: any, origin: string) => {
            if (origin !== LOCAL_ORIGIN) {
                this.updateFollow();
                this.rerenderPresence();
                awarenessDebounce();
            }
        });
    }

    protected createFileWatcher(): void {
        // Batch all changes and send them in one go
        // We don't want to send hundreds of messages in case of multiple changes in a short time
        // However, we also don't want to wait too long to send the changes. This will send the changes every 100ms
        const queue: types.FileChange[] = [];
        const sendChanges = throttle(() => {
            const changes = queue.splice(0, queue.length);
            this.connection.fs.change({ changes });
        }, 100, {
            leading: false,
            trailing: true
        });
        const pushChange = (uri: vscode.Uri, type: types.FileChangeEventType) => {
            const path = CollaborationUri.getProtocolPath(uri);
            if (path) {
                queue.push({
                    path,
                    type
                });
                sendChanges();
            }
        };
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        watcher.onDidChange(uri => pushChange(uri, types.FileChangeEventType.Update));
        watcher.onDidCreate(uri => pushChange(uri, types.FileChangeEventType.Create));
        watcher.onDidDelete(uri => pushChange(uri, types.FileChangeEventType.Delete));
        this.toDispose.push(watcher);
    }

    protected isNotebookCell(doc: vscode.TextDocument): boolean {
        return doc.uri.scheme === 'vscode-notebook-cell';
    }

    followUser(id?: string) {
        this._following = id;
        this.updateFollow();
    }

    protected updateFollow(): void {
        if (this._following) {
            let userState: types.ClientAwareness | undefined = undefined;
            const states = this.yjsAwareness.getStates() as Map<number, types.ClientAwareness>;
            for (const state of states.values()) {
                const peer = this.peers.get(state.peer);
                if (peer?.peer.id === this._following) {
                    userState = state;
                }
            }
            if (userState) {
                if (types.ClientTextSelection.is(userState.selection)) {
                    this.followSelection(userState.selection);
                }
            }
        }
    }

    protected async followSelection(selection: types.ClientTextSelection): Promise<void> {
        const uri = CollaborationUri.getResourceUri(selection.path);
        if (uri && selection.visibleRanges && selection.visibleRanges.length > 0) {
            let editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
            if (!editor) {
                const document = await vscode.workspace.openTextDocument(uri);
                editor = await vscode.window.showTextDocument(document);
            }
            const visibleRange = selection.visibleRanges[0];
            const range = new vscode.Range(visibleRange.start.line, visibleRange.start.character, visibleRange.end.line, visibleRange.end.character);
            editor.revealRange(range);
        }
    }

    protected updateTextSelection(editor?: vscode.TextEditor): void {
        if (!editor) {
            this.setSharedSelection(undefined);
            return;
        }
        const uri = editor.document.uri;
        const path = CollaborationUri.getProtocolPath(uri);
        if (path) {
            const ytext = this.yjs.getText(path);
            const selections: types.RelativeTextSelection[] = [];
            for (const selection of editor.selections) {
                const start = editor.document.offsetAt(selection.start);
                const end = editor.document.offsetAt(selection.end);
                const direction = selection.isReversed
                    ? types.SelectionDirection.RightToLeft
                    : types.SelectionDirection.LeftToRight;
                const editorSelection: types.RelativeTextSelection = {
                    start: Y.createRelativePositionFromTypeIndex(ytext, start),
                    end: Y.createRelativePositionFromTypeIndex(ytext, end),
                    direction
                };
                selections.push(editorSelection);
            }
            const textSelection: types.ClientTextSelection = {
                path,
                textSelections: selections,
                visibleRanges: editor.visibleRanges.map(range => ({
                    start: {
                        line: range.start.line,
                        character: range.start.character
                    },
                    end: {
                        line: range.end.line,
                        character: range.end.character
                    }
                }))
            };
            this.setSharedSelection(textSelection);
        } else {
            this.setSharedSelection(undefined);
        }
    }

    protected registerTextDocument(document: vscode.TextDocument): void {
        const uri = document.uri;
        const path = CollaborationUri.getProtocolPath(uri);
        if (path) {
            const text = document.getText();
            const yjsText = this.yjs.getText(path);
            if (this.host) {
                this.yjs.transact(() => {
                    yjsText.delete(0, yjsText.length);
                    yjsText.insert(0, text);
                });
            } else {
                this.options.connection.editor.open(this.options.hostId, path);
            }
            const resyncThrottle = this.getOrCreateThrottle(path);
            const observer = (textEvent: Y.YTextEvent) => {
                const document = this.findDocument(uri);
                if (textEvent.transaction.local || !document || yjsText.toString() === document.getText()) {
                    // Ignore own events or if the document is already in sync
                    return;
                }
                let index = 0;
                const edit = new vscode.WorkspaceEdit();
                textEvent.delta.forEach(delta => {
                    if (typeof delta.retain === 'number') {
                        index += delta.retain;
                    } else if (typeof delta.insert === 'string') {
                        const pos = document.positionAt(index);
                        edit.insert(uri, pos, delta.insert);
                        index += delta.insert.length;
                    } else if (typeof delta.delete === 'number') {
                        const pos = document.positionAt(index);
                        const endPos = document.positionAt(index + delta.delete);
                        const range = new vscode.Range(pos.line, pos.character, endPos.line, endPos.character);
                        edit.delete(uri, range);
                    }
                });
                this.yjsMutex.runExclusive(async () => {
                    this.updates.add(path);
                    await this.applyEdit(edit);
                    this.updates.delete(path);
                    resyncThrottle();
                }, 1000);
            };
            yjsText.observe(observer);
            this.pushDocumentDisposable(path, { dispose: () => yjsText.unobserve(observer) });
        }
    }

    protected updateTextDocument(event: vscode.TextDocumentChangeEvent): void {
        const uri = event.document.uri;
        const path = CollaborationUri.getProtocolPath(uri);
        if (path) {
            if (this.updates.has(path)) {
                return;
            }
            const ytext = this.yjs.getText(path);
            this.yjsMutex.runExclusive(() => {
                this.yjs.transact(() => {
                    for (const change of event.contentChanges) {
                        ytext.delete(change.rangeOffset, change.rangeLength);
                        ytext.insert(change.rangeOffset, change.text);
                    }
                });
                this.getOrCreateThrottle(path)();
            }, 500);
        }
    }

    private getOrCreateThrottle(path: string): () => void {
        let value = this.throttles.get(path);
        const uri = CollaborationUri.getResourceUri(path);
        if (uri && !value) {
            value = debounce(() => {
                this.yjsMutex.runExclusive(async () => {
                    const document = this.findDocument(uri);
                    if (document) {
                        const yjsText = this.yjs.getText(path);
                        const newContent = yjsText.toString();
                        if (newContent !== document.getText()) {
                            this.updates.add(path);
                            await this.applyEdit(this.createFullDocumentEdit(document, newContent));
                            this.updates.delete(path);
                        }
                    }
                });
            }, 200);
            this.throttles.set(path, value);
        } else {
            console.error('Could not determine URI for path', path);
            value = () => { };
        }
        return value;
    }

    private async applyEdit(edit: vscode.WorkspaceEdit): Promise<boolean> {
        if (this.host) {
            return await vscode.workspace.applyEdit(edit);
        } else {
            const entries = edit.entries();
            if (entries.length > 1) {
                throw new Error('Only one file should be edited at a time!');
            }
            for (const [uri] of entries) {
                if (!this.findDocument(uri)) {
                    return false;
                }
            }
            return await vscode.workspace.applyEdit(edit);
        }
    }

    private findDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
        return vscode.workspace.textDocuments.find(e => e.uri.toString() === uri.toString());
    }

    private createFullDocumentEdit(document: vscode.TextDocument, content: string): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const startPosition = new vscode.Position(0, 0);
        const endPosition = document.lineAt(document.lineCount - 1).range.end;
        edit.replace(document.uri, new vscode.Range(startPosition, endPosition), content);
        return edit;
    }

    protected rerenderPresence() {
        const states = this.yjsAwareness.getStates() as Map<number, types.ClientAwareness>;
        for (const [clientID, state] of states.entries()) {
            if (clientID === this.yjs.clientID) {
                // Ignore own awareness state
                continue;
            }
            const peerId = state.peer;
            const peer = this.peers.get(peerId);
            if (!state.selection || !peer) {
                continue;
            }
            if (types.ClientTextSelection.is(state.selection)) {
                this.renderTextPresence(peer, state.selection);
            }
        }
    }

    protected renderTextPresence(peer: DisposablePeer, selection: types.ClientTextSelection): void {
        const nameTagVisible = peer.lastUpdated !== undefined && Date.now() - peer.lastUpdated < 1900;
        const { path, textSelections } = selection;
        const uri = CollaborationUri.getResourceUri(path);
        const editorsToRemove = new Set(vscode.window.visibleTextEditors);
        if (uri) {
            const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === uri.toString());
            if (editors.length > 0) {
                const model = editors[0].document;
                const afterRanges: vscode.Range[] = [];
                const beforeRanges: vscode.Range[] = [];
                const beforeNameTags: vscode.Range[] = [];
                const beforeInvertedNameTags: vscode.Range[] = [];
                for (const selection of textSelections) {
                    const forward = selection.direction === 1;
                    const startIndex = Y.createAbsolutePositionFromRelativePosition(selection.start, this.yjs);
                    const endIndex = Y.createAbsolutePositionFromRelativePosition(selection.end, this.yjs);
                    if (startIndex && endIndex) {
                        const start = model.positionAt(startIndex.index);
                        const end = model.positionAt(endIndex.index);
                        const inverted = (forward && end.line === 0) || (!forward && start.line === 0);
                        const range = new vscode.Range(start, end);
                        if (forward) {
                            afterRanges.push(range);
                            if (nameTagVisible) {
                                const endRange = new vscode.Range(end, end);
                                (inverted ? beforeInvertedNameTags : beforeNameTags).push(endRange);
                            }
                        } else {
                            beforeRanges.push(range);
                            if (nameTagVisible) {
                                const startRange = new vscode.Range(start, start);
                                (inverted ? beforeInvertedNameTags : beforeNameTags).push(startRange);
                            }
                        }
                    }
                }
                for (const editor of editors) {
                    editorsToRemove.delete(editor);
                    editor.setDecorations(peer.decoration.before, beforeRanges);
                    editor.setDecorations(peer.decoration.after, afterRanges);
                    editor.setDecorations(peer.decoration.nameTags.default, beforeNameTags);
                    editor.setDecorations(peer.decoration.nameTags.inverted, beforeInvertedNameTags);
                }
            }
        }
        for (const editor of editorsToRemove) {
            editor.setDecorations(peer.decoration.before, []);
            editor.setDecorations(peer.decoration.after, []);
            editor.setDecorations(peer.decoration.nameTags.default, []);
            editor.setDecorations(peer.decoration.nameTags.inverted, []);
        }
    }

    private setSharedSelection(selection?: types.ClientSelection): void {
        this.yjsAwareness.setLocalStateField('selection', selection);
    }

    protected createSelectionFromRelative(selection: types.RelativeTextSelection, model: vscode.TextDocument): vscode.Selection | undefined {
        const start = Y.createAbsolutePositionFromRelativePosition(selection.start, this.yjs);
        const end = Y.createAbsolutePositionFromRelativePosition(selection.end, this.yjs);
        if (start && end) {
            let anchor = model.positionAt(start.index);
            let head = model.positionAt(end.index);
            if (selection.direction === types.SelectionDirection.RightToLeft) {
                [anchor, head] = [head, anchor];
            }
            return new vscode.Selection(anchor, head);
        }
        return undefined;
    }

    protected createRelativeSelection(selection: vscode.Selection, model: vscode.TextDocument, ytext: Y.Text): types.RelativeTextSelection {
        const start = Y.createRelativePositionFromTypeIndex(ytext, model.offsetAt(selection.start));
        const end = Y.createRelativePositionFromTypeIndex(ytext, model.offsetAt(selection.end));
        return {
            start,
            end,
            direction: selection.isReversed ? types.SelectionDirection.RightToLeft : types.SelectionDirection.LeftToRight
        };
    }

    async initialize(data: types.InitData): Promise<void> {
        for (const peer of [data.host, ...data.guests]) {
            this.peers.set(peer.id, new DisposablePeer(this.yjsAwareness, peer));
        }
        this.fileSystem = new CollaborationFileSystemProvider(this.options.connection, this.yjs, data.host);
        this.toDispose.push(vscode.workspace.registerFileSystemProvider('oct', this.fileSystem));
        this.onDidUsersChangeEmitter.fire();
        this._ready.resolve();
    }
}
