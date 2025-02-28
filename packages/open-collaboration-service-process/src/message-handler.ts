// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type * as types from 'open-collaboration-protocol';
import { Deferred, MaybePromise } from 'open-collaboration-protocol';
import { StdioCommunicationHandler } from './communication-handler';
import { CreateRoomRequest, JoinRoomRequest, LoginResponse, OCPMessage, OpenDocument, Response, SessionCreatedResponse, ToServiceMessages, UpdateDocumentContent, UpdateTextSelection, isOCPMessage } from './messages';
import { CollaborationInstance } from './collaboration-instance';

export class MessageHandler {

    protected openRequests = new Map<number, Deferred<unknown>>();

    protected handlers = new Map<string, (message: OCPMessage) => MaybePromise<void | unknown>>(
        [
            [ToServiceMessages.LOGIN, () => this.login()],
            [ToServiceMessages.JOIN_ROOM, message => this.joinRoom(message as JoinRoomRequest)],
            [ToServiceMessages.CREATE_ROOM, message => this.createRoom(message as CreateRoomRequest)],
            [ToServiceMessages.CLOSE_SESSION,  () => this.currentCollaborationInstance?.currentConnection.dispose()],
            [ToServiceMessages.OPEN_DOCUMENT, message => this.currentCollaborationInstance?.registerYjsObject(message as OpenDocument) ],
            [ToServiceMessages.UPDATE_TEXT_SELECTION, message => this.currentCollaborationInstance?.updateYjsObjectSelection(message as UpdateTextSelection)],
            [ToServiceMessages.UPDATE_DOCUMENT_CONTENT, message => this.currentCollaborationInstance?.updateYjsObjectContent(message as UpdateDocumentContent)],
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
                            if(!message.target) {
                                throw new Error(`Request target missing for request ${message.content.method}`);
                            }
                            return this.communcationHandler.sendMessage({
                                kind: 'response',
                                content: await this.currentCollaborationInstance?.currentConnection.sendRequest(message.content.method, message.target, message.content.params),
                                id: message.id
                            });
                        case 'notification':
                            if(!message.target) {
                                throw new Error(`Request target missing for notification ${message.content.method}`);
                            }
                            return this.currentCollaborationInstance?.currentConnection.sendNotification(message.content.method, message.target, message.content.params);
                        case 'broadcast':
                            return this.currentCollaborationInstance?.currentConnection.sendBroadcast(message.content.method, message.content.params);
                        default:
                            throw new Error('Unknown message kind');
                    }
                } else {
                    throw new Error(`Could not handle message with method ${message.content.method}`);
                }
            } catch (error: any) {
                console.error(error.stackTrace);
                communcationHandler.sendMessage({
                    kind: 'notification',
                    content: {
                        method: 'error',
                        params: [error.message, error?.stack]
                    }});
            }
        });
    }

    async login(): Promise<LoginResponse> {
        const authToken = await this.connectionProvider.login({ });
        return {
            method: 'login',
            params: [authToken]
        };
    }

    async joinRoom(message: JoinRoomRequest): Promise<SessionCreatedResponse> {
        const resp = await this.connectionProvider.joinRoom({ roomId: message.params[0] });
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), false);
        return {
            method: 'room/joinRoom',
            params: [resp.roomToken, resp.roomId]
        };
    }

    async createRoom(message: CreateRoomRequest): Promise<SessionCreatedResponse> {
        const resp = await this.connectionProvider.createRoom({});
        this.onConnection(await this.connectionProvider.connect(resp.roomToken), true, message.params[0]);
        return {
            method: 'room/createRoom',
            params: [resp.roomToken, resp.roomId]

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
