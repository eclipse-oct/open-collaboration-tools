// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { CollaborationInstance, PendingUser, PeerWithColor } from './collaboration-instance.js';
import { CollaborationRoomService } from './collaboration-room-service.js';

export type OpenCollaborationApiCapability =
    | 'session.lifecycle'
    | 'session.users'
    | 'session.pending-users'
    | 'session.permissions';

export interface OpenCollaborationConnection {
    readonly roomId: string;
    readonly serverUrl: string;
    readonly host: boolean;
    readonly ready: Promise<void>;
    readonly permissions: Readonly<{ readonly: boolean }>;
    readonly onDidUsersChange: vscode.Event<void>;
    readonly onDidPendingUsersChange: vscode.Event<void>;
    readonly onDidClose: vscode.Event<void>;
    getConnectedUsers(): Promise<readonly PeerWithColor[]>;
    getPendingUsers(): readonly PendingUser[];
    leave(): Promise<void>;
}

export interface ConnectionClosedEvent {
    readonly roomId: string;
    readonly serverUrl: string;
    readonly host: boolean;
}

export interface OpenCollaborationApiV1 extends vscode.Disposable {
    readonly apiVersion: 1;
    readonly capabilities: readonly OpenCollaborationApiCapability[];
    readonly onDidOpenConnection: vscode.Event<OpenCollaborationConnection>;
    readonly onDidCloseConnection: vscode.Event<ConnectionClosedEvent>;
    readonly onDidChangeConnection: vscode.Event<OpenCollaborationConnection | undefined>;
    getCurrentConnection(): OpenCollaborationConnection | undefined;
    createRoom(): Promise<void>;
    joinRoom(roomId?: string): Promise<void>;
    leaveCurrentRoom(): Promise<boolean>;
}

class OpenCollaborationConnectionImpl implements OpenCollaborationConnection {

    constructor(private readonly instance: CollaborationInstance) {
    }

    get roomId(): string {
        return this.instance.roomId;
    }

    get serverUrl(): string {
        return this.instance.serverUrl;
    }

    get host(): boolean {
        return this.instance.host;
    }

    get ready(): Promise<void> {
        return this.instance.ready;
    }

    get permissions(): Readonly<{ readonly: boolean }> {
        return this.instance.permissions;
    }

    get onDidUsersChange(): vscode.Event<void> {
        return this.instance.onDidUsersChange;
    }

    get onDidPendingUsersChange(): vscode.Event<void> {
        return this.instance.onDidPendingChange;
    }

    get onDidClose(): vscode.Event<void> {
        return this.instance.onDidDispose;
    }

    getConnectedUsers(): Promise<readonly PeerWithColor[]> {
        return this.instance.connectedUsers;
    }

    getPendingUsers(): readonly PendingUser[] {
        return this.instance.pendingUsers;
    }

    async leave(): Promise<void> {
        await this.instance.leave();
    }
}

class OpenCollaborationApiV1Impl implements OpenCollaborationApiV1 {

    readonly apiVersion = 1 as const;
    readonly capabilities: readonly OpenCollaborationApiCapability[] = [
        'session.lifecycle',
        'session.users',
        'session.pending-users',
        'session.permissions'
    ];

    private readonly onDidOpenConnectionEmitter = new vscode.EventEmitter<OpenCollaborationConnection>();
    readonly onDidOpenConnection = this.onDidOpenConnectionEmitter.event;

    private readonly onDidCloseConnectionEmitter = new vscode.EventEmitter<ConnectionClosedEvent>();
    readonly onDidCloseConnection = this.onDidCloseConnectionEmitter.event;

    private readonly onDidChangeConnectionEmitter = new vscode.EventEmitter<OpenCollaborationConnection | undefined>();
    readonly onDidChangeConnection = this.onDidChangeConnectionEmitter.event;

    private readonly toDispose: vscode.Disposable[] = [];
    private currentInstance: CollaborationInstance | undefined;

    constructor(private readonly roomService: CollaborationRoomService) {
        this.toDispose.push(this.onDidOpenConnectionEmitter);
        this.toDispose.push(this.onDidCloseConnectionEmitter);
        this.toDispose.push(this.onDidChangeConnectionEmitter);
        this.toDispose.push(this.roomService.onDidJoinRoom(instance => this.onDidJoinRoom(instance)));

        // Handle already-active sessions during extension reactivation.
        if (CollaborationInstance.Current) {
            this.onDidJoinRoom(CollaborationInstance.Current);
        }
    }

    getCurrentConnection(): OpenCollaborationConnection | undefined {
        const current = this.currentInstance;
        if (!current) {
            return undefined;
        }
        return new OpenCollaborationConnectionImpl(current);
    }

    async createRoom(): Promise<void> {
        await this.roomService.createRoom();
    }

    async joinRoom(roomId?: string): Promise<void> {
        await this.roomService.joinRoom(roomId);
    }

    async leaveCurrentRoom(): Promise<boolean> {
        const current = this.currentInstance;
        if (!current) {
            return false;
        }
        await current.leave();
        return true;
    }

    dispose(): void {
        for (const disposable of this.toDispose.splice(0, this.toDispose.length)) {
            disposable.dispose();
        }
    }

    private onDidJoinRoom(instance: CollaborationInstance): void {
        this.currentInstance = instance;
        const connection = new OpenCollaborationConnectionImpl(instance);
        this.onDidOpenConnectionEmitter.fire(connection);
        this.onDidChangeConnectionEmitter.fire(connection);

        const closeDisposable = instance.onDidDispose(() => {
            if (this.currentInstance !== instance) {
                return;
            }
            this.currentInstance = undefined;
            this.onDidCloseConnectionEmitter.fire({
                roomId: instance.roomId,
                serverUrl: instance.serverUrl,
                host: instance.host
            });
            this.onDidChangeConnectionEmitter.fire(undefined);
            closeDisposable.dispose();
        });
        this.toDispose.push(closeDisposable);
    }
}

export function createOpenCollaborationApi(roomService: CollaborationRoomService): OpenCollaborationApiV1 {
    return new OpenCollaborationApiV1Impl(roomService);
}
