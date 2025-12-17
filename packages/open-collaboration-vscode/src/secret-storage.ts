// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { ExtensionContext } from './inversify.js';
import type { Peer, Workspace } from 'open-collaboration-protocol';
import { nanoid } from 'nanoid';
import { CollaborationUri } from './utils/uri.js';

export interface UserTokens {
    [serverUrl: string]: string | undefined;
}

export interface SessionData {
    [id: string]: RoomData;
}

export interface RoomData {
    timestamp: number;
    serverUrl: string;
    roomToken: string;
    roomId: string;
    host: Peer;
    workspace: Workspace;
}

const USER_TOKEN_KEY = 'oct.userTokens';
const SESSION_TOKEN_KEY = 'oct.sessionTokens';

@injectable()
export class SecretStorage {

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    async deleteAll(): Promise<void> {
        await Promise.all([
            this.context.secrets.delete(USER_TOKEN_KEY),
            this.context.secrets.delete(SESSION_TOKEN_KEY)
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
        return (await this.retrieveJsonToken<UserTokens>(USER_TOKEN_KEY, {}));
    }

    async storeSessionData(data: RoomData): Promise<string> {
        const id = nanoid();
        const sessions = await this.retrieveJsonToken<SessionData>(SESSION_TOKEN_KEY, {});
        sessions[id] = data;
        await this.storeJsonToken(SESSION_TOKEN_KEY, sessions);
        return id;
    }

    async retrieveSessionData(id: string): Promise<RoomData | undefined> {
        const sessions = await this.retrieveJsonToken<SessionData>(SESSION_TOKEN_KEY, {});
        let needSave = false;
        for (const [key, session] of Object.entries(sessions)) {
            // Clean up sessions older than 24 hours
            if (session.timestamp + 24 * 60 * 60 * 1000 < Date.now()) {
                delete sessions[key];
                needSave = true;
            }
        }
        if (needSave) {
            await this.storeJsonToken(SESSION_TOKEN_KEY, sessions);
        }
        return sessions[id];
    }

    async retrieveSessionDataFromUri(uri: vscode.Uri): Promise<RoomData | undefined> {
        const id = CollaborationUri.getWorkspaceId(uri);
        if (!id) {
            return undefined;
        }
        return this.retrieveSessionData(id);
    }

    private async storeJsonToken(key: string, token: object): Promise<void> {
        await this.context.secrets.store(key, JSON.stringify(token));
    }

    private async retrieveJsonToken<T>(key: string, def: T): Promise<T> {
        const token = await this.context.secrets.get(key);
        if (token) {
            try {
                return JSON.parse(token);
            } catch {
                // If the secret is not a valid JSON, delete it.
                await this.context.secrets.delete(key);
                return def;
            }
        }
        return def;
    }
}
