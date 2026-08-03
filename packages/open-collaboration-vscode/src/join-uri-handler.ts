// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { CollaborationRoomService } from './collaboration-room-service.js';
import { ExtensionContext } from './inversify.js';

export interface JoinRoomUri {
    readonly path: string;
    readonly query: string;
}

export function getJoinRoomId(uri: JoinRoomUri): string | undefined {
    if (uri.path !== '/join') {
        return undefined;
    }
    const roomId = new URLSearchParams(uri.query).get('room');
    return roomId || undefined;
}

@injectable()
export class JoinUriHandler implements vscode.UriHandler {

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    @inject(CollaborationRoomService)
    private roomService: CollaborationRoomService;

    initialize(): void {
        this.context.subscriptions.push(vscode.window.registerUriHandler(this));
    }

    async handleUri(uri: vscode.Uri): Promise<void> {
        const roomId = getJoinRoomId(uri);
        if (!roomId) {
            vscode.window.showErrorMessage(vscode.l10n.t(
                'Invalid invitation code! Invitation codes must be either a string of alphanumeric characters or a URL with a fragment.'
            ));
            return;
        }
        await this.roomService.joinRoom(roomId);
    }
}
