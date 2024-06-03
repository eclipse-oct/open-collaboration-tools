import { ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import * as vscode from 'vscode';
import * as Y from 'yjs';

export class CollaborationFileSystemProvider implements vscode.FileSystemProvider {

    private connection: ProtocolBroadcastConnection;
    private yjs: Y.Doc;

    private encoder = new TextEncoder();

    private onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    constructor(connection: ProtocolBroadcastConnection, yjs: Y.Doc) {
        this.connection = connection;
        this.yjs = yjs;
    }

    onDidChangeFile = this.onDidChangeFileEmitter.event;
    watch(): vscode.Disposable {
        return vscode.Disposable.from();
    }
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const path = this.getHostPath(uri);
        return this.connection.fs.stat('', path);
    }
    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const path = this.getHostPath(uri);
        const record = await this.connection.fs.readdir('', path);
        return Object.entries(record);
    }
    createDirectory(uri: vscode.Uri): Promise<void> {
        const path = this.getHostPath(uri);
        return this.connection.fs.mkdir('', path);
    }
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const path = this.getHostPath(uri);
        if (this.yjs.share.has(path)) {
            const stringValue = this.yjs.getText(path);
            return this.encoder.encode(stringValue.toString());
        } else {
            // Attempt to stat the file to see if it exists on the host system
            await this.stat(uri);
            // Return an empty if the file exists
            // The respective yjs content will be created when the host opens the file
            return new Uint8Array();
        }
    }
    writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): void {
        // Do nothing
    }
    delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): Promise<void> {
        return this.connection.fs.delete('', this.getHostPath(uri));
    }
    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): Promise<void> {
        return this.connection.fs.rename('', this.getHostPath(oldUri), this.getHostPath(newUri));
    }

    triggerEvent(changes: vscode.FileChangeEvent[]): void {
        this.onDidChangeFileEmitter.fire(changes);
    }

    protected getHostPath(uri: vscode.Uri): string {
        const path = uri.path.substring(1).split('/');
        return path.slice(1).join('/');
    }
}