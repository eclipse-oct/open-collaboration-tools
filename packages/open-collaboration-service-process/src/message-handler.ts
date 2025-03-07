// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type * as types from 'open-collaboration-protocol';
import { CloseSessionRequest, CreateRoomRequest, InternalError, JoinRoomRequest, LoginRequest, OCPBroadCast, OCPNotification, OCPRequest, OpenDocument, UpdateDocumentContent, UpdateTextSelection } from './messages';
import { CollaborationInstance } from './collaboration-instance';
import { MessageConnection } from 'vscode-jsonrpc';

export class MessageHandler {

    protected currentCollaborationInstance?: CollaborationInstance;

    protected lastRequestId = 0;

    constructor(private connectionProvider: types.ConnectionProvider, private communcationHandler: MessageConnection) {
        communcationHandler.onRequest(LoginRequest, async () => this.login());
        communcationHandler.onRequest(JoinRoomRequest, async (params) => await this.joinRoom(...params));
        communcationHandler.onRequest(CreateRoomRequest, async (params) => await this.createRoom(...params));
        communcationHandler.onRequest(CloseSessionRequest, () => this.currentCollaborationInstance?.currentConnection.dispose());
        communcationHandler.onNotification(OpenDocument, (params) => this.currentCollaborationInstance?.registerYjsObject(...params));
        communcationHandler.onNotification(UpdateTextSelection, (params) => this.currentCollaborationInstance?.updateYjsObjectSelection(params));
        communcationHandler.onNotification(UpdateDocumentContent, (params) => this.currentCollaborationInstance?.updateYjsObjectContent(params));
        communcationHandler.onError(([error, message]) => communcationHandler.sendNotification(InternalError, [message, error.stack]));

        communcationHandler.onRequest(OCPRequest, (message) =>
            this.currentCollaborationInstance?.currentConnection.sendRequest(message.method, message.target, ...message.params)
        );
        communcationHandler.onNotification(OCPNotification, async (message) =>
            this.currentCollaborationInstance?.currentConnection.sendNotification(message.method, message.target, ...message.params)
        );
        communcationHandler.onNotification(OCPBroadCast, async (message) =>
            this.currentCollaborationInstance?.currentConnection.sendBroadcast(message.method, ...message.params)
        );
    }

    async login(): Promise<[string]> {
        const authToken = await this.connectionProvider.login({ });
        return [authToken];
    }

    async joinRoom(roomId: string): Promise<[string, string]> {
        const resp = await this.connectionProvider.joinRoom({ roomId });
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), false);
        return [resp.roomId, resp.roomToken];
    }

    async createRoom(workspace: types.Workspace): Promise<[string, string]> {
        const resp = await this.connectionProvider.createRoom({});
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), true, workspace);
        return [resp.roomId, resp.roomToken];
    }

    onConnection(connection: types.ProtocolBroadcastConnection, host: boolean, workspace?: types.Workspace) {
        this.currentCollaborationInstance?.dispose();
        this.currentCollaborationInstance = new CollaborationInstance(connection, this.communcationHandler, host, workspace);
    }

    dispose() {
        this.currentCollaborationInstance?.dispose();
    }
}
