// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Channel, TransportChannel } from './channel.js';
import * as protocol from 'open-collaboration-protocol';

export class Room {

    clock = 0;

    constructor(public id: string, public host: Peer, public guests: Peer[]) {
    }

    get peers(): Peer[] {
        return [this.host, ...this.guests];
    }

    getPeer(id: string): Peer | undefined {
        return this.peers.find(peer => peer.id === id);
    }

    removeGuest(id: string): void {
        this.guests = this.guests.filter(peer => peer.id !== id);
    }
}

export interface User {
    id: string;
    name: string;
    email?: string;
    authProvider?: string;
}

export function isUser(obj: unknown): obj is User {
    return protocol.isObject<User>(obj) && typeof obj.id === 'string' && typeof obj.name === 'string';
}

export const PeerInfo = Symbol('PeerInfo');

export interface PeerInfo {
    jwt: string;
    user: User;
    host: boolean;
    channel: TransportChannel;
    client: string;
    publicKey: string;
    supportedCompression: string[];
}

export interface Peer extends protocol.Disposable {
    jwt: string;
    id: string;
    client: string;
    host: boolean;
    user: User;
    channel: Channel;
    room: Room;
    onDispose: protocol.Event<void>;
    toProtocol(): protocol.Peer;
}

export type Permissions = Record<string, string>;
