// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ConnectionProvider, Deferred, DisposableCollection, MaybePromise, ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import { StdioCommunicationHandler } from './communication-handler';
import { FromDaeomonMessage, JoinRoomRequest, LoginResponse, SendBroadcast, SendNotification, SendRequest, SendResponse, SessionCreated, ToDaemonMessage } from './messages';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { OpenCollaborationYjsProvider } from 'open-collaboration-yjs';

export class MessageHandler {

    protected openRequests = new Map<number, Deferred<unknown>>();

    protected handlers = new Map<string, (message: ToDaemonMessage) => MaybePromise<void | FromDaeomonMessage>>(
        [
            ['login', () => this.login()],
            ['join-room', message => this.joinRoom(message as JoinRoomRequest)],
            ['create-room', () => this.createRoom()],
            // when connection is established
            ['send-request', async message => (await this.sendRequest(message as SendRequest)).request],
            ['send-response', message => { this.openRequests.get((message as SendResponse).id)?.resolve((message as SendResponse).response); }],
            ['send-broadcast', message => this.currentConnection?.sendBroadcast((message as SendBroadcast).broadcast.type, (message as SendBroadcast).broadcast.parameters)],
            ['send-notification', message => this.currentConnection?.sendNotification((message as SendNotification).notification.type, (message as SendNotification).notification.parameters)],
            ['leave-session',  () => this.currentConnection?.dispose()]
        ]
    );

    protected currentConnection?: ProtocolBroadcastConnection;
    protected yjsProvider?: OpenCollaborationYjsProvider;

    protected connectionDisposables: DisposableCollection = new DisposableCollection();

    protected lastRequestId = 0;

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
        this.onConnection(await this.connectionProvider.connect(resp.roomToken, resp.host));
        return {
            kind: 'session',
            info: {
                roomToken: resp.roomToken,
                roomId: resp.roomId
            }
        };
    }

    async createRoom(): Promise<SessionCreated> {
        const resp = await this.connectionProvider.createRoom({});
        this.onConnection(await this.connectionProvider.connect(resp.roomToken));
        return {
            kind: 'session',
            info: {
                roomToken: resp.roomToken,
                roomId: resp.roomId
            }
        };
    }

    onConnection(connection: ProtocolBroadcastConnection) {
        this.currentConnection = connection;
        const YjsDoc = new Y.Doc();
        const awareness = new awarenessProtocol.Awareness(YjsDoc);
        this.connectionDisposables.push({
            dispose: () => {
                YjsDoc.destroy();
                awareness.destroy();
            }});

        this.yjsProvider = new OpenCollaborationYjsProvider(connection, YjsDoc, awareness);
        this.yjsProvider.connect();
        this.connectionDisposables.push(connection.onReconnect(() => {
            this.yjsProvider?.connect();
        }));

        connection.onDisconnect(() => {
            this.dispose();
        });

        connection.onUnhandledRequest(async (origin, method, ...parameters) => {
            const id = this.lastRequestId++;
            this.communcationHandler.sendMessage({
                kind: 'on-request',
                id,
                request: {
                    origin,
                    method,
                    parameters
                }
            });
            const deferred = new Deferred<unknown>();
            this.openRequests.set(id, deferred);
            const res = await deferred.promise;
            return res;
        });

        connection.onUnhandledNotification((origin, method, ...parameters) => {
            this.communcationHandler.sendMessage({
                kind: 'on-notification',
                notification: {
                    origin,
                    method,
                    parameters
                }
            });
        });

        connection.onUnhandledBroadcast((origin, method, ...parameters) => {
            this.communcationHandler.sendMessage({
                kind: 'on-broadcast',
                broadcast: {
                    origin,
                    method,
                    parameters
                }
            });
        });
    }

    async sendRequest(message: SendRequest) {
        const resp = await this.currentConnection?.sendRequest(message.request.type, message.request.parameters);
        return {
            kind: 'response',
            request: resp,
            id: message.id
        };
    }

    dispose() {
        this.currentConnection?.dispose();
        this.yjsProvider?.dispose();
        this.connectionDisposables.dispose();
    }
}