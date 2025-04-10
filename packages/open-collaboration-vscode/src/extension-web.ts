// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import 'reflect-metadata';
import { CollaborationInstance } from './collaboration-instance.js';
import { closeSharedEditors, removeWorkspaceFolders } from './utils/workspace.js';
import { createContainer } from './inversify.js';
import { Commands } from './commands.js';
import { Fetch } from './collaboration-connection-provider.js';

export async function activate(context: vscode.ExtensionContext) {
    const container = createContainer(context);
    container.bind(Fetch).toConstantValue(fetch);
    const commands = container.get(Commands);
    commands.initialize();
}

export async function deactivate(): Promise<void> {
    await CollaborationInstance.Current?.leave();
    CollaborationInstance.Current?.dispose();
    await closeSharedEditors();
    removeWorkspaceFolders();
}
