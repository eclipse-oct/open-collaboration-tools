// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { FollowService } from './follow-service';
import { CollaborationInstance, PeerWithColor } from './collaboration-instance';
import { ExtensionContext } from './inversify';
import { QuickPickItem, showQuickPick } from './utils/quick-pick';
import { ContextKeyService } from './context-key-service';
import { CollaborationRoomService } from './collaboration-room-service';
import { CollaborationStatusService } from './collaboration-status-service';
import { SecretStorage } from './secret-storage';
import { RoomUri } from './utils/uri';

@injectable()
export class Commands {

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    @inject(FollowService)
    private followService: FollowService;

    @inject(ContextKeyService)
    private contextKeyService: ContextKeyService;

    @inject(CollaborationRoomService)
    private roomService: CollaborationRoomService;

    @inject(CollaborationStatusService)
    private statusService: CollaborationStatusService;

    @inject(SecretStorage)
    private secretStorage: SecretStorage;

    initialize(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('oct.followPeer', (peer?: PeerWithColor) => this.followService.followPeer(peer?.id)),
            vscode.commands.registerCommand('oct.stopFollowPeer', () => this.followService.unfollowPeer()),
            vscode.commands.registerCommand('oct.enter', async () => {
                const instance = CollaborationInstance.Current;
                if (instance) {
                    const items: QuickPickItem<'invite' | 'stop'>[] = [
                        {
                            key: 'invite',
                            label: '$(clippy) ' + vscode.l10n.t('Invite Others (Copy Code)'),
                            detail: vscode.l10n.t('Copy the invitation code to the clipboard to share with others')
                        }
                    ];
                    if (instance.host) {
                        items.push({
                            key: 'stop',
                            label: '$(circle-slash) ' + vscode.l10n.t('Stop Collaboration Session'),
                            detail: vscode.l10n.t('Stop the collaboration session, stop sharing all content and remove all participants')
                        });
                    } else {
                        items.push({
                            key: 'stop',
                            label: '$(circle-slash) ' + vscode.l10n.t('Leave Collaboration Session'),
                            detail: vscode.l10n.t('Leave the collaboration session, closing the current workspace')
                        });
                    }
                    const result = await showQuickPick(items, {
                        placeholder: vscode.l10n.t('Select Collaboration Option')
                    });
                    if (result === 'invite') {
                        vscode.env.clipboard.writeText(instance.roomId);
                        const copyWithServer = vscode.l10n.t('Copy with Server URL');
                        vscode.window.showInformationMessage(vscode.l10n.t('Invitation code {0} copied to clipboard!', instance.roomId), copyWithServer).then(value => {
                            if (value === copyWithServer) {
                                vscode.env.clipboard.writeText(RoomUri.create({
                                    roomId: instance.roomId,
                                    serverUrl: instance.serverUrl
                                }));
                            }
                        });
                    } else if (result === 'stop') {
                        vscode.commands.executeCommand('oct.closeConnection');
                    }
                } else {
                    const items: QuickPickItem<'join' | 'create'>[] = [
                        {
                            key: 'join',
                            label: '$(vm-connect) ' + vscode.l10n.t('Join Collaboration Session'),
                            detail: vscode.l10n.t('Join an open collaboration session using an invitation code')
                        }
                    ];
                    if (vscode.workspace.workspaceFolders?.length) {
                        items.unshift({
                            key: 'create',
                            label: '$(add) ' + vscode.l10n.t('Create New Collaboration Session'),
                            detail: vscode.l10n.t('Become the host of a new collaboration session in your current workspace')
                        });
                    }
                    const index = await showQuickPick(items, {
                        placeholder: vscode.l10n.t('Select Collaboration Option')
                    });
                    if (index === 'create') {
                        await this.roomService.createRoom();
                    } else if (index === 'join') {
                        await this.roomService.joinRoom();
                    }
                }
            }),
            vscode.commands.registerCommand('oct.joinRoom', async () => {
                await this.roomService.joinRoom();
            }),
            vscode.commands.registerCommand('oct.createRoom', async () => {
                await this.roomService.createRoom();
            }),
            vscode.commands.registerCommand('oct.closeConnection', async () => {
                const instance = CollaborationInstance.Current;
                if (instance) {
                    await instance.leave();
                    instance.dispose();
                    this.contextKeyService.setConnection(undefined);
                    if (!instance.host) {
                        // Close the workspace if the user is not the host
                        await vscode.commands.executeCommand('workbench.action.closeFolder');
                    }
                }
            }),
            vscode.commands.registerCommand('oct.signOut', async () => {
                await vscode.commands.executeCommand('oct.closeConnection');
                await this.secretStorage.deleteUserTokens();
                vscode.window.showInformationMessage(vscode.l10n.t('Signed out successfully!'));
            })
        );
        this.statusService.initialize('oct.enter');
    }
}
