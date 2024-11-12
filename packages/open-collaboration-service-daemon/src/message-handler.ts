// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type * as types from 'open-collaboration-protocol';
import { Deferred, MaybePromise } from 'open-collaboration-protocol';
import { StdioCommunicationHandler } from './communication-handler';
import { CreateRoomRequest, JoinRoomRequest, LoginResponse, Response, SessionCreatedResponse, isOCPMessage } from './messages';
import { CollaborationInstance } from './collaboration-instance';

export class MessageHandler {

    protected openRequests = new Map<number, Deferred<unknown>>();

    protected handlers = new Map<string, (message: unknown) => MaybePromise<void | unknown>>(
        [
            ['login', () => this.login()],
            ['join-room', message => this.joinRoom(message as JoinRoomRequest)],
            ['create-room', message => this.createRoom(message as CreateRoomRequest)],
            ['close-session',  () => this.currentCollaborationInstance?.currentConnection.dispose()]
        ]
    );

    protected currentCollaborationInstance?: CollaborationInstance;

    protected lastRequestId = 0;

    constructor(private connectionProvider: types.ConnectionProvider, private communcationHandler: StdioCommunicationHandler) {
        communcationHandler.onMessage(async message => {
            try {
                if(message.kind === 'response') {
                    this.openRequests.get((message as Response).id)?.resolve((message as Response).content);
                    return;
                }
                const handler = this.handlers.get(message.content.method);
                if(handler) {
                    const resp = await handler(message.content);
                    if(message.kind === 'request') {
                        this.communcationHandler.sendMessage({
                            kind: 'response',
                            content: resp as any,
                            id: message.id
                        });
                    }
                } else if(!handler && isOCPMessage(message.content)) {
                    switch(message.kind) {
                        case 'request':
                            return this.communcationHandler.sendMessage({
                                kind: 'response',
                                content: await this.currentCollaborationInstance?.currentConnection.sendRequest(message.content.method, message.content.parameters),
                                id: message.id
                            });
                        case 'notification':
                            return this.currentCollaborationInstance?.currentConnection.sendNotification(message.content.method, message.content.parameters);
                        case 'broadcast':
                            return this.currentCollaborationInstance?.currentConnection.sendBroadcast(message.content.method, message.content.parameters);
                        default:
                            throw new Error('Unknown message kind');
                    }
                } else {
                    throw new Error(`Could not handle message with method ${message.content.method}`);
                }
            } catch (error: any) {
                communcationHandler.sendMessage({
                    kind: 'notification',
                    content: {
                        method: 'error',
                        message: error?.message
                    }});
            }
        });
    }

    async login(): Promise<LoginResponse> {
        const authToken = await this.connectionProvider.login({ });
        return {
            authToken
        };
    }

    async joinRoom(message: JoinRoomRequest): Promise<SessionCreatedResponse> {
        const resp = await this.connectionProvider.joinRoom({ roomId: message.room});
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), false);
        return {
            roomToken: resp.roomToken,
            roomId: resp.roomId
        };
    }

    async createRoom(message: CreateRoomRequest): Promise<SessionCreatedResponse> {
        const resp = await this.connectionProvider.createRoom({});
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), true, message.workspace);
        return {
            roomToken: resp.roomToken,
            roomId: resp.roomId
        };
    }

    onConnection(connection: types.ProtocolBroadcastConnection, host: boolean, workspace?: types.Workspace) {
        this.currentCollaborationInstance?.dispose();
        this.currentCollaborationInstance = new CollaborationInstance(connection, host, workspace);
        this.currentCollaborationInstance.onSendMessage(async message => this.communcationHandler.sendMessage(message));
        this.currentCollaborationInstance.onSendRequest(async message => this.sendAndWaitForClient(message));
    }

    async sendAndWaitForClient(messsage: any): Promise<unknown> {
        const id = this.lastRequestId++;
        this.communcationHandler.sendMessage({
            kind: 'request',
            content: messsage,
            id
        });
        const deferred = new Deferred<unknown>();
        this.openRequests.set(id, deferred);
        return await deferred.promise;
    }

    dispose() {
        this.currentCollaborationInstance?.dispose();
    }
}