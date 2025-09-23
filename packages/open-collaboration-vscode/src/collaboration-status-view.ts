// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { CollaborationInstance } from './collaboration-instance.js';
import { injectable } from 'inversify';

export interface TreeUserData {
    id: string;
    name: string;
    email?: string;
    host: boolean;
    peerId?: string;
    color?: string;
    pending: boolean;
}

@injectable()
export class CollaborationStatusViewDataProvider implements vscode.TreeDataProvider<TreeUserData> {

    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private instance: CollaborationInstance | undefined;

    onConnection(instance: CollaborationInstance) {
        this.instance = instance;
        instance.onDidUsersChange(() => {
            this.onDidChangeTreeDataEmitter.fire();
        });
        instance.onDidPendingChange(() => {
            this.onDidChangeTreeDataEmitter.fire();
        });
        instance.onDidDispose(() => {
            this.instance = undefined;
            this.onDidChangeTreeDataEmitter.fire();
        });
        this.onDidChangeTreeDataEmitter.fire();
    }

    async getTreeItem(peer: TreeUserData): Promise<vscode.TreeItem> {
        const self = await this.instance?.ownUserData;
        const treeItem = new vscode.TreeItem(peer.name);
        let tooltip = peer.name;
        if (peer.email) {
            tooltip += ` (${peer.email})`;
        }
        treeItem.tooltip = tooltip;
        const tags: string[] = [];
        if (peer.peerId === self?.id) {
            tags.push(vscode.l10n.t('You'));
        }
        if (peer.host) {
            tags.push(vscode.l10n.t('Host'));
        }
        if (peer.pending) {
            tags.push(vscode.l10n.t('Pending'));
        }
        treeItem.description = tags.length ? ('(' + tags.join(' • ') + ')') : undefined;
        if (self?.id !== peer.peerId) {
            if (peer.color) {
                const themeColor = new vscode.ThemeColor(peer.color);
                treeItem.iconPath = new vscode.ThemeIcon('circle-filled', themeColor);
            } else if (peer.pending) {
                treeItem.iconPath = new vscode.ThemeIcon('circle-outline');
            }
            if (this.instance?.following && this.instance?.following === peer.peerId) {
                treeItem.contextValue = 'followedPeer';
            } else if (peer.pending) {
                treeItem.contextValue = 'pendingPeer';
            } else {
                treeItem.contextValue = 'peer';
            }
        } else {
            treeItem.contextValue = 'self';
            treeItem.iconPath = new vscode.ThemeIcon('account');
        }
        return treeItem;
    }

    async getChildren(element?: TreeUserData): Promise<TreeUserData[]> {
        if (!element && this.instance) {
            const data: TreeUserData[] = [];
            const connected = await this.instance.connectedUsers;
            for (const user of connected) {
                data.push({
                    id: user.nanoid,
                    name: user.name,
                    email: user.email,
                    peerId: user.id,
                    color: user.color,
                    host: user.host,
                    pending: false
                });
            }
            for (const user of this.instance.pendingUsers) {
                data.push({
                    id: user.nanoid,
                    name: user.user.name,
                    email: user.user.email,
                    peerId: undefined,
                    color: undefined,
                    host: false,
                    pending: true
                });
            }
            return data;
        }
        return [];
    }

    update() {
        this.onDidChangeTreeDataEmitter.fire();
    }

}
