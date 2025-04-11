// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { RoomUri } from './uri.js';

export namespace Settings {

    export const SERVER_URL = 'oct.serverUrl';
    export const ALWAYS_ASK_TO_OVERRIDE_SERVER_URL = 'oct.alwaysAskToOverrideServerUrl';

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

}
