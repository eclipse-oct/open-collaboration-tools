// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ConnectionProvider, MaybePromise } from 'open-collaboration-protocol';
import { StdioCommunicationHandler } from './communication-handler';
import { FromDaeomonMessage, JoinRoomRequest, LoginResponse, SessionCreated, ToDaemonMessage } from './messages';

export class MessageHandler {

    protected handlers = new Map<string, (message: ToDaemonMessage) => MaybePromise<void | FromDaeomonMessage>>(
        [
            ['login', () => this.login()],
            ['join-room', message => this.joinRoom(message as JoinRoomRequest)],
            ['create-room', () => this.createRoom()]
        ]
    );

    constructor(private connectionProvider: ConnectionProvider, private communcationHandler: StdioCommunicationHandler) {
        communcationHandler.onMessage(async message => {
            const resp = await this.handlers.get(message.kind)?.(message);
            if (resp) {
                this.communcationHandler.sendMessage(resp);
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
        return {
            kind: 'session',
            info: {
                roomToken: resp.roomToken
            }
        };
    }

    async createRoom(): Promise<SessionCreated> {
        const resp = await this.connectionProvider.createRoom({});
        return {
            kind: 'session',
            info: {
                roomToken: resp.roomToken
            }
        };
    }
}