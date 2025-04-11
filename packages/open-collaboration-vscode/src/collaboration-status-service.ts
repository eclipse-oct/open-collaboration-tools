// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable, postConstruct } from 'inversify';
import { CollaborationRoomService } from './collaboration-room-service.js';
import { CollaborationStatusViewDataProvider } from './collaboration-status-view.js';
import { ExtensionContext } from './inversify.js';
import { ContextKeyService } from './context-key-service.js';
import { closeSharedEditors, removeWorkspaceFolders } from './utils/workspace.js';
import { isWeb } from './utils/system.js';

export enum StatusBarState {
    Idle,
    Sharing,
    Connected
}

@injectable()
export class CollaborationStatusService {

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    @inject(CollaborationRoomService)
    private roomService: CollaborationRoomService;

    @inject(CollaborationStatusViewDataProvider)
    private viewDataProvider: CollaborationStatusViewDataProvider;

    @inject(ContextKeyService)
    private contextKeyService: ContextKeyService;

    private statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);

    @postConstruct()
    protected init(): void {
        this.roomService.onDidJoinRoom(instance => {
            this.setState(instance.host ? StatusBarState.Sharing : StatusBarState.Connected);
            this.viewDataProvider.onConnection(instance);
            this.contextKeyService.setConnection(instance);
            instance.onDidDispose(() => {
                this.setState(StatusBarState.Idle);
                this.contextKeyService.setConnection(undefined);
                if (!instance.host) {
                    closeSharedEditors();
                    removeWorkspaceFolders();
                }
            });
        });
        this.context.subscriptions.push(
            vscode.window.registerTreeDataProvider('oct.roomView', this.viewDataProvider),
            this.statusBarItem
        );
    }

    initialize(commandId: string): void {
        this.setState(StatusBarState.Idle);
        this.statusBarItem.command = commandId;
        this.statusBarItem.tooltip = vscode.l10n.t('Start a collaboration session');
        this.statusBarItem.show();
        if (isWeb) {
            // For some reason, VS Code simply "swallows" our status bar item when running in web mode.
            // This will attempt to show it again every 200ms. After 30s, we disable that again.
            const interval = setInterval(() => this.statusBarItem.show(), 200);
            setTimeout(() => clearInterval(interval), 30_000);
        }
    }

    setState(state: StatusBarState) {
        switch (state) {
            case StatusBarState.Idle:
                this.statusBarItem.text = '$(git-compare) Open Collaboration';
                break;
            case StatusBarState.Sharing:
                this.statusBarItem.text = '$(broadcast) ' + vscode.l10n.t('Sharing');
                break;
            case StatusBarState.Connected:
                this.statusBarItem.text = '$(broadcast) ' + vscode.l10n.t('Collaborating');
                break;
        }
    }

}
