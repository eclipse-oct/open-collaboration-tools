// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { ExtensionContext } from './inversify';
import type { Peer } from 'open-collaboration-protocol';

export interface UserTokens {
    [serverUrl: string]: string | undefined;
}

export interface RoomData {
    serverUrl: string;
    roomToken: string;
    roomId: string;
    host: Peer;
}

const USER_TOKEN_KEY = 'oct.userTokens';
const ROOM_TOKEN_KEY = 'oct.roomToken';

@injectable()
export class SecretStorage {

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    async deleteAll(): Promise<void> {
        await Promise.all([
            this.context.secrets.delete(USER_TOKEN_KEY),
            this.context.secrets.delete(ROOM_TOKEN_KEY)
        ]);
    }

    async storeUserToken(serverUrl: string, token: string): Promise<void> {
        const tokens = await this.retrieveUserTokens();
        tokens[serverUrl] = token;
        await this.storeUserTokens(tokens);
    }

    async storeUserTokens(tokens: UserTokens): Promise<void> {
        await this.storeJsonToken(USER_TOKEN_KEY, tokens);
    }

    async deleteUserTokens(): Promise<void> {
        await this.context.secrets.delete(USER_TOKEN_KEY);
    }

    async retrieveUserToken(serverUrl: string): Promise<string | undefined> {
        const tokens = await this.retrieveUserTokens();
        return tokens[serverUrl];
    }

    async retrieveUserTokens(): Promise<UserTokens> {
        return (await this.retrieveJsonToken<UserTokens>(USER_TOKEN_KEY)) ?? {};
    }

    async consumeRoomData(): Promise<RoomData | undefined> {
        const roomToken = await this.retrieveRoomData();
        // Instantly delete the room token - it will become invalid after the first connection attempt
        await this.storeRoomData(undefined);
        return roomToken;
    }

    async storeRoomData(token: RoomData | undefined): Promise<void> {
        if (token === undefined) {
            await this.context.secrets.delete(ROOM_TOKEN_KEY);
        } else {
            await this.storeJsonToken(ROOM_TOKEN_KEY, token);
        }
    }

    async retrieveRoomData(): Promise<RoomData | undefined> {
        return this.retrieveJsonToken<RoomData>(ROOM_TOKEN_KEY);
    }

    private async storeJsonToken(key: string, token: object): Promise<void> {
        await this.context.secrets.store(key, JSON.stringify(token));
    }

    private async retrieveJsonToken<T>(key: string): Promise<T | undefined> {
        const token = await this.context.secrets.get(key);
        if (token) {
            try {
                return JSON.parse(token);
            } catch {
                // If the secret is not a valid JSON, delete it.
                await this.context.secrets.delete(key);
                return undefined;
            }
        }
        return undefined;
    }
}
