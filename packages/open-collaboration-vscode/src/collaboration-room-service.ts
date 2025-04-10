// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { ConnectionProvider, stringifyError } from 'open-collaboration-protocol';
import { CollaborationInstance, CollaborationInstanceFactory } from './collaboration-instance.js';
import { CollaborationUri, RoomUri } from './utils/uri.js';
import { inject, injectable } from 'inversify';
import { CollaborationConnectionProvider } from './collaboration-connection-provider.js';
import { localizeInfo } from './utils/l10n.js';
import { isWeb } from './utils/system.js';
import { Settings } from './utils/settings.js';
import { RoomData, SecretStorage } from './secret-storage.js';
import { storeWorkspace } from './utils/workspace.js';
import { ExtensionContext } from './inversify.js';
import { CodeCommands } from './commands-list.js';

@injectable()
export class CollaborationRoomService {

    @inject(CollaborationConnectionProvider)
    private connectionProvider: CollaborationConnectionProvider;

    @inject(CollaborationInstanceFactory)
    private instanceFactory: CollaborationInstanceFactory;

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    @inject(SecretStorage)
    private secretStore: SecretStorage;

    private readonly onDidJoinRoomEmitter = new vscode.EventEmitter<CollaborationInstance>();
    readonly onDidJoinRoom = this.onDidJoinRoomEmitter.event;

    private tokenSource = new vscode.CancellationTokenSource();

    async tryConnect(): Promise<CollaborationInstance | undefined> {
        const roomData = await this.secretStore.consumeRoomData();
        if (roomData) {
            const connectionProvider = await this.connectionProvider.createConnection(roomData.serverUrl);
            const connection = await connectionProvider.connect(roomData.roomToken, roomData.host);
            const instance = this.instanceFactory({
                connection,
                serverUrl: roomData.serverUrl,
                host: false,
                roomId: roomData.roomId,
                hostId: roomData.host.id
            });
            this.onDidJoinRoomEmitter.fire(instance);
            return instance;
        }
        return undefined;
    }

    async createRoom(): Promise<void> {
        this.withConnectionProvider(undefined, async (connectionProvider, url) => {
            this.tokenSource.cancel();
            this.tokenSource = new vscode.CancellationTokenSource();
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Creating Session'), cancellable: true }, async (progress, cancelToken) => {
                const outerToken = this.tokenSource.token;
                try {
                    const roomClaim = await connectionProvider.createRoom({
                        abortSignal: this.toAbortSignal(this.tokenSource.token, cancelToken),
                        reporter: info => progress.report({ message: localizeInfo(info) })
                    });
                    if (roomClaim.loginToken) {
                        const userToken = roomClaim.loginToken;
                        await this.secretStore.storeUserToken(url, userToken);
                    }
                    const connection = await connectionProvider.connect(roomClaim.roomToken);
                    const instance = this.instanceFactory({
                        serverUrl: url,
                        connection,
                        host: true,
                        roomId: roomClaim.roomId
                    });
                    await vscode.env.clipboard.writeText(roomClaim.roomId);
                    const copyToClipboard = vscode.l10n.t('Copy to Clipboard');
                    const copyWithServer = vscode.l10n.t('Copy with Server URL');
                    const message = vscode.l10n.t('Created session {0}. Invitation code was automatically written to clipboard.', roomClaim.roomId);
                    vscode.window.showInformationMessage(message, copyToClipboard, copyWithServer).then(value => {
                        if (value === copyToClipboard) {
                            vscode.env.clipboard.writeText(roomClaim.roomId);
                        } else if (value === copyWithServer) {
                            vscode.env.clipboard.writeText(RoomUri.create({
                                roomId: roomClaim.roomId,
                                serverUrl: url
                            }));
                        }
                    });
                    this.onDidJoinRoomEmitter.fire(instance);
                } catch (error) {
                    this.showError(true, error, outerToken, cancelToken);
                }
            });
        });
    }

    async joinRoom(roomId?: string): Promise<void> {
        if (!roomId) {
            roomId = await vscode.window.showInputBox({ placeHolder: vscode.l10n.t('Enter the invitation code') });
            if (!roomId) {
                return;
            }
        }

        let parsedUrl: string | undefined;
        try {
            const roomUri = RoomUri.parse(roomId);
            roomId = roomUri.roomId;
            if (roomUri.serverUrl) {
                parsedUrl = roomUri.serverUrl;
                this.askToOverrideServerUrl(parsedUrl);
            }
        } catch {
            vscode.window.showErrorMessage(vscode.l10n.t('Invalid invitation code! Invitation codes must be either a string of alphanumeric characters or a URL with a fragment.'));
            return;
        }

        await this.withConnectionProvider(parsedUrl, async (connectionProvider, url) => {
            this.tokenSource.cancel();
            this.tokenSource = new vscode.CancellationTokenSource();
            const success = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Joining Session'), cancellable: true }, async (progress, cancelToken) => {
                if (roomId) {
                    const outerToken = this.tokenSource.token;
                    try {
                        const roomClaim = await connectionProvider.joinRoom({
                            roomId,
                            reporter: info => progress.report({ message: localizeInfo(info) }),
                            abortSignal: this.toAbortSignal(outerToken, cancelToken)
                        });
                        if (roomClaim.loginToken) {
                            const userToken = roomClaim.loginToken;
                            await this.secretStore.storeUserToken(url, userToken);
                        }
                        const roomData: RoomData = {
                            serverUrl: url,
                            roomToken: roomClaim.roomToken,
                            roomId: roomClaim.roomId,
                            host: roomClaim.host
                        };
                        await this.secretStore.storeRoomData(roomData);
                        const workspaceFolders = (vscode.workspace.workspaceFolders ?? []);
                        const workspace = roomClaim.workspace;
                        const newFolders = workspace.folders.map(folder => ({
                            name: folder,
                            uri: CollaborationUri.create(workspace.name, folder)
                        }));
                        const uri = await storeWorkspace(newFolders, this.context.globalStorageUri);
                        if (uri) {
                            // We were able to store the workspace folders in a file
                            // We now attempt to load that workspace file
                            await vscode.commands.executeCommand(CodeCommands.OpenFolder, uri, {
                                forceNewWindow: false,
                                forceReuseWindow: true,
                                noRecentEntry: true
                            });
                            return true;
                        } else {
                            return vscode.workspace.updateWorkspaceFolders(0, workspaceFolders.length, ...newFolders);
                        }
                    } catch (error) {
                        this.showError(false, error, outerToken, cancelToken);
                    }
                }
                return false;
            });
            if (success && isWeb) {
                // It seems like the web extension mode doesn't restart the extension host upon changing workspace folders
                // However, force restarting the extension host by reloading the window removes the current workspace folders
                // Therefore, we simply attempt to connect after a short delay after receiving the success signal
                setTimeout(() => {
                    this.tryConnect();
                }, 500);
            }
        });
    }

    private showError(create: boolean, error: unknown, outerToken: vscode.CancellationToken, innerToken: vscode.CancellationToken): void {
        if (outerToken.isCancellationRequested) {
            // The user already attempts to join another room
            // Simply ignore the error
            return;
        } else if (innerToken.isCancellationRequested) {
            // The user cancelled the operation
            // We simply show a notification
            vscode.window.showInformationMessage(vscode.l10n.t('Action was cancelled by the user'));
        } else if (create) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to create session: {0}', stringifyError(error, localizeInfo)));
        } else {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to join session: {0}', stringifyError(error, localizeInfo)));
        }
    }

    private toAbortSignal(...tokens: vscode.CancellationToken[]): AbortSignal {
        const controller = new AbortController();
        tokens.forEach(token => token.onCancellationRequested(() => controller.abort()));
        return controller.signal;
    }

    private async withConnectionProvider(serverUrl: string | undefined, callback: (connectionProvider: ConnectionProvider, url: string) => (Promise<void> | void)): Promise<void> {
        if (serverUrl) {
            serverUrl = RoomUri.normalizeServerUri(serverUrl);
        } else {
            serverUrl = Settings.getServerUrl();
        }
        if (serverUrl) {
            const connectionProvider = await this.connectionProvider.createConnection(serverUrl);
            await callback(connectionProvider, serverUrl);
        } else {
            this.showServerUrlMissingError();
        }
    }

    private showServerUrlMissingError(): void {
        const message = vscode.l10n.t('No Open Collaboration Server configured. Please set the server URL in the settings.');
        const openSettings = vscode.l10n.t('Open Settings');
        vscode.window.showInformationMessage(message, openSettings).then((selection) => {
            if (selection === openSettings) {
                vscode.commands.executeCommand(CodeCommands.OpenSettings, Settings.SERVER_URL);
            }
        });
    }

    private async askToOverrideServerUrl(url: string): Promise<void> {
        const currentSetting = Settings.getServerUrl();
        // If the current setting is the same as the URL, or the user has disabled the override, we don't ask
        if (currentSetting === url || !Settings.getServerUrlOverride()) {
            return;
        }
        const message = vscode.l10n.t('Do you want to override the server URL setting with {0}?', url);
        const yes = vscode.l10n.t('Yes');
        const no = vscode.l10n.t('No');
        const never = vscode.l10n.t('Never');
        const choice = await vscode.window.showInformationMessage(message, yes, no, never);
        if (choice === yes) {
            Settings.setServerUrl(url);
        } else if (choice === never) {
            Settings.setServerUrlOverride(false);
        }
    }
}
