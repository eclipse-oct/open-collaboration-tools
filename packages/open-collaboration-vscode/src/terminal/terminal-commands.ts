// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { Container } from 'inversify';
import { ExtensionContext } from '../inversify.js';
import { OctCommands } from '../commands-list.js';
import { TerminalService } from './terminal-service.js';

/**
 * Wires up terminal sharing. Deliberately kept out of commands.ts and only ever called from
 * extension.ts: this module (transitively) does a lazy `require('node-pty')`, a native module
 * that must never be reachable from the web extension bundle (docs/terminal-sharing.md §4.3).
 */
export function registerTerminalCommands(container: Container): void {
    const context = container.get<vscode.ExtensionContext>(ExtensionContext);
    const terminalService = container.get(TerminalService);
    terminalService.initialize();

    context.subscriptions.push(
        terminalService,
        vscode.commands.registerCommand(OctCommands.ShareTerminal, () => terminalService.shareTerminal()),
        vscode.commands.registerCommand(OctCommands.OpenSharedTerminal, () => terminalService.openSharedTerminal())
    );
}
