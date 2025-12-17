// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Deferred, ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import * as vscode from 'vscode';
import * as Y from 'yjs';
import { CollaborationUri } from './utils/uri.js';
import { injectable } from 'inversify';

@injectable()
export class FileSystemManager implements vscode.Disposable {

    private providerRegistration?: vscode.Disposable;
    private fileSystemProvider: CollaborationFileSystemProvider;
    private readOnly = false;

    constructor() {
        this.fileSystemProvider = new CollaborationFileSystemProvider();
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

    initialize(content: ConnectionContent): void {
        this.fileSystemProvider.content.resolve(content);
    }

    triggerChangeEvent(changes: vscode.FileChangeEvent[]): void {
        this.fileSystemProvider.triggerChangeEvent(changes);
    }

    dispose() {
        this.providerRegistration?.dispose();
    }

}

interface ConnectionContent {
    connection: ProtocolBroadcastConnection;
    yjs: Y.Doc;
    hostId: string;
    folders: string[];
}

export class CollaborationFileSystemProvider implements vscode.FileSystemProvider {

    readonly content = new Deferred<ConnectionContent>();

    private encoder = new TextEncoder();

    private onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    onDidChangeFile = this.onDidChangeFileEmitter.event;
    watch(): vscode.Disposable {
        return vscode.Disposable.from();
    }
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        if (uri.path === '/') {
            // Root should return a directory representing the workspace
            return {
                type: vscode.FileType.Directory,
                ctime: 0,
                mtime: 0,
                size: 0
            };
        }
        const { hostId, connection } = await this.content.promise;
        const path = this.getHostPath(uri);
        const stat = await connection.fs.stat(hostId, path);
        return stat;
    }
    async readDirectory(uri: vscode.Uri): Promise<Array<[string, vscode.FileType]>> {
        const { hostId, connection, folders } = await this.content.promise;
        if (uri.path === '/') {
            // Root should return the list of workspace folders
            return folders.map(folder => [folder, vscode.FileType.Directory]);
        }
        const path = this.getHostPath(uri);
        const record = await connection.fs.readdir(hostId, path);
        return Object.entries(record);
    }
    async createDirectory(uri: vscode.Uri): Promise<void> {
        const path = this.getHostPath(uri);
        const { hostId, connection } = await this.content.promise;
        return connection.fs.mkdir(hostId, path);
    }
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const path = this.getHostPath(uri);
        const { hostId, connection, yjs } = await this.content.promise;
        if (yjs.share.has(path)) {
            const stringValue = yjs.getText(path);
            return this.encoder.encode(stringValue.toString());
        } else {
            const file = await connection.fs.readFile(hostId, path);
            return file.content;
        }
    }
    async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean; }): Promise<void> {
        const path = this.getHostPath(uri);
        const { hostId, connection } = await this.content.promise;
        await connection.fs.writeFile(hostId, path, { content });
    }
    async delete(uri: vscode.Uri, _options: { readonly recursive: boolean; }): Promise<void> {
        const { hostId, connection } = await this.content.promise;
        await connection.fs.delete(hostId, this.getHostPath(uri));
    }
    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, _options: { readonly overwrite: boolean; }): Promise<void> {
        const { hostId, connection } = await this.content.promise;
        await connection.fs.rename(hostId, this.getHostPath(oldUri), this.getHostPath(newUri));
    }

    triggerChangeEvent(changes: vscode.FileChangeEvent[]): void {
        this.onDidChangeFileEmitter.fire(changes);
    }

    protected getHostPath(uri: vscode.Uri): string {
        // Simply remove the leading slash
        return uri.path.substring(1);
    }
}
