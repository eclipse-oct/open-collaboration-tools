import * as vscode from 'vscode';
import { ConnectionProvider } from 'open-collaboration-protocol';
import { JsonMessageEncoding, WebSocketTransportProvider } from 'open-collaboration-rpc';
import { WebSocket } from 'ws';
import { CollaborationInstance } from './collaboration-instance';
import fetch from 'node-fetch';
import { createRoom, joinRoom } from './collaboration-connection';

(global as any).WebSocket = WebSocket;

let connectionProvider: ConnectionProvider | undefined;
let userToken: string | undefined;
let instance: CollaborationInstance | undefined;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
    statusBarItem.text = '$(live-share) OCT';
    statusBarItem.command = 'oct.enter';
    statusBarItem.show();

    initializeConnection(context).then(value => instance = value);

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('oct.serverUrl')) {
            const newUrl = vscode.workspace.getConfiguration().get<string>('oct.serverUrl')
            connectionProvider = newUrl ? createConnectionProvider(newUrl) : undefined;
        }
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand('oct.enter', async () => {
            if (!connectionProvider) {
                vscode.window.showInformationMessage('No OCT Server configured. Please set the server URL in the settings', 'Open Settings').then((selection) => {
                    if (selection === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'oct.serverUrl');
                    }
                });
            } else if (instance) {
                // Add options to manage the room
            } else {
                const quickPick = vscode.window.createQuickPick();
                quickPick.placeholder = 'Select collaboration option';
                quickPick.items = [
                    { label: '$(add) Create New Collaboration Session' },
                    { label: '$(vm-connect) Join Collaboration Session' }
                ];
                const index = await showQuickPick(quickPick);
                if (index === 0) {
                    if (await createRoom(context, connectionProvider)) {
                        statusBarItem.text = '$(broadcast) OCT Shared';
                    }
                } else if (index === 1) {
                    await joinRoom(context, connectionProvider);
                }
            }
        })
    );
}

export function deactivate() {
}

function showQuickPick(quickPick: vscode.QuickPick<vscode.QuickPickItem>): Promise<number> {
    return new Promise((resolve) => {
        quickPick.show();
        quickPick.onDidAccept(() => {
            resolve(quickPick.items.indexOf(quickPick.activeItems[0]));
            quickPick.hide();
        });
        quickPick.onDidHide(() => {
            resolve(-1);
        });
    });
}

async function initializeConnection(context: vscode.ExtensionContext): Promise<CollaborationInstance | undefined> {
    const serverUrl = vscode.workspace.getConfiguration().get<string>('oct.serverUrl');
    userToken = await context.secrets.get('oct.userToken');

    if (serverUrl) {
        connectionProvider = createConnectionProvider(serverUrl);
        const roomToken = await context.secrets.get('oct.roomToken');
        if (roomToken) {
            await context.secrets.delete('oct.roomToken');
            const connection = await connectionProvider.connect(roomToken);
            const instance = new CollaborationInstance(connection, false);
            connection.onDisconnect(() => {
                instance?.dispose();
            });
            await instance.initialize();
            statusBarItem.text = '$(broadcast) OCT Shared';
            statusBarItem.show();
            return instance;
        }
    }
    await context.secrets.delete('oct.roomToken');
    return undefined;
}


function createConnectionProvider(url: string): ConnectionProvider {
    return new ConnectionProvider({
        url,
        opener: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
        transports: [WebSocketTransportProvider],
        encodings: [JsonMessageEncoding],
        userToken,
        fetch
    });
}