// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { injectable } from 'inversify';
import { CollaborationInstance } from './collaboration-instance.js';
import { OctCommands } from './commands-list.js';

class ActionItem extends vscode.TreeItem {
    constructor(label: string, icon: string, tooltip: string, command: vscode.Command) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.tooltip = tooltip;
        this.command = command;
    }
}

@injectable()
export class CollaborationActionsViewDataProvider implements vscode.TreeDataProvider<ActionItem> {

    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private instance: CollaborationInstance | undefined;

    onConnection(instance: CollaborationInstance): void {
        this.instance = instance;
        instance.onDidDispose(() => {
            this.instance = undefined;
            this.onDidChangeTreeDataEmitter.fire();
        });
        this.onDidChangeTreeDataEmitter.fire();
    }

    update(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    getTreeItem(element: ActionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ActionItem): ActionItem[] {
        if (element) {
            return [];
        }

        const instance = this.instance;

        // Outside session: return empty so viewsWelcome buttons are shown instead
        if (!instance) {
            return [];
        }

        const items: ActionItem[] = [
            new ActionItem(
                vscode.l10n.t('Invite Others (Copy Code)'),
                'clippy',
                vscode.l10n.t('Copy the invitation code to the clipboard to share with others'),
                { command: OctCommands.InviteToRoom, title: '' }
            )
        ];

        if (instance.host) {
            items.push(new ActionItem(
                vscode.l10n.t('Configure Collaboration Session'),
                'gear',
                vscode.l10n.t('Configure the options and permissions of the current session'),
                { command: OctCommands.ConfigureRoom, title: '' }
            ));
            items.push(new ActionItem(
                vscode.l10n.t('Stop Collaboration Session'),
                'circle-slash',
                vscode.l10n.t('Stop the collaboration session, stop sharing all content and remove all participants'),
                { command: OctCommands.CloseConnection, title: '' }
            ));
        } else {
            items.push(new ActionItem(
                vscode.l10n.t('Leave Collaboration Session'),
                'circle-slash',
                vscode.l10n.t('Leave the collaboration session, closing the current workspace'),
                { command: OctCommands.CloseConnection, title: '' }
            ));
        }

        return items;
    }
}
