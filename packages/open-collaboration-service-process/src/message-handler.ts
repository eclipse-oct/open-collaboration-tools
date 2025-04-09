// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type * as types from 'open-collaboration-protocol';
import { BinaryResponse, CloseSessionRequest, CreateRoomRequest, fromEncodedOCPMessage, InternalError, JoinRoomRequest,
    LoginRequest, OCPBroadCast, OCPNotification, OCPRequest, OpenDocument,
    SessionData, toEncodedOCPMessage, UpdateDocumentContent, UpdateTextSelection } from './messages.js';
import { CollaborationInstance } from './collaboration-instance.js';
import { MessageConnection } from 'vscode-jsonrpc';

export class MessageHandler {

    protected currentCollaborationInstance?: CollaborationInstance;

    protected lastRequestId = 0;

    constructor(private connectionProvider: types.ConnectionProvider, private communicationHandler: MessageConnection) {
        communicationHandler.onRequest(LoginRequest, async () => this.login());
        communicationHandler.onRequest(JoinRoomRequest, this.joinRoom.bind(this));
        communicationHandler.onRequest(CreateRoomRequest, this.createRoom.bind(this));
        communicationHandler.onRequest(CloseSessionRequest, () => this.currentCollaborationInstance?.dispose());
        communicationHandler.onNotification(OpenDocument, (p1, p2, p3) => this.currentCollaborationInstance?.registerYjsObject(p1, p2, p3));
        communicationHandler.onNotification(UpdateTextSelection, (p1, p2) => this.currentCollaborationInstance?.updateYjsObjectSelection(p1, p2));
        communicationHandler.onNotification(UpdateDocumentContent, (p1, p2) => this.currentCollaborationInstance?.updateYjsObjectContent(p1, p2));
        communicationHandler.onError(([error]) => communicationHandler.sendNotification(InternalError, {message: error.message, stack: error.stack}));

        communicationHandler.onRequest(OCPRequest, async (rawMessage) => {
            const message = typeof rawMessage === 'string' ? fromEncodedOCPMessage(rawMessage) : rawMessage;
            const result = await this.currentCollaborationInstance?.currentConnection.sendRequest(message.method, message.target, ...message.params);

            return {
                type: 'binaryResponse',
                method: message.method,
                data: toEncodedOCPMessage(result),
            } as BinaryResponse;
        });
        communicationHandler.onNotification(OCPNotification, async (rawMessage) => {
            const message = typeof rawMessage === 'string' ? fromEncodedOCPMessage(rawMessage) : rawMessage;
            this.currentCollaborationInstance?.currentConnection.sendNotification(message.method, message.target, ...message.params);
        });
        communicationHandler.onNotification(OCPBroadCast, async (rawMessage) => {
            const message = typeof rawMessage === 'string' ? fromEncodedOCPMessage(rawMessage) : rawMessage;
            this.currentCollaborationInstance?.currentConnection.sendBroadcast(message.method, ...message.params);
        });
    }

    async login(): Promise<string> {
        const authToken = await this.connectionProvider.login({ });
        return authToken;
    }

    async joinRoom(roomId: string): Promise<SessionData> {
        const resp = await this.connectionProvider.joinRoom({ roomId });
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), false);
        return {
            roomId: resp.roomId,
            roomToken: resp.roomToken,
            authToken: resp.loginToken ?? this.connectionProvider.authToken,
            workspace: resp.workspace
        };
    }

    async createRoom(workspace: types.Workspace): Promise<SessionData> {
        const resp = await this.connectionProvider.createRoom({});
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), true, workspace);
        return {
            roomId: resp.roomId,
            roomToken: resp.roomToken,
            authToken: resp.loginToken ?? this.connectionProvider.authToken,
            workspace,
        };
    }

    onConnection(connection: types.ProtocolBroadcastConnection, host: boolean, workspace?: types.Workspace) {
        this.currentCollaborationInstance?.dispose();
        this.currentCollaborationInstance = new CollaborationInstance(connection, this.communicationHandler, host, workspace);
    }

    dispose() {
        this.currentCollaborationInstance?.dispose();
    }

}
