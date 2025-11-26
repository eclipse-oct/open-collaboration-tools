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
        Allowlist,
        Auto
    }

    export const SERVER_URL = 'oct.serverUrl';
    export const ALWAYS_ASK_TO_OVERRIDE_SERVER_URL = 'oct.alwaysAskToOverrideServerUrl';
    export const WEB_CLIENT_URL = 'oct.webClientUrl';
    export const JOIN_ACCEPT_MODE = 'oct.joinAcceptMode';
    export const JOIN_ALLOWLIST = 'oct.joinAllowlist';

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
        } else  if (mode === 'allowlist') {
            return JoinAcceptMode.Allowlist;
        } else if (mode === 'auto') {
            return JoinAcceptMode.Auto;
        }
        return JoinAcceptMode.Prompt;
    }

    export function getJoinAllowlist(): string[] {
        return vscode.workspace.getConfiguration().get<string[]>(JOIN_ALLOWLIST, []);
    }

    export async function addToJoinAllowlist(id: string): Promise<void> {
        const allowlist = getJoinAllowlist();
        if (!allowlist.includes(id)) {
            allowlist.push(id);
            await vscode.workspace.getConfiguration().update(JOIN_ALLOWLIST, allowlist, vscode.ConfigurationTarget.Global);
        }
    }

}
