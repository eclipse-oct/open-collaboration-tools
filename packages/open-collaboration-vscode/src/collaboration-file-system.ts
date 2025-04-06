// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import * as vscode from 'vscode';
import * as Y from 'yjs';
import { CollaborationUri } from './utils/uri';

export class FileSystemManager implements vscode.Disposable {

    private providerRegistration?: vscode.Disposable;
    private fileSystemProvider: CollaborationFileSystemProvider;
    private readOnly = false;

    constructor(connection: ProtocolBroadcastConnection, yjs: Y.Doc, hostId: string) {
        this.fileSystemProvider = new CollaborationFileSystemProvider(connection, yjs, hostId);
    }

    registerFileSystemProvider(readOnly: boolean): void {
        if (this.providerRegistration) {
            if (this.readOnly === readOnly) {
                return;
            }
            // If we find that the readonly mode has changed, simply unregister the provider
            this.providerRegistration.dispose();
        }
        this.readOnly = readOnly;
        // Register the provider with the new readonly mode
        // Note that this is only called by guests, as the host is always using his native file system
        this.providerRegistration = vscode.workspace.registerFileSystemProvider(CollaborationUri.SCHEME, this.fileSystemProvider, { isReadonly: readOnly });
    }

    triggerChangeEvent(changes: vscode.FileChangeEvent[]): void {
        this.fileSystemProvider.triggerChangeEvent(changes);
    }

    dispose() {
        this.providerRegistration?.dispose();
    }

}

export class CollaborationFileSystemProvider implements vscode.FileSystemProvider {

    private connection: ProtocolBroadcastConnection;
    private yjs: Y.Doc;
    private hostId: string;

    private encoder = new TextEncoder();

    private onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    constructor(connection: ProtocolBroadcastConnection, yjs: Y.Doc, hostId: string) {
        this.connection = connection;
        this.yjs = yjs;
        this.hostId = hostId;
    }

    onDidChangeFile = this.onDidChangeFileEmitter.event;
    watch(): vscode.Disposable {
        return vscode.Disposable.from();
    }
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const path = this.getHostPath(uri);
        const stat = await this.connection.fs.stat(this.hostId, path);
        return stat;
    }
    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const path = this.getHostPath(uri);
        const record = await this.connection.fs.readdir(this.hostId, path);
        return Object.entries(record);
    }
    createDirectory(uri: vscode.Uri): Promise<void> {
        const path = this.getHostPath(uri);
        return this.connection.fs.mkdir(this.hostId, path);
    }
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const path = this.getHostPath(uri);
        if (this.yjs.share.has(path)) {
            const stringValue = this.yjs.getText(path);
            return this.encoder.encode(stringValue.toString());
        } else {
            const file = await this.connection.fs.readFile(this.hostId, path);
            return file.content;
        }
    }
    writeFile(uri: vscode.Uri, content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean; }): void {
        const path = this.getHostPath(uri);
        this.connection.fs.writeFile(this.hostId, path, { content });
    }
    delete(uri: vscode.Uri, _options: { readonly recursive: boolean; }): Promise<void> {
        return this.connection.fs.delete(this.hostId, this.getHostPath(uri));
    }
    rename(oldUri: vscode.Uri, newUri: vscode.Uri, _options: { readonly overwrite: boolean; }): Promise<void> {
        return this.connection.fs.rename(this.hostId, this.getHostPath(oldUri), this.getHostPath(newUri));
    }

    triggerChangeEvent(changes: vscode.FileChangeEvent[]): void {
        this.onDidChangeFileEmitter.fire(changes);
    }

    protected getHostPath(uri: vscode.Uri): string {
        // When creating a URI as a guest, we always prepend it with the name of the workspace
        // This just removes the workspace name from the path to get the path expected by the protocol
        const path = uri.path.substring(1).split('/');
        return path.slice(1).join('/');
    }
}
