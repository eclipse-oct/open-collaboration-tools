// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { RoomUri } from './uri.js';

export namespace Settings {

    export enum JoinAcceptMode {
        Prompt,
        Whitelist,
        Auto
    }

    export const SERVER_URL = 'oct.serverUrl';
    export const ALWAYS_ASK_TO_OVERRIDE_SERVER_URL = 'oct.alwaysAskToOverrideServerUrl';
    export const WEB_CLIENT_URL = 'oct.webClientUrl';
    export const JOIN_ACCEPT_MODE = 'oct.joinAcceptMode';

    export function getServerUrl(): string | undefined {
        const url = vscode.workspace.getConfiguration().get(SERVER_URL);
        if (typeof url === 'string') {
            const normalized = RoomUri.normalizeServerUri(url);
            return normalized;
        }
        return undefined;
    }

    export async function setServerUrl(url: string): Promise<void> {
        await vscode.workspace.getConfiguration().update(SERVER_URL, url, vscode.ConfigurationTarget.Global);
    }

    export function getServerUrlOverride(): boolean {
        const value = vscode.workspace.getConfiguration().get(ALWAYS_ASK_TO_OVERRIDE_SERVER_URL);
        return typeof value === 'boolean' ? value : false;
    }

    export async function setServerUrlOverride(value: boolean): Promise<void> {
        await vscode.workspace.getConfiguration().update(ALWAYS_ASK_TO_OVERRIDE_SERVER_URL, value, vscode.ConfigurationTarget.Global);
    }

    export function getWebClientUrl(): string | undefined {
        const url = vscode.workspace.getConfiguration().get(WEB_CLIENT_URL);
        return typeof url === 'string' ? url : undefined;
    }

    export function getJoinAcceptMode(): JoinAcceptMode {
        const mode = vscode.workspace.getConfiguration().get<string>(JOIN_ACCEPT_MODE);
        if (mode === 'prompt') {
            return JoinAcceptMode.Prompt;
        } else  if (mode === 'whitelist') {
            return JoinAcceptMode.Whitelist;
        } else if (mode === 'auto') {
            return JoinAcceptMode.Auto;
        }
        return JoinAcceptMode.Prompt;
    }

    export function getJoinWhitelist(context: vscode.ExtensionContext): string[] {
        return context.globalState.get<string[]>('joinWhitelist', []);
    }

    export async function addToJoinWhitelist(context: vscode.ExtensionContext, id: string): Promise<void> {
        const whitelist = getJoinWhitelist(context);
        if (!whitelist.includes(id)) {
            whitelist.push(id);
            await context.globalState.update('joinWhitelist', whitelist);
        }
    }

}
