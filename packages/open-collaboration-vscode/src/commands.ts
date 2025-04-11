// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { FollowService } from './follow-service.js';
import { CollaborationInstance, PeerWithColor } from './collaboration-instance.js';
import { ExtensionContext } from './inversify.js';
import { QuickPickItem, showQuickPick } from './utils/quick-pick.js';
import { ContextKeyService } from './context-key-service.js';
import { CollaborationRoomService } from './collaboration-room-service.js';
import { CollaborationStatusService } from './collaboration-status-service.js';
import { SecretStorage } from './secret-storage.js';
import { RoomUri } from './utils/uri.js';
import { CodeCommands, OctCommands } from './commands-list.js';

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
            vscode.commands.registerCommand(OctCommands.FollowPeer, (peer?: PeerWithColor) => this.followService.followPeer(peer?.id)),
            vscode.commands.registerCommand(OctCommands.StopFollowPeer, () => this.followService.unfollowPeer()),
            vscode.commands.registerCommand(OctCommands.Enter, async () => {
                await this.openMainQuickpick();
            }),
            vscode.commands.registerCommand(OctCommands.JoinRoom, async () => {
                await this.roomService.joinRoom();
            }),
            vscode.commands.registerCommand(OctCommands.CreateRoom, async () => {
                await this.roomService.createRoom();
            }),
            vscode.commands.registerCommand(OctCommands.CloseConnection, async () => {
                const instance = CollaborationInstance.Current;
                if (instance) {
                    await instance.leave();
                    instance.dispose();
                    this.contextKeyService.setConnection(undefined);
                    if (!instance.host) {
                        // Close the workspace if the user is not the host
                        await vscode.commands.executeCommand(CodeCommands.CloseFolder);
                    }
                }
            }),
            vscode.commands.registerCommand(OctCommands.SignOut, async () => {
                await vscode.commands.executeCommand(OctCommands.CloseConnection);
                await this.secretStorage.deleteUserTokens();
                vscode.window.showInformationMessage(vscode.l10n.t('Signed out successfully!'));
            })
        );
        if (typeof process === 'object' && process && process.env?.DEVELOPMENT === 'true') {
            this.contextKeyService.set('oct.dev', true);
            this.context.subscriptions.push(
                vscode.commands.registerCommand(OctCommands.DevFuzzing, async () => {
                    const editor = vscode.window.activeTextEditor;
                    // Generate random character a-z
                    const char = String.fromCharCode(Math.floor(Math.random() * 26) + 97);
                    if (editor) {
                        const interval = setInterval(() => {
                            if (vscode.window.activeTextEditor !== editor) {
                                // If the user changes the editor or closes it, end the fuzzing
                                clearInterval(interval);
                                return;
                            }
                            editor.edit(builder => {
                                builder.insert(editor.selection.start, char);
                            });
                        }, 50);
                    }
                })
            );
        }
        this.statusService.initialize(OctCommands.Enter);
    }

    private async openMainQuickpick(): Promise<void> {
        const instance = CollaborationInstance.Current;
        if (instance) {
            await this.openMainQuickpickInSession(instance);
        } else {
            await this.openMainQuickpickOutsideSession();
        }
    }

    private async openMainQuickpickOutsideSession(): Promise<void> {
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

    private async openMainQuickpickInSession(instance: CollaborationInstance): Promise<void> {
        const items: QuickPickItem<'invite' | 'stop' | 'update'>[] = [
            {
                key: 'invite',
                label: '$(clippy) ' + vscode.l10n.t('Invite Others (Copy Code)'),
                detail: vscode.l10n.t('Copy the invitation code to the clipboard to share with others')
            }
        ];
        if (instance.host) {
            items.push({
                key: 'update',
                label: '$(gear) ' + vscode.l10n.t('Configure Collaboration Session'),
                detail: vscode.l10n.t('Configure the options and permissions of the current session')
            });
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
            await this.inviteCallback(instance);
        } else if (result === 'update') {
            await this.updatePermissions(instance);
        } else if (result === 'stop') {
            await vscode.commands.executeCommand(OctCommands.CloseConnection);
        }
    }

    async inviteCallback(instance: CollaborationInstance): Promise<void> {
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
    }

    async updatePermissions(instance: CollaborationInstance): Promise<void> {
        const permissions: QuickPickItem<'readonly' | 'readwrite'>[] = [];
        if (instance.permissions.readonly) {
            permissions.push({
                key: 'readwrite',
                label: '$(unlock) ' + vscode.l10n.t('Enable Editing'),
                detail: vscode.l10n.t('Allow all participants to edit files in the workspace')
            });
        } else {
            permissions.push({
                key: 'readonly',
                label: '$(lock) ' + vscode.l10n.t('Make Read-Only'),
                detail: vscode.l10n.t('Prevent all participants from editing the workspace')
            });
        }
        const result = await showQuickPick(permissions, {
            placeholder: vscode.l10n.t('Select Permissions')
        });
        if (result === 'readonly') {
            instance.setPermissions({ readonly: true });
        } else if (result === 'readwrite') {
            instance.setPermissions({ readonly: false });
        }
    }
}
