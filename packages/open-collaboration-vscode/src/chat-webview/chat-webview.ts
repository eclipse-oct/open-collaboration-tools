// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as vscode from 'vscode';
import { Messenger } from 'vscode-messenger';
import { ChatMessage, getHistory, getUsers, isWriting, messageReceived, sendMessage, usersChanged } from './messages';
import { CollaborationInstance } from '../collaboration-instance';
import { WebviewIdMessageParticipant } from 'vscode-messenger-common';
import { inject, injectable } from 'inversify';
import { ExtensionContext } from '../inversify';
import { CollaborationRoomService } from '../collaboration-room-service';

@injectable()
export class ChatWebview implements vscode.WebviewViewProvider {
    static readonly viewType = 'oct.chatView';

    @inject(ExtensionContext)
    private readonly context: vscode.ExtensionContext;

    @inject(CollaborationRoomService)
    private readonly roomService: CollaborationRoomService;

    register() {
        vscode.window.registerWebviewViewProvider(ChatWebview.viewType, this);

        this.messenger = new Messenger();

        this.roomService.onDidJoinRoom(collabInstance => {
            collabInstance.connection.chat.onMessage(async (userId, message, isDirect) => {
                const user = (await CollaborationInstance.Current?.connectedUsers)?.find(u => u.id === userId);
                const messageObj: ChatMessage = { message, user: user?.name ?? 'unkown user', color: user?.color, isDirect };
                this.chatHistory.push(messageObj);

                if(this.currentWebviewId) {
                    this.messenger.sendNotification(messageReceived, this.currentWebviewId, messageObj);
                }
            });

            collabInstance.onDidUsersChange(async () => {
                if(this.currentWebviewId) {
                    this.messenger.sendNotification(usersChanged, this.currentWebviewId, await this.getOtherUsers());
                }
            });

            collabInstance.connection.chat.onIsWriting(async (userId) => {
                if(this.currentWebviewId) {
                    this.messenger.sendNotification(isWriting, this.currentWebviewId, userId);
                }
            });

            collabInstance.onDidDispose(() => {
                this.chatHistory = [];
            });
        });
    }

    private messenger: Messenger;

    private chatHistory: ChatMessage[] = [];

    private currentWebviewId?: WebviewIdMessageParticipant;

    resolveWebviewView(webviewView: vscode.WebviewView): Thenable<void> | void {
        const extensionFolder = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
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
        this.currentWebviewId = this.messenger.registerWebviewView(webview);

        this.messenger.onNotification(sendMessage, (message) => {
            this.chatHistory.push({ user: 'me', message: message.message, isDirect: !!message.target });
            if(message.target) {
                CollaborationInstance.Current?.connection.chat.sendDirectMessage(message.target, message.message);
            } else {
                CollaborationInstance.Current?.connection.chat.sendMessage(message.message);
            }
        }, { sender: this.currentWebviewId });

        this.messenger.onRequest(getHistory, () => {
            return this.chatHistory;
        }, { sender: this.currentWebviewId });

        this.messenger.onRequest(getUsers,
            () => this.getOtherUsers(),
            { sender: this.currentWebviewId });

        this.messenger.onNotification(isWriting, () => {
            CollaborationInstance.Current?.connection.chat.isWriting();
        }, { sender: this.currentWebviewId });
    }

    private async getOtherUsers() {
        const connectedUsers = await CollaborationInstance.Current?.connectedUsers;
        const ownUserId = (await CollaborationInstance.Current?.ownUserData)?.id;
        return connectedUsers?.filter(u => u.id !== ownUserId) ?? [];
    }

}
