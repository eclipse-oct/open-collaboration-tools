// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable, postConstruct } from 'inversify';
import { nanoid } from 'nanoid';
import * as protocol from 'open-collaboration-protocol';
import { Channel } from './channel.js';
import { MessageRelay } from './message-relay.js';
import { RoomManager } from './room-manager.js';
import { Peer, PeerInfo, Room, User } from './types.js';
import { Logger } from './utils/logging.js';
import { parse } from 'semver';

export const PeerFactory = Symbol('PeerFactory');
export type PeerFactory = (info: PeerInfo) => Peer;

@injectable()
export class PeerImpl implements Peer {

    @inject(Logger) protected logger: Logger;

    readonly id = nanoid(24);

    get jwt(): string {
        return this.peerInfo.jwt;
    }

    get publicKey(): string {
        return this.peerInfo.publicKey;
    }

    get client(): string {
        return this.peerInfo.client;
    }

    get supportedCompression(): string[] {
        return this.peerInfo.supportedCompression;
    }

    get user(): User {
        return this.peerInfo.user;
    }

    get host(): boolean {
        return this.peerInfo.host;
    }

    get room(): Room {
        const value = this.roomManager.getRoomByPeerId(this.id);
        if (!value) {
            throw this.logger.createErrorAndLog(`Peer '${this.id}' does not belong to any room`);
        }
        return value;
    }

    @inject(MessageRelay)
    private readonly messageRelay: MessageRelay;

    @inject(PeerInfo)
    private readonly peerInfo: PeerInfo;

    @inject(RoomManager)
    private readonly roomManager: RoomManager;

    private _channel?: Channel;
    private disposed = false;
    private readonly onDisposeEmitter = new protocol.Emitter<void>();

    get onDispose(): protocol.Event<void> {
        return this.onDisposeEmitter.event;
    }

    get channel(): Channel {
        if (!this._channel) {
            throw new Error('Not initialized');
        }
        return this._channel;
    }

    @postConstruct()
    protected initialize(): void {
        this._channel = new Channel(this.peerInfo.channel);
        this._channel.onMessage(message => this.receiveMessage(message));
        this._channel.onClose(() => this.dispose());
    }

    private async receiveMessage(message: protocol.Message): Promise<void> {
        const messageVersion = parse(message.version);
        if (!messageVersion) {
            this.logger.warn(`Received message from '${this.id}' with invalid version: ${message.version}. Ignoring message.`);
            return;
        }
        if (!protocol.compatibleVersions(messageVersion)) {
            this.logger.warn(`Received message from '${this.id}' with incompatible version: ${message.version}; expected: ${protocol.VERSION}. Ignoring message.`);
            return;
        }
        if (protocol.ResponseMessage.isAny(message) || protocol.ResponseErrorMessage.isAny(message)) {
            this.messageRelay.pushResponse(this, message);
        } else if (protocol.RequestMessage.isAny(message)) {
            if (!protocol.Message.isEncrypted(message)) {
                this.logger.warn(`Received unencrypted request from: '${this.id}'`);
                return;
            }
            // Override whatever we know about the origin of the message
            message.origin = this.id;
            try {
                const response = await this.messageRelay.sendRequest(this.getTargetPeer(message.target), message);
                // Adjust the response to the original message id
                response.id = message.id;
                this.channel.sendMessage(response);
            } catch (_error) {
                const errorResponseMessage = protocol.ResponseErrorMessage.create(message.id, 'Failed to retrieve the requested data.');
                this.channel.sendMessage(errorResponseMessage);
            }
        } else if (protocol.NotificationMessage.isAny(message)) {
            message.origin = this.id;
            if (message.target === '') {
                this.handleServerMessage(message);
                return;
            } else if (!protocol.Message.isEncrypted(message)) {
                this.logger.warn(`Received unencrypted notification from: '${this.id}'`);
                return;
            }
            try {
                this.messageRelay.sendNotification(this.getTargetPeer(message.target), message);
            } catch (_error) {
                this.logger.error(`Failed sending notification to: ${message.target || '<empty>'}`);
            }
        } else if (protocol.BroadcastMessage.isAny(message)) {
            if (!protocol.Message.isEncrypted(message)) {
                this.logger.warn(`Received unencrypted broadcast from: '${this.id}'`);
                return;
            }
            this.messageRelay.sendBroadcast(this, message);
        }
    }

    private async handleServerMessage(notification: protocol.UnknownNotificationMessage): Promise<void> {
        if (!protocol.NotificationMessage.is(notification)) {
            this.logger.error('Received encrypted server message');
            return;
        }
        try {
            if (notification.content.method === protocol.Messages.Room.Leave.method) {
                this.dispose();
            } else {
                throw new Error('Unknown server message method: ' + notification.content.method);
            }
        } catch (err) {
            this.logger.error('Failed to handle server message', err);
        }
    }

    private getTargetPeer(targetId: string | undefined): Peer {
        const peer = targetId ? this.room.getPeer(targetId) : undefined;
        if (!peer) {
            throw this.logger.createErrorAndLog(`Could not find the target peer: ${targetId || '<empty>'}`);
        }
        return peer;
    }

    toProtocol(): protocol.Peer {
        return {
            id: this.id,
            host: this.host,
            name: this.user.name,
            email: this.user.email,
            metadata: {
                compression: {
                    supported: this.peerInfo.supportedCompression
                },
                encryption: {
                    publicKey: this.publicKey
                }
            }
        };
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.onDisposeEmitter.fire(undefined);
        this.onDisposeEmitter.dispose();
        this._channel?.close();
        this.logger.info(`Peer '${this.id}' disposed`);
    }
}
