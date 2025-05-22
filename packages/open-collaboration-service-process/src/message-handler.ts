// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as types from 'open-collaboration-protocol';
import { BinaryData, BinaryResponse, CloseSessionRequest, CreateRoomRequest, fromBinaryMessage, InternalError, JoinRoomRequest,
    LoginRequest, OpenDocument,
    SessionData, toBinaryMessage, UpdateDocumentContent, UpdateTextSelection } from './messages.js';
import { CollaborationInstance } from './collaboration-instance.js';
import { MessageConnection } from 'vscode-jsonrpc';

export class MessageHandler {

    protected currentCollaborationInstance?: CollaborationInstance;

    protected lastRequestId = 0;

    constructor(private octConnectionProvider: types.ConnectionProvider, private clientCommunication: MessageConnection) {
        clientCommunication.onRequest(LoginRequest, async () => this.login());
        clientCommunication.onRequest(JoinRoomRequest, this.joinRoom.bind(this));
        clientCommunication.onRequest(CreateRoomRequest, this.createRoom.bind(this));
        clientCommunication.onRequest(CloseSessionRequest, async () => {
            if(this.currentCollaborationInstance && !this.currentCollaborationInstance.isDisposed) {
                await this.currentCollaborationInstance?.leaveRoom();
                this.currentCollaborationInstance = undefined;
            }
        });
        clientCommunication.onNotification(OpenDocument, (p1, p2, p3) => this.currentCollaborationInstance?.registerYjsObject(p1, p2, p3));
        clientCommunication.onNotification(UpdateTextSelection, (p1, p2) => this.currentCollaborationInstance?.updateYjsObjectSelection(p1, p2));
        clientCommunication.onNotification(UpdateDocumentContent, (p1, p2) => this.currentCollaborationInstance?.updateYjsObjectContent(p1, p2));
        clientCommunication.onError(([error]) => clientCommunication.sendNotification(InternalError, {message: error.message, stack: error.stack}));

        clientCommunication.onRequest(async (method, params) => {
            console.log(params);
            if(!types.isArray(params) || params.length === 0 || typeof params[params.length - 1] !== 'string') {
                throw new Error(`Invalid parameters for non service process specific request with method: ${method}, missing target`);
            }

            const target = params[params.length - 1] as string;
            const messageParams = params.slice(0, params.length - 1).map((param) => {
                if(BinaryData.is(param)) {
                    return fromBinaryMessage(param.data);
                }
                return param;
            });

            const result = await this.currentCollaborationInstance?.octConnection.sendRequest(method, target, ...messageParams);

            return BinaryData.shouldConvert(result) ? {
                type: 'binaryData',
                method,
                data: toBinaryMessage(result),
            } as BinaryResponse : result;
        });
        clientCommunication.onNotification(async (method, params) => {
            if(!types.isArray(params) || params.length === 0 || typeof params[params.length - 1] !== 'string') {
                throw new Error(`Invalid parameters for non service process specific notification or broadcast with method: ${method}, missing target or 'broadcast'`);
            }

            const metaDataParam = params[params.length - 1];

            const messageParams = params.slice(0, params.length - 1).map((param) => {
                if(BinaryData.is(param)) {
                    return fromBinaryMessage(param.data);
                }
                return param;
            });;

            if(metaDataParam === 'broadcast') {
                this.currentCollaborationInstance?.octConnection.sendBroadcast(method, ...messageParams);
            } else {
                this.currentCollaborationInstance?.octConnection.sendNotification(method, metaDataParam, ...messageParams);
            }
        });
    }

    async login(): Promise<string> {
        try {
            const authToken = await this.octConnectionProvider.login({ });
            return authToken;
        } catch (error) {
            throw new Error(`Failed to login: ${error}`);
        }
    }

    async joinRoom(roomId: string): Promise<SessionData> {
        try {
            const resp = await this.octConnectionProvider.joinRoom({ roomId });
            this.onConnection(await this.octConnectionProvider.connect(resp.roomToken), false);
            return {
                roomId: resp.roomId,
                roomToken: resp.roomToken,
                authToken: resp.loginToken ?? this.octConnectionProvider.authToken,
                workspace: resp.workspace
            };
        } catch (error) {
            throw new Error(`Failed to join room: ${error}`);
        }
    }

    async createRoom(workspace: types.Workspace): Promise<SessionData> {
        try {
            const resp = await this.octConnectionProvider.createRoom({});
            this.onConnection(await this.octConnectionProvider.connect(resp.roomToken), true, workspace);
            return {
                roomId: resp.roomId,
                roomToken: resp.roomToken,
                authToken: resp.loginToken ?? this.octConnectionProvider.authToken,
                workspace,
            };
        } catch (error) {
            throw new Error(`Failed to create room: ${error}`);
        }
    }

    onConnection(connection: types.ProtocolBroadcastConnection, host: boolean, workspace?: types.Workspace) {
        this.currentCollaborationInstance?.dispose();
        this.currentCollaborationInstance = new CollaborationInstance(connection, this.clientCommunication, host, workspace);
    }

    dispose() {
        this.currentCollaborationInstance?.dispose();
    }

}
