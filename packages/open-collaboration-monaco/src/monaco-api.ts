// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ConnectionProvider, SocketIoTransportProvider } from 'open-collaboration-protocol';
import { CollaborationInstance } from './collaboration-instance';
import * as types from 'open-collaboration-protocol';
import { createRoom, joinRoom, login } from './collaboration-connection';

let connectionProvider: ConnectionProvider | undefined;
// let userToken: string | undefined;
let instance: CollaborationInstance | undefined;

export type MonacoCollabCallbacks = {
    onRoomCreated?: (roomToken: string) => void;
    onRoomJoined?: (roomToken: string) => void;
    onUserRequestsAccess: (user: types.User) => Promise<boolean>;
    onUsersChanged: () => void;
}

export type MonacoCollabOptions = {
    serverUrl: string;
    callbacks: MonacoCollabCallbacks;
    userToken?: string;
    roomToken?: string;
    loginPageOpener?: () => void
};

export type MonacoCollabApi = {
    createRoom: () => Promise<CollaborationInstance | undefined>
    joinRoom: (roomToken: string) => Promise<CollaborationInstance | {message: string} | undefined>
    login: () => Promise<string | undefined>
    isLoggedIn: () => boolean
}

export function monacoCollab(options: MonacoCollabOptions): MonacoCollabApi {
    connectionProvider = new ConnectionProvider({
        url: options.serverUrl,
        opener: options.loginPageOpener ?? ((url) => window.open(url, '_blank')),
        transports: [SocketIoTransportProvider],
        userToken: options.userToken,
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

    const doCreateRoom = async () => {
        console.log('Creating room');

        if (!connectionProvider) {
            console.log('No OCT Server configured.');
            return;
        }

        return await createRoom(connectionProvider, options.callbacks);
    };

    const doJoinRoom = async (roomToken: string) => {
        console.log('Joining room', roomToken);

        if (!connectionProvider) {
            console.log('No OCT Server configured.');
            return;
        }

        return await joinRoom(connectionProvider, options.callbacks, roomToken);
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
        login: doLogin,
        isLoggedIn: () => !!connectionProvider?.authToken
    };

}

export function deactivate() {
    instance?.dispose();
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
