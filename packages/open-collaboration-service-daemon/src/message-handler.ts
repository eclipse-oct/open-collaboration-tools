// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type * as types from 'open-collaboration-protocol';
import { Deferred, MaybePromise } from 'open-collaboration-protocol';
import { StdioCommunicationHandler } from './communication-handler';
import { CreateRoomRequest, FromDaeomonMessage, JoinRoomRequest, LoginResponse, SendBroadcast, SendNotification, SendRequest, SendResponse, SessionCreated, ToDaemonMessage } from './messages';
import { CollaborationInstance } from './collaboration-instance';

export class MessageHandler {

    protected openRequests = new Map<number, Deferred<unknown>>();

    protected handlers = new Map<string, (message: ToDaemonMessage) => MaybePromise<void | FromDaeomonMessage>>(
        [
            ['login', () => this.login()],
            ['join-room', message => this.joinRoom(message as JoinRoomRequest)],
            ['create-room', message => this.createRoom(message as CreateRoomRequest)],
            // when connection is established
            ['send-request', async message => (await this.sendRequest(message as SendRequest)).request],
            ['send-response', message => { this.openRequests.get((message as SendResponse).id)?.resolve((message as SendResponse).response); }],
            ['send-broadcast', message => this.currentCollaborationInstance?.currentConnection.sendBroadcast((message as SendBroadcast).broadcast.type, (message as SendBroadcast).broadcast.parameters)],
            ['send-notification', message => this.currentCollaborationInstance?.currentConnection.sendNotification((message as SendNotification).notification.type, (message as SendNotification).notification.parameters)],
            ['leave-session',  () => this.currentCollaborationInstance?.currentConnection.dispose()]
        ]
    );

    protected currentCollaborationInstance?: CollaborationInstance;

    protected lastRequestId = 0;

    constructor(private connectionProvider: types.ConnectionProvider, private communcationHandler: StdioCommunicationHandler) {
        communcationHandler.onMessage(async message => {
            try {
                const resp = await this.handlers.get(message.kind)?.(message);
                if (resp) {
                    this.communcationHandler.sendMessage(resp);
                }
            } catch (error: any) {
                communcationHandler.sendMessage({
                    kind: 'error',
                    message: error?.message
                });
            }
        });
    }

    async login(): Promise<LoginResponse> {
        const authToken = await this.connectionProvider.login({ });
        return {
            kind: 'login',
            authToken
        };
    }

    async joinRoom(message: JoinRoomRequest): Promise<SessionCreated> {
        const resp = await this.connectionProvider.joinRoom({ roomId: message.room});
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), false);
        return {
            kind: 'session',
            info: {
                roomToken: resp.roomToken,
                roomId: resp.roomId
            }
        };
    }

    async createRoom(message: CreateRoomRequest): Promise<SessionCreated> {
        const resp = await this.connectionProvider.createRoom({});
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), true, message.workspace);
        return {
            kind: 'session',
            info: {
                roomToken: resp.roomToken,
                roomId: resp.roomId
            }
        };
    }

    onConnection(connection: types.ProtocolBroadcastConnection, host: boolean, workspace?: types.Workspace) {
        this.currentCollaborationInstance?.dispose();
        this.currentCollaborationInstance = new CollaborationInstance(connection, host, workspace);
        this.currentCollaborationInstance.onSendMessage(async message => this.communcationHandler.sendMessage(message));
        this.currentCollaborationInstance.onSendRequest(async message => this.sendAndWaitForClient(message));
    }

    async sendRequest(message: SendRequest) {
        const resp = await this.currentCollaborationInstance?.currentConnection?.sendRequest(message.request.type, message.request.parameters);
        return {
            kind: 'response',
            request: resp,
            id: message.id
        };
    }

    async sendAndWaitForClient(messsage: any): Promise<unknown> {
        const id = this.lastRequestId++;
        messsage.id = id;
        this.communcationHandler.sendMessage(messsage);
        const deferred = new Deferred<unknown>();
        this.openRequests.set(id, deferred);
        return await deferred.promise;
    }

    dispose() {
        this.currentCollaborationInstance?.dispose();
    }
}