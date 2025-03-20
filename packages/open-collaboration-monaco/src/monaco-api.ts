// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ConnectionProvider, SocketIoTransportProvider } from 'open-collaboration-protocol';
import { CollaborationInstance, UsersChangeEvent } from './collaboration-instance.js';
import * as types from 'open-collaboration-protocol';
import { createRoom, joinRoom, login } from './collaboration-connection.js';
import * as monaco from 'monaco-editor';

let connectionProvider: ConnectionProvider | undefined;
// let userToken: string | undefined;
let instance: CollaborationInstance | undefined;

export type MonacoCollabCallbacks = {
    onUserRequestsAccess: (user: types.User) => Promise<boolean>;
}

export type MonacoCollabOptions = {
    serverUrl: string;
    callbacks: MonacoCollabCallbacks;
    userToken?: string;
    roomToken?: string;
    loginPageOpener?: (url: string, token: string) => void;
};

export type OtherUserData = {peer: types.Peer, color: string};
export type UserData = {me: types.Peer, others: OtherUserData[]};

export type MonacoCollabApi = {
    createRoom: () => Promise<string | undefined>
    joinRoom: (roomToken: string) => Promise<string | undefined>
    login: () => Promise<string | undefined>
    isLoggedIn: () => boolean
    setEditor: (editor: monaco.editor.IStandaloneCodeEditor) => void
    getUserData: () => Promise<UserData | undefined>
    onUsersChanged: (evt: UsersChangeEvent) => void
    followUser: (id?: string) => void
    getFollowedUser: () => string | undefined
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

        instance = await createRoom(connectionProvider, options.callbacks);
        if (instance) {
            return instance.roomToken;
        }
        return;
    };

    const doJoinRoom = async (roomToken: string) => {
        console.log('Joining room', roomToken);

        if (!connectionProvider) {
            console.log('No OCT Server configured.');
            return;
        }

        const res = await joinRoom(connectionProvider, options.callbacks, roomToken);
        if (res && 'message' in res) {
            console.log('Failed to join room:', res.message);
            return;
        } else {
            instance = res;
            return instance.roomToken;
        }
    };

    const doLogin = async () => {
        if (!connectionProvider) {
            console.log('No OCT Server configured.');
            return;
        }
        await login(connectionProvider);
        return connectionProvider.authToken;
    };

    const doSetEditor = (editor: monaco.editor.IStandaloneCodeEditor) => {
        if (instance) {
            instance.setEditor(editor);
        }
    };

    const doGetUserData = async () => {
        let data: UserData | undefined;
        if (instance) {
            const me: types.Peer = await instance.ownUserData;
            const others = instance.connectedUsers.map(
                user => ({
                    peer: user.peer,
                    color: user.color ?? 'rgba(0, 0, 0, 0.5)'
                }));
            data = {me, others};
        }
        return data;
    };

    const registerUserChangeHandler = (evt: UsersChangeEvent) => {
        if (instance) {
            instance.onUsersChanged(evt);
        }
    };

    const doFollowUser = (id?: string) => {
        if (instance) {
            instance.followUser(id);
        }
    };

    const doGetFollowedUser = () => {
        if (instance) {
            return instance.following;
        }
        return undefined;
    };

    return {
        createRoom: doCreateRoom,
        joinRoom: doJoinRoom,
        login: doLogin,
        isLoggedIn: () => !!connectionProvider?.authToken,
        setEditor: doSetEditor,
        getUserData: doGetUserData,
        onUsersChanged: registerUserChangeHandler,
        followUser: doFollowUser,
        getFollowedUser: doGetFollowedUser
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
