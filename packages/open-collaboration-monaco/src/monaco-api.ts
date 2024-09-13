// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as monaco from 'monaco-editor';
import { ConnectionProvider, SocketIoTransportProvider } from 'open-collaboration-protocol';
import { CollaborationInstance } from './collaboration-instance';
import * as types from 'open-collaboration-protocol';
import { createRoom, joinRoom, login } from './collaboration-connection';

let connectionProvider: ConnectionProvider | undefined;
let userToken: string | undefined;
let instance: CollaborationInstance | undefined;

export type MonacoCollabCallbacks = {
    onRoomCreated?: (roomToken: string) => void;
    onRoomJoined?: (roomToken: string) => void;
    onUserRequestsAccess: (user: types.User) => Promise<boolean>;
    onUsersChanged: () => void;
}

export type MonacoCollabOptions = {
    serverUrl: string;
    userToken?: string;
    roomToken?: string;
    callbacks: MonacoCollabCallbacks;
};

export type MonacoCollabApi = {
    createRoom: () => Promise<CollaborationInstance | undefined>
    joinRoom: (roomToken: string) => Promise<undefined | {message: string}>
    login: () => Promise<string | undefined>
}

export function monacoCollab(editor: monaco.editor.IStandaloneCodeEditor, options: MonacoCollabOptions): MonacoCollabApi {
    initializeConnection(options);

    const doCreateRoom = async () => {
        console.log('Creating room');

        if (!connectionProvider) {
            console.log('No OCT Server configured.');
            return;
        }

        return await createRoom(connectionProvider, options.callbacks, editor);
    };

    const doJoinRoom = async (roomToken: string) => {
        console.log('Joining room', roomToken);

        if (!connectionProvider) {
            console.log('No OCT Server configured.');
            return;
        }

        return await joinRoom(connectionProvider, options.callbacks, editor, roomToken);
    };

    const doLogin = async () => {
        if (!connectionProvider) {
            console.log('No OCT Server configured.');
            return;
        }
        await login(connectionProvider);
        return connectionProvider.authToken;
    };

    return {
        createRoom: doCreateRoom,
        joinRoom: doJoinRoom,
        login: doLogin
    };

}

export function deactivate() {
    instance?.dispose();
}

async function initializeConnection(options: MonacoCollabOptions) {
    const serverUrl = options.serverUrl;
    userToken = options.userToken;
    if (serverUrl) {
        connectionProvider = createConnectionProvider(serverUrl);
    }
}

function createConnectionProvider(url: string): ConnectionProvider {
    return new ConnectionProvider({
        url,
        opener: (url) => window.open(url, '_blank'), // vscode.env.openExternal(vscode.Uri.parse(url)),
        transports: [SocketIoTransportProvider],
        userToken,
        fetch: async (url, options) => {
            const response = await fetch(url, options);
            return {
                ok: response.ok,
                status: response.status,
                json: async () => response.json(),
                text: async () => response.text()
            };
        }
    });
}

// function removeWorkspaceFolders() {
//     const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
//     if (workspaceFolders.length > 0) {
//         const newFolders: vscode.WorkspaceFolder[] = [];
//         for (const folder of workspaceFolders) {
//             if (folder.uri.scheme !== CollaborationUri.SCHEME) {
//                 newFolders.push(folder);
//             }
//         }
//         vscode.workspace.updateWorkspaceFolders(0, workspaceFolders.length, ...newFolders);
//     }
// }
