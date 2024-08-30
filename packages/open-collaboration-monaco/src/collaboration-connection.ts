import { ConnectionProvider, CreateRoomResponse, JoinResponse, JoinRoomResponse } from "open-collaboration-protocol";
import { CollaborationInstance } from "./collaboration-instance";
import { MonacoCollabCallbacks } from "./monaco-api";
import * as monaco from 'monaco-editor';

export async function login (connectionProvider: ConnectionProvider): Promise<void> {
    const valid = await connectionProvider.validate();
    if (!valid) {
        await connectionProvider.login();
    }
}

export async function createRoom(connectionProvider: ConnectionProvider, callbacks: MonacoCollabCallbacks, editor: monaco.editor.IStandaloneCodeEditor): Promise<CollaborationInstance | undefined> {
    if (!connectionProvider) {
        return undefined;
    }
    const roomClaim = await connectionProvider.createRoom();
    if (roomClaim.loginToken) {
        const userToken = roomClaim.loginToken;
        console.log('User Token:', userToken);
        // TODO store user token somewhere
        // await context.secrets.store('oct.userToken', userToken);
    }

    console.log('Room ID:', roomClaim.roomId);
    return await connectToRoom(connectionProvider, roomClaim, true, callbacks, editor);
}

export async function joinRoom(connectionProvider: ConnectionProvider, callbacks: MonacoCollabCallbacks, editor: monaco.editor.IStandaloneCodeEditor, roomId?: string): Promise<JoinResponse | undefined> {
    if (!roomId) {
        console.log('No room ID provided');
        // TODO show input box to enter the room ID
        // roomId = await vscode.window.showInputBox({ placeHolder: 'Enter the room ID' })
    }
    if (roomId && connectionProvider) {
        const roomClaim = await connectionProvider.joinRoom(roomId);
        if(roomClaim.accessGranted === false) {
            console.log('Access denied:', roomClaim.reason);
            // TODO show notification with the reason
            return {
                    accessGranted: false,
                    reason: roomClaim.reason
            };
        }
        const instance = await connectToRoom(connectionProvider, roomClaim, false, callbacks, editor);
        if (!instance) {
            console.log('No collaboration instance found');
            return;
        }
        const workspace = roomClaim.workspace;
        console.log('Workspace:', workspace);
        return {
            accessGranted: true,
            workspace: workspace
        };
    }
    return;
}

async function connectToRoom(connectionProvider: ConnectionProvider, roomClaim: CreateRoomResponse | JoinRoomResponse, isHost: boolean, callbacks: MonacoCollabCallbacks, editor: monaco.editor.IStandaloneCodeEditor) {
    const host = 'host' in roomClaim ? roomClaim.host : undefined;
    const connection = await connectionProvider.connect(roomClaim.roomToken, host);
    const instance = new CollaborationInstance({
        connection,
        host: isHost,
        roomToken: roomClaim.roomId,
        hostId: host?.id,
        callbacks,
        editor
    });
    connection.onDisconnect(() => {
        instance?.dispose();
    });
    // await instance.initialize();
    return instance;
}
