// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';

export namespace CollaborationUri {

    export const SCHEME = 'oct';

    export function create(workspace: string, path?: string): vscode.Uri {
        return vscode.Uri.parse(`${SCHEME}:///${workspace}${path ? '/' + path : ''}`);
    }

    export function getProtocolPath(uri?: vscode.Uri): string | undefined {
        if (!uri) {
            return undefined;
        }
        const path = uri.toString(true);
        const roots = (vscode.workspace.workspaceFolders ?? []);
        for (const root of roots) {
            const rootUri = root.uri.toString(true) + '/';
            if (path.startsWith(rootUri)) {
                return root.name + '/' + path.substring(rootUri.length);
            }
        }
        return undefined;
    }

    export function getResourceUri(path?: string): vscode.Uri | undefined {
        if (!path) {
            return undefined;
        }
        const parts = path.split('/');
        const root = parts[0];
        const rest = parts.slice(1);
        const stat = (vscode.workspace.workspaceFolders ?? []).find(e => e.name === root);
        if (stat) {
            const uriPath = join(stat.uri.path, ...rest);
            const uri = stat.uri.with({ path: uriPath });
            return uri;
        } else {
            return undefined;
        }
    }

    function join(...parts: string[]): string {
        if (parts.length === 0)
            return '.';
        let joined: string | undefined;
        for (const part of parts) {
            if (part.length > 0) {
                if (joined === undefined)
                    joined = part;
                else
                    joined += '/' + part;
            }
        }
        if (joined === undefined)
            return '.';
        return joined;
    }

}

export interface RoomUri<URL extends boolean = boolean> {
    serverUrl: URL extends true ? string : undefined;
    roomId: string;
}

export namespace RoomUri {

    export function create(roomUri: RoomUri<true>): string {
        const uri = vscode.Uri.parse(roomUri.serverUrl);
        return uri.with({
            fragment: roomUri.roomId
        }).toString(true);
    }

    const pureRoomId = /^[a-zA-Z0-9]+$/;

    export function parse(stringValue: string): RoomUri {
        if (pureRoomId.test(stringValue)) {
            return {
                serverUrl: undefined,
                roomId: stringValue
            };
        } else {
            const uri = vscode.Uri.parse(stringValue, true);
            if (!pureRoomId.test(uri.fragment)) {
                throw new Error(`Invalid room id: ${uri.fragment}`);
            }
            return {
                serverUrl: uri.with({ fragment: '' }).toString(true),
                roomId: uri.fragment
            };
        }
    }

    export function normalizeServerUri(serverUrl: string): string {
        const uri = vscode.Uri.parse(serverUrl);
        return uri.toString(true);
    }
}
