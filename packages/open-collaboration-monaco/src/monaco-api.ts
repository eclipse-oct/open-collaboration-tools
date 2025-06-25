// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ConnectionProvider, SocketIoTransportProvider } from 'open-collaboration-protocol';
import { CollaborationInstance, UsersChangeEvent, FileNameChangeEvent } from './collaboration-instance.js';
import * as types from 'open-collaboration-protocol';
import { createRoom, joinRoom, login } from './collaboration-connection.js';
import * as monaco from 'monaco-editor';

let connectionProvider: ConnectionProvider | undefined;
let instance: CollaborationInstance | undefined;

types.initializeProtocol({
    cryptoModule: globalThis.crypto
});

export type MonacoCollabCallbacks = {
    onUserRequestsAccess: (user: types.User) => Promise<boolean>;
}

export type MonacoCollabOptions = {
    serverUrl: string;
    callbacks: MonacoCollabCallbacks;
    userToken?: string;
    roomToken?: string;
    useCookieAuth?: boolean;
    loginPageOpener?: (token: string, authenticationMetadata: types.AuthMetadata) => Promise<boolean>;
};

export type OtherUserData = {peer: types.Peer, color: string};
export type UserData = {me: types.Peer, others: OtherUserData[]};

export type MonacoCollabApi = {
    createRoom: () => Promise<string | undefined>
    joinRoom: (roomToken: string) => Promise<string | undefined>
    leaveRoom: () => void
    login: () => Promise<string | undefined>
    logout: () => Promise<void | undefined>
    isLoggedIn: () => Promise<boolean>
    setEditor: (editor: monaco.editor.IStandaloneCodeEditor) => void
    getUserData: () => Promise<UserData | undefined>
    onUsersChanged: (evt: UsersChangeEvent) => void
    onFileNameChange: (callback: FileNameChangeEvent) => void
    getCurrentConnection: () => types.ProtocolBroadcastConnection | undefined
    followUser: (id?: string) => void
    getFollowedUser: () => string | undefined
    setFileName: (fileName: string) => void
    getFileName: () => string | undefined
    setRoomName: (roomName: string) => void
    getRoomName: () => string | undefined
}

export function monacoCollab(options: MonacoCollabOptions): MonacoCollabApi {
    connectionProvider = new ConnectionProvider({
        url: options.serverUrl,
        authenticationHandler: options.loginPageOpener ?? (async (_token, metaData) => {
            // If this returns null, it means the window could not be opened and the authentication failed
            return window.open(metaData.loginPageUrl, '_blank') !== null;
        }),
        transports: [SocketIoTransportProvider],
        userToken: options.userToken,
        useCookieAuth: options.useCookieAuth,
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
            return instance.roomId;
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
            return instance.roomId;
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

    const doSetFileName = (fileName: string) => {
        if (instance) {
            instance.setFileName(fileName);
        }
    };

    const doGetRoomName = () => {
        if (instance) {
            return instance.roomName;
        }
        return undefined;
    };

    const doGetFileName = () => {
        if (instance) {
            return instance.fileName;
        }
        return undefined;
    };

    const registerFileNameChangeHandler = (callback: FileNameChangeEvent) => {
        if (instance) {
            instance.onFileNameChange(callback);
        }
    };

    const doSetRoomName = (roomName: string) => {
        if (instance) {
            instance.setRoomName(roomName);
        }
    };

    const isLoggedIn = async () => {
        if (!connectionProvider) {
            return false;
        }

        if (options.useCookieAuth) {
            const valid = await fetch(options.serverUrl + '/api/login/validate', {
                credentials: 'include',
                method: 'POST',
            });
            return valid.ok && (await valid.json())?.valid;
        } else {
            return !!connectionProvider.authToken;
        }
    };

    return {
        createRoom: doCreateRoom,
        joinRoom: doJoinRoom,
        leaveRoom: () => instance?.leaveRoom(),
        login: doLogin,
        logout: async () => connectionProvider?.logout(),
        isLoggedIn: isLoggedIn,
        setEditor: doSetEditor,
        getUserData: doGetUserData,
        onUsersChanged: registerUserChangeHandler,
        onFileNameChange: registerFileNameChangeHandler,
        followUser: doFollowUser,
        getFollowedUser: doGetFollowedUser,
        getCurrentConnection: () => instance?.getCurrentConnection(),
        setFileName: doSetFileName,
        getFileName: doGetFileName,
        getRoomName: doGetRoomName,
        setRoomName: doSetRoomName
    };

}

export function deactivate() {
    instance?.dispose();
}
