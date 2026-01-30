// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as vscode from 'vscode';
import { Messenger } from 'vscode-messenger';
import { messageReceived, sendMessage } from './messages';
import { CollaborationInstance } from '../collaboration-instance';

export class ChatWebview implements vscode.WebviewViewProvider {
    static readonly viewType = 'oct.chatView';

    static register(extensionUri: vscode.Uri) {
        vscode.window.registerWebviewViewProvider(
            ChatWebview.viewType,
            new ChatWebview(extensionUri)
        );
    }

    private messenger: Messenger;

    constructor(private readonly extensionUri: vscode.Uri) {
        this.messenger = new Messenger();
    }

    resolveWebviewView(webviewView: vscode.WebviewView): Thenable<void> | void {
        const extensionFolder = vscode.Uri.joinPath(this.extensionUri, 'dist');
        webviewView.webview.options = {
            enableScripts: true,
            enableCommandUris: true,
            localResourceRoots: [extensionFolder]
        };

        const scriptUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(extensionFolder, 'chat-webview.js')
        );

        const styleUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(extensionFolder, 'chat-webview.css')
        );

        webviewView.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Chat</title>
                <link href="${styleUri}" rel="stylesheet">
                <script src="${scriptUri}"></script>
            </head>
            <body>
                <div id="root" />
            </body>
            </html>
        `;

        webviewView.show();
        this.registerMessengerHandlers(webviewView);
    }

    registerMessengerHandlers(webview: vscode.WebviewView): void {
        const id = this.messenger.registerWebviewView(webview);

        this.messenger.onNotification(sendMessage, (message) => {
            CollaborationInstance.Current?.connection.chat.sendMessage(message.message);
        }, { sender: id });

        CollaborationInstance.Current?.connection.chat.onMessage(async (userId, message) => {
            const user = (await CollaborationInstance.Current?.connectedUsers)?.find(u => u.id === userId);
            this.messenger.sendNotification(messageReceived, id, { message, user: user?.name ?? 'unkown user', color: user?.color});
        });
    }

}
