// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable } from 'inversify';
import { CredentialsManager } from './credentials-manager.js';
import { MessageRelay } from './message-relay.js';
import { Peer, Room, User, isUser } from './types.js';
import { Messages, BroadcastMessage, NotificationMessage, RequestMessage, ResponseMessage, isObject, Info, Event, Disposable, Emitter, JoinRoomResponse, JoinRoomPollResponse, JoinResponse } from 'open-collaboration-protocol';
import { Logger } from './utils/logging.js';

export interface PreparedRoom {
    id: string;
    jwt: string;
}

export interface RoomClaim {
    room: string;
    roomClock: number;
    user: User;
    host?: boolean;
}

export function isRoomClaim(obj: unknown): obj is RoomClaim {
    return isObject<RoomClaim>(obj) && typeof obj.room === 'string' && isUser(obj.user);
}

export interface RoomJoinInfo extends Info {
    failure: boolean;
}

export interface JoinPollResult extends Disposable {
    update(result: JoinRoomResponse | JoinRoomPollResponse): void;
    onUpdate: Event<JoinRoomResponse | JoinRoomPollResponse>;
    result?: JoinRoomResponse | JoinRoomPollResponse;
}

@injectable()
export class RoomManager {

    protected rooms = new Map<string, Room>();
    protected peers = new Map<string, Room>();
    protected pollResults = new Map<string, JoinPollResult>();

    @inject(MessageRelay)
    private readonly messageRelay: MessageRelay;

    @inject(CredentialsManager)
    protected readonly credentials: CredentialsManager;

    @inject(Logger) protected logger: Logger;

    async closeRoom(id: string): Promise<void> {
        const room = this.getRoomById(id);
        if (room) {
            const broadcastMessage = BroadcastMessage.create(Messages.Room.Closed, '');
            this.messageRelay.sendBroadcast(room.host, broadcastMessage);
            for (const peer of room.peers) {
                this.peers.delete(peer.id);
                peer.dispose();
            }
            this.rooms.delete(id);
            this.logger.info(`Deleted room '${room.id}'`);
        }
    }

    async prepareRoom(user: User): Promise<PreparedRoom> {
        const id = this.credentials.secureId();
        const claim: RoomClaim = {
            room: id,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            },
            host: true,
            roomClock: 0
        };
        this.logger.info(`Prepared room [id: '${claim.room}'] for user [provider: '${user.authProvider || '<none>'}' | id: '${user.id}' | name: '${user.name}' | email: '${user.email || '<none>'}']`);
        const jwt = await this.credentials.generateJwt(claim);
        return {
            id,
            jwt
        };
    }

    async join(peer: Peer, roomId: string): Promise<Room> {
        let room: Room | undefined;
        if (peer.host) {
            room = new Room(roomId, peer, []);
            this.rooms.set(room.id, room);
            this.peers.set(peer.id, room);
            peer.onDispose(() => {
                this.closeRoom(room!.id);
            });
            this.logger.info(`Host [id: '${peer.id}' | client: '${peer.client}' | userId: '${peer.user.id}' | name: '${peer.user.name}' | email: '${peer.user.email || '<none>'}'] created room [id: '${room.id}']`);
        } else {
            room = this.rooms.get(roomId);
            if (!room) {
                throw this.logger.createErrorAndLog(`Could not find room to join from id: ${roomId}`);
            }
            const broadcastMessage = BroadcastMessage.create(Messages.Room.Joined, '', [peer.toProtocol()]);
            this.peers.set(peer.id, room);
            room.guests.push(peer);
            this.logger.info(`Peer [id: '${peer.id}' | client: '${peer.client}' | userId: '${peer.user.id}' | name: '${peer.user.name}' | email: '${peer.user.email || '<none>'}'] joined room [id: '${room.id}']`);
            try {
                this.messageRelay.sendBroadcast(
                    peer,
                    broadcastMessage
                );
            } catch (err) {
                this.logger.error('Failed to send join broadcast', err);
            }
            peer.onDispose(() => {
                this.leaveRoom(peer);
            });
        }
        // Send the identity info to the user (i.e. what the user needs to know about itself)
        const infoNotification = NotificationMessage.create(
            Messages.Peer.Info,
            '',
            peer.id,
            [peer.toProtocol()]
        );
        this.messageRelay.sendNotification(
            peer,
            infoNotification
        );
        return room;
    }

    async leaveRoom(peer: Peer): Promise<void> {
        const room = this.getRoomByPeerId(peer.id);
        if (!room) {
            return;
        }
        if (peer.host) {
            this.closeRoom(room.id);
        } else {
            try {
                const broadcastMessage = BroadcastMessage.create(Messages.Room.Left, '', [peer.toProtocol()]);
                this.messageRelay.sendBroadcast(
                    peer,
                    broadcastMessage
                );
            } catch (err) {
                this.logger.error('Failed to send leave broadcast', err);
            }
            // Remove the peer from the room as the last step
            this.peers.delete(peer.id);
            room.removeGuest(peer.id);
        }
    }

    getRoomById(id: string): Room | undefined {
        return this.rooms.get(id);
    }

    getRoomByPeerId(id: string): Room | undefined {
        return this.peers.get(id);
    }

    async requestJoin(room: Room, user: User): Promise<string> {
        this.logger.info(`Request to join room [id: '${room.id}'] by user [id: '${user.id}' | name: '${user.name}' | email: '${user.email ?? '<none>'}']`);
        const responseId = this.credentials.secureId();
        const timeout = setTimeout(() => {
            pollResult.update({
                code: 'JoinTimeout',
                message: 'Join request has timed out',
                params: [],
                failure: true
            });
            pollResult.dispose();
        }, 300_000); // 5 minutes of timeout
        const updateEmitter = new Emitter<JoinRoomResponse | RoomJoinInfo>();
        const pollResult: JoinPollResult = {
            update: result => {
                pollResult.result = result;
                updateEmitter.fire(result);
            },
            onUpdate: updateEmitter.event,
            dispose: () => {
                updateEmitter.dispose();
                this.pollResults.delete(responseId);
                clearTimeout(timeout);
            }
        };
        this.pollResults.set(responseId, pollResult);
        try {
            const requestMessage = RequestMessage.create(Messages.Peer.Join, this.credentials.secureId(), '', room.host.id, [user]);
            const responsePromise = this.messageRelay.sendRequest(
                room.host,
                requestMessage,
                300_000
            );
            responsePromise.then(async response => {
                if (ResponseMessage.is(response)) {
                    const joinResponse = response.content.response as JoinResponse | undefined;
                    if (!joinResponse) {
                        pollResult.update({
                            failure: true,
                            code: 'JoinRejected',
                            params: [],
                            message: 'Join request has been rejected'
                        });
                        return;
                    }
                    const claim: RoomClaim = {
                        room: room.id,
                        user: { ...user },
                        // Increment the clock to identify unique sessions
                        // If a user joins a room multiple times, the clock will be incremented
                        // This way, they get a new JWT for each session
                        // If a user reconnects using an old JWT, we can identify a reconnect attempt
                        roomClock: ++room.clock
                    };
                    const jwt = await this.credentials.generateJwt(claim);
                    const joinRoomResponse: JoinRoomResponse = {
                        roomId: room.id,
                        roomToken: jwt,
                        workspace: joinResponse.workspace,
                        host: room.host.toProtocol()
                    };
                    pollResult.update(joinRoomResponse);
                } else {
                    pollResult.update({
                        failure: true,
                        code: 'JoinRejected',
                        params: [],
                        message: 'Join request has been rejected'
                    });
                }
            }).catch(() => {
                pollResult.update({
                    code: 'JoinTimeout',
                    message: 'Join request has timed out',
                    params: [],
                    failure: true
                });
            });
            pollResult.update({
                failure: false,
                code: 'WaitingForHost',
                params: [],
                message: 'Waiting for host to accept join request',
            });
            return responseId;
        } catch {
            throw this.logger.createErrorAndLog('Failed to request join');
        }
    }

    pollJoin(responseId: string): JoinPollResult | undefined {
        return this.pollResults.get(responseId);
    }

}
