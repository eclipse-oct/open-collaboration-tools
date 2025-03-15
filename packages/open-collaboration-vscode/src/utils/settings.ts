// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { RoomUri } from './uri';

export namespace Settings {

    export const SERVER_URL = 'oct.serverUrl';

    export function getServerUrl(): string | undefined {
        const url = vscode.workspace.getConfiguration().get(SERVER_URL);
        if (typeof url === 'string') {
            const normalized = RoomUri.normalizeServerUri(url);
            return normalized;
        }
        return undefined;
    }

}
