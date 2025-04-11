// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable } from 'inversify';
import { Deferred, EncryptedBroadcastMessage, BroadcastMessage, Message, UnknownRequestMessage, UnknownResponseMessage, UnknownResponseErrorMessage, UnknownNotificationMessage, UnknownBroadcastMessage } from 'open-collaboration-protocol';
import { Peer } from './types.js';
import { nanoid } from 'nanoid';
import { Logger, LoggerSymbol } from './utils/logging.js';

export interface RelayedRequest {
    id: string | number;
    response: Deferred<UnknownResponseMessage | UnknownResponseErrorMessage>
    dispose(): void;
}

@injectable()
export class MessageRelay {

    @inject(LoggerSymbol) protected logger: Logger;

    protected requestMap = new Map<string, RelayedRequest>();

    pushResponse(receiver: Peer, message: UnknownResponseMessage | UnknownResponseErrorMessage): void {
        const relayedRequest = this.requestMap.get(message.id.toString());
        if (relayedRequest) {
            relayedRequest.response.resolve(message);
            relayedRequest.dispose();
        }
    }

    sendRequest(target: Peer, message: UnknownRequestMessage, timeoutMs?: number): Promise<UnknownResponseMessage | UnknownResponseErrorMessage> {
        const deferred = new Deferred<UnknownResponseMessage | UnknownResponseErrorMessage>();
        const messageId = message.id;
        const key = nanoid(24);
        const dispose = () => {
            this.requestMap.delete(key);
            clearTimeout(timeout);
            deferred.reject(new Error('Request timed out'));
        };
        const timeout = setTimeout(dispose, timeoutMs ?? 30_000);
        this.requestMap.set(key, {
            id: messageId,
            response: deferred,
            dispose
        });
        const targetMessage: UnknownRequestMessage = {
            ...message,
            id: key
        };
        target.channel.sendMessage(targetMessage);
        return deferred.promise;
    }

    sendNotification(target: Peer, message: UnknownNotificationMessage): void {
        target.channel.sendMessage(message);
    }

    sendBroadcast(origin: Peer, message: UnknownBroadcastMessage): void {
        try {
            const room = origin.room;
            message.origin = origin.id;
            for (const peer of room.peers) {
                if (peer !== origin) {
                    // Find the key for the target peer
                    const peerKey = message.metadata.encryption.keys.find(e => e.target === peer.id);
                    if (peerKey && BroadcastMessage.isEncrypted(message)) {
                        // Adjust the message to only contain the key for the target peer
                        // All other keys are not of use for the target peer
                        const messageWithSingleKey: EncryptedBroadcastMessage = {
                            ...message,
                            metadata: {
                                ...message.metadata,
                                encryption: {
                                    keys: [peerKey]
                                }
                            }
                        };
                        peer.channel.sendMessage(messageWithSingleKey);
                    } else if (!Message.isEncrypted(message)) {
                        peer.channel.sendMessage(message);
                    } else {
                        // If the sender did not include a key for one of the peers, they cannot decrypt the message
                        // This is unexpected behavior as every broadcast should be sent to every peer in the room
                        this.logger.warn(`No key found for peer ${peer.id} in room ${room.id}`);
                    }
                }
            }
        } catch (error) {
            this.logger.error('Error occurred during broadcast', error);
        }
    }

}
