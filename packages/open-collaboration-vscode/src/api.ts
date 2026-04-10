// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type * as vscodeType from 'vscode';
import * as vscode from 'vscode';
import {
    Access,
    Role,
    type JoinOptions,
    type Peer,
    type PeersChangeEvent,
    type Session,
    type SessionChangeEvent,
    type ShareOptions,
    type UserInfo
} from 'vsls/vscode';

import { CollaborationInstance } from './collaboration-instance.js';
import { CollaborationRoomService } from './collaboration-room-service.js';

/**
 * Re-export Live Share types for compatibility.
 */
export type { Access, JoinOptions, Peer, PeersChangeEvent, Role, Session, SessionChangeEvent, ShareOptions, UserInfo };

/**
 * Main Open Collaboration API. This interface provides session lifecycle management,
 * peer information, and event notifications for collaboration sessions.
 *
 * This API is designed as a drop-in compatible replacement for VS Live Share's API,
 * adapted for Open Collaboration Tools.
 */
export interface OpenCollaborationSession {
    /**
     * Status of the current collaboration session, including session info and user details.
     */
    readonly session: Session;

    /**
     * Event that notifies listeners when the collaboration session starts or ends.
     */
    readonly onDidChangeSession: vscodeType.Event<SessionChangeEvent>;

    /**
     * List of peers connected to the current session (excluding the current user).
     */
    readonly peers: readonly Peer[];

    /**
     * Event that notifies listeners when peers join or leave the session.
     */
    readonly onDidChangePeers: vscodeType.Event<PeersChangeEvent>;

    /**
     * Starts a new collaboration session, sharing the current workspace.
     *
     * @param options Configuration for the shared session.
     * @returns A promise that resolves to a share link (room ID URI), or null if sharing failed.
     */
    share(options?: ShareOptions): Promise<vscodeType.Uri | null>;

    /**
     * Joins an existing collaboration session using a room ID or share link.
     *
     * Joining another session typically requires reloading the window/workspace.
     *
     * @param link The room ID or share link (format: room-id or oct://workspace/room-id).
     * @param options Configuration for joining.
     */
    join(link: vscodeType.Uri | string, options?: JoinOptions): Promise<void>;

    /**
     * Ends the current collaboration session.
     * - As a host: stops sharing and disconnects all guests.
     * - As a guest: disconnects from the session and closes the workspace.
     */
    end(): Promise<void>;
}

/**
 * Root interface for accessing the Open Collaboration API.
 */
export interface OpenCollaborationExtension extends vscodeType.Disposable {
    /**
     * Retrieves the Open Collaboration API for a given version.
     * @returns The API, or null if not available or activation failed.
     */
    getApi(apiVersion: string): Promise<OpenCollaborationSession | null>;
}

// Session state when no collaboration session is active
const SESSION_NO_ACTIVE: Session = {
    peerNumber: 0,
    user: null,
    role: Role.None,
    access: Access.None,
    id: null,
    presentationMode: false,
};

let peerCounter = 1;

/**
 * Single long-lived implementation of OpenCollaborationSession.
 *
 * This object is created once and returned by getApi(). It reflects the
 * current collaboration state reactively — session and peers are empty/None
 * when no session is active, and filled in when a session starts.
 *
 * This matches the Live Share contract where getApi() always returns the same
 * stable object and consumers observe changes via events.
 */
class OpenCollaborationSessionImpl implements OpenCollaborationSession {

    private readonly onDidChangeSessionEmitter = new vscode.EventEmitter<SessionChangeEvent>();
    readonly onDidChangeSession = this.onDidChangeSessionEmitter.event;

    private readonly onDidChangePeersEmitter = new vscode.EventEmitter<PeersChangeEvent>();
    readonly onDidChangePeers = this.onDidChangePeersEmitter.event;

    private currentInstance: CollaborationInstance | undefined;
    private peersByUserId: Map<string, Peer> = new Map();
    private disposables: vscode.Disposable[] = [];

    constructor(private readonly roomService: CollaborationRoomService) {
        this.disposables.push(this.onDidChangeSessionEmitter);
        this.disposables.push(this.onDidChangePeersEmitter);

        this.disposables.push(
            this.roomService.onDidJoinRoom(instance => this.attachInstance(instance))
        );

        // Wire up an already-active instance (e.g. extension re-activation)
        if (CollaborationInstance.Current) {
            this.attachInstance(CollaborationInstance.Current);
        }
    }

    private attachInstance(instance: CollaborationInstance): void {
        this.currentInstance = instance;
        this.peersByUserId.clear();
        this.onDidChangeSessionEmitter.fire({ session: this.buildSession(instance) });

        const usersDisposable = instance.onDidUsersChange(() => this.syncPeers(instance));
        const disposeDisposable = instance.onDidDispose(() => {
            usersDisposable.dispose();
            disposeDisposable.dispose();
            // Clear all peers and fire removal event
            const removed = Array.from(this.peersByUserId.values());
            this.peersByUserId.clear();
            if (removed.length > 0) {
                this.onDidChangePeersEmitter.fire({ added: [], removed });
            }
            this.currentInstance = undefined;
            this.onDidChangeSessionEmitter.fire({ session: SESSION_NO_ACTIVE });
        });
    }

    private buildSession(instance: CollaborationInstance): Session {
        return {
            peerNumber: 0,
            user: null, // OCT doesn't expose own user info yet; extendable later
            role: instance.host ? Role.Host : Role.Guest,
            access: instance.permissions.readonly ? Access.ReadOnly : Access.ReadWrite,
            id: instance.roomId,
            presentationMode: false,
        };
    }

    private async syncPeers(instance: CollaborationInstance): Promise<void> {
        const connectedUsers = await instance.connectedUsers;
        const ownUser = await instance.ownUserData;

        const added: Peer[] = [];
        const removed: Peer[] = [];
        const seenIds = new Set<string>();

        for (const user of connectedUsers) {
            if (user.id === ownUser.id) {
                continue; // Skip self
            }
            seenIds.add(user.id);
            if (!this.peersByUserId.has(user.id)) {
                const peer: Peer = {
                    peerNumber: peerCounter++,
                    user: { displayName: user.name, emailAddress: null, userName: null, id: user.id },
                    role: instance.host ? Role.Guest : Role.Host,
                    access: instance.permissions.readonly ? Access.ReadOnly : Access.ReadWrite,
                };
                this.peersByUserId.set(user.id, peer);
                added.push(peer);
            }
        }

        for (const [userId, peer] of this.peersByUserId) {
            if (!seenIds.has(userId)) {
                this.peersByUserId.delete(userId);
                removed.push(peer);
            }
        }

        if (added.length > 0 || removed.length > 0) {
            this.onDidChangePeersEmitter.fire({ added, removed });
        }
    }

    get session(): Session {
        return this.currentInstance
            ? this.buildSession(this.currentInstance)
            : SESSION_NO_ACTIVE;
    }

    get peers(): readonly Peer[] {
        return Array.from(this.peersByUserId.values());
    }

    async share(_options?: ShareOptions): Promise<vscodeType.Uri | null> {

        await this.roomService.createRoom();
        // roomService fires onDidJoinRoom which triggers attachInstance.
        // The room ID becomes available via session.id after that event.
        const roomId = this.currentInstance?.roomId;
        return roomId ? vscode.Uri.parse(`oct://${roomId}`) : null;
    }

    async join(link: vscodeType.Uri | string, options?: JoinOptions): Promise<void> {
        const roomId = typeof link === 'string' ? link : link.toString();
        await this.roomService.joinRoom(roomId, options?.newWindow);
    }

    async end(): Promise<void> {
        if (this.currentInstance) {
            await this.currentInstance.leave();
        }
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

/**
 * Implementation of the root extension API.
 */
class OpenCollaborationExtensionImpl implements OpenCollaborationExtension {

    private readonly api: OpenCollaborationSessionImpl;

    constructor(roomService: CollaborationRoomService) {
        this.api = new OpenCollaborationSessionImpl(roomService);
    }

    async getApi(apiVersion: string): Promise<OpenCollaborationSession | null> {
        if (apiVersion !== '1' && apiVersion !== '1.0') {
            return null;
        }
        return this.api;
    }

    dispose(): void {
        this.api.dispose();
    }
}

/**
 * Creates the root Open Collaboration extension API.
 *
 * @returns Implementation of OpenCollaborationExtension.
 */
export function createOpenCollaborationExtensionApi(roomService: CollaborationRoomService): OpenCollaborationExtension {
    return new OpenCollaborationExtensionImpl(roomService);
}
