// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { CollaborationInstance, PeerWithColor } from './collaboration-instance.js';
import { injectable } from 'inversify';

@injectable()
export class CollaborationStatusViewDataProvider implements vscode.TreeDataProvider<PeerWithColor> {

    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private instance: CollaborationInstance | undefined;

    onConnection(instance: CollaborationInstance) {
        this.instance = instance;
        instance.onDidUsersChange(() => {
            this.onDidChangeTreeDataEmitter.fire();
        });
        instance.onDidDispose(() => {
            this.instance = undefined;
            this.onDidChangeTreeDataEmitter.fire();
        });
        this.onDidChangeTreeDataEmitter.fire();
    }

    async getTreeItem(peer: PeerWithColor): Promise<vscode.TreeItem> {
        const self = await this.instance?.ownUserData;
        const treeItem = new vscode.TreeItem(peer.name);
        const tags: string[] = [];
        if (peer.id === self?.id) {
            tags.push(vscode.l10n.t('You'));
        }
        if (peer.host) {
            tags.push(vscode.l10n.t('Host'));
        }
        treeItem.description = tags.length ? ('(' + tags.join(' • ') + ')') : undefined;
        treeItem.contextValue = 'self';
        if (self?.id !== peer.id) {
            const themeColor = peer.color ? new vscode.ThemeColor(peer.color) : undefined;
            treeItem.iconPath = new vscode.ThemeIcon('circle-filled', themeColor);
            treeItem.contextValue = this.instance?.following === peer.id ? 'followedPeer' : 'peer';
        }
        return treeItem;
    }

    getChildren(element?: PeerWithColor): vscode.ProviderResult<PeerWithColor[]> {
        if (!element && this.instance) {
            return this.instance.connectedUsers;
        }
        return [];
    }

    update() {
        this.onDidChangeTreeDataEmitter.fire();
    }

}
