// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import 'reflect-metadata';
import * as vscode from 'vscode';
import { CollaborationInstance } from './collaboration-instance.js';
import { CollaborationRoomService } from './collaboration-room-service.js';
import { closeSharedEditors, removeWorkspaceFolders } from './utils/workspace.js';
import { createContainer } from './inversify.js';
import { Commands } from './commands.js';
import { Fetch } from './collaboration-connection-provider.js';
import fetch from 'node-fetch';

export async function activate(context: vscode.ExtensionContext) {
    const container = createContainer(context);
    container.bind(Fetch).toConstantValue(fetch);
    const commands = container.get(Commands);
    commands.initialize();
    const roomService = container.get(CollaborationRoomService);

    const connection = await roomService.tryConnect();
    if (connection) {
        // Wait for the connection to be ready before returning.
        // This allows other extensions that need some workspace information to wait for the data.
        await connection.ready;
    } else {
        await closeSharedEditors();
        removeWorkspaceFolders();
    }
}

export async function deactivate(): Promise<void> {
    await CollaborationInstance.Current?.leave();
    CollaborationInstance.Current?.dispose();
    await closeSharedEditors();
    removeWorkspaceFolders();
}
