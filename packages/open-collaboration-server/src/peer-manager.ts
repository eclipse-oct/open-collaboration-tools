// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { injectable } from 'inversify';
import { Peer } from './types.js';

@injectable()
export class PeerManager {

    private readonly peers: Map<string, Peer> = new Map();

    register(peer: Peer): void {
        this.peers.set(peer.jwt, peer);
        peer.onDispose(() => this.peers.delete(peer.jwt));
    }

    getPeer(jwt: string): Peer | undefined {
        return this.peers.get(jwt);
    }

}
