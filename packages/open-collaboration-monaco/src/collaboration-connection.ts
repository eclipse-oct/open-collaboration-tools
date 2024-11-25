// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ConnectionProvider, CreateRoomResponse, JoinRoomResponse, stringifyError } from 'open-collaboration-protocol';
import { CollaborationInstance } from './collaboration-instance.js';
import { MonacoCollabCallbacks } from './monaco-api.js';

export async function login(connectionProvider: ConnectionProvider): Promise<void> {
    const valid = await connectionProvider.validate();
    if (!valid) {
        await connectionProvider.login({});
    }
}

export async function createRoom(connectionProvider: ConnectionProvider, callbacks: MonacoCollabCallbacks): Promise<CollaborationInstance | undefined> {
    if (!connectionProvider) {
        return undefined;
    }
    const roomClaim = await connectionProvider.createRoom({});
    if (roomClaim.loginToken) {
        const userToken = roomClaim.loginToken;
        console.log('User Token:', userToken);
    }

    console.log('Room ID:', roomClaim.roomId);
    return await connectToRoom(connectionProvider, roomClaim, true, callbacks);
}

export async function joinRoom(connectionProvider: ConnectionProvider, callbacks: MonacoCollabCallbacks, roomId?: string): Promise<CollaborationInstance | {message: string}> {
    if (!roomId) {
        console.log('No room ID provided');
        // TODO show input box to enter the room ID
        // roomId = await vscode.window.showInputBox({ placeHolder: 'Enter the room ID' })
    }
    if (roomId && connectionProvider) {
        try {
            const roomClaim = await connectionProvider.joinRoom({roomId});
            const instance = await connectToRoom(connectionProvider, roomClaim, false, callbacks);
            if (!instance) {
                console.log('No collaboration instance found');
                return {message: 'Joining room failed'};
            }
            const workspace = roomClaim.workspace;
            console.log('Workspace:', workspace);
            return instance;
        } catch (error) {
            return {message: stringifyError(error)};
        }
    }
    return {message: 'No room ID provided'};
}

async function connectToRoom(connectionProvider: ConnectionProvider, roomClaim: CreateRoomResponse | JoinRoomResponse, isHost: boolean, callbacks: MonacoCollabCallbacks) {
    const host = 'host' in roomClaim ? roomClaim.host : undefined;
    const connection = await connectionProvider.connect(roomClaim.roomToken, host);
    const instance = new CollaborationInstance({
        connection,
        host: isHost,
        roomToken: roomClaim.roomId,
        hostId: host?.id,
        callbacks
    });
    connection.onDisconnect(() => {
        instance?.dispose();
    });
    // await instance.initialize();
    return instance;
}
