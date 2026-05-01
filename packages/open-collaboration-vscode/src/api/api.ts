// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type * as vscodeType from 'vscode';
import * as vscode from 'vscode';
import {
    Access,
    type ContactServiceProvider,
    type ContactsCollection,
    LiveShare,
    Role,
    type Server,
    type Activity,
    type JoinOptions,
    type Peer,
    type PeersChangeEvent,
    type PresenceProvider,
    type PresenceProviderEvent,
    type Services,
    type Session,
    type SessionChangeEvent,
    type ShareOptions,
    type SharedService,
    type SharedServiceProxy,
    type UserInfo,
    View
} from 'vsls/vscode';

import { CollaborationInstance } from '../collaboration-instance.js';
import { CollaborationRoomService } from '../collaboration-room-service.js';
import { OctSharedService, OctSharedServiceProxy } from './shared-service.js';

/**
 * Re-export Live Share types for compatibility.
 */
export type { Access, Activity, JoinOptions, Peer, PeersChangeEvent, PresenceProvider, PresenceProviderEvent, Role, Services, Session, SessionChangeEvent, ShareOptions, SharedService, SharedServiceProxy, UserInfo };

/**
 * Root interface for accessing the Open Collaboration API.
 */
export interface OpenCollaborationExtension {
    /**
     * Retrieves the Open Collaboration API for a given version.
     * @returns The API, or null if not available or activation failed.
     */
    getApi(apiVersion: string): Promise<LiveShare | null>;
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
class OpenCollaborationSessionImpl implements LiveShare {

    private readonly onDidChangeSessionEmitter = new vscode.EventEmitter<SessionChangeEvent>();
    readonly onDidChangeSession = this.onDidChangeSessionEmitter.event;

    private readonly onDidChangePeersEmitter = new vscode.EventEmitter<PeersChangeEvent>();
    readonly onDidChangePeers = this.onDidChangePeersEmitter.event;

    private currentInstance: CollaborationInstance | undefined;
    private peersByUserId: Map<string, Peer> = new Map();
    private readonly sharedServices = new Map<string, OctSharedService>();
    private readonly sharedServiceProxies = new Map<string, OctSharedServiceProxy>();

    constructor(private readonly roomService: CollaborationRoomService) {

        this.roomService.onDidJoinRoom(instance => this.attachInstance(instance));

        // Wire up an already-active instance (e.g. extension re-activation)
        if (CollaborationInstance.Current) {
            this.attachInstance(CollaborationInstance.Current);
        }
    }

    private attachInstance(instance: CollaborationInstance): void {
        this.currentInstance = instance;
        this.peersByUserId.clear();
        this.updateServiceAvailability();
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
            this.updateServiceAvailability();
            this.onDidChangeSessionEmitter.fire({ session: SESSION_NO_ACTIVE });
        });
    }

    private updateServiceAvailability(): void {
        const canShare = Boolean(this.currentInstance?.host);
        const canUseProxy = Boolean(this.currentInstance && !this.currentInstance.host);
        const hostPeerId = this.currentInstance?.hostId;

        for (const service of this.sharedServices.values()) {
            service.setAvailable(canShare);
        }
        for (const proxy of this.sharedServiceProxies.values()) {
            proxy.setHostPeerId(hostPeerId);
            proxy.setAvailable(canUseProxy);
        }
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

    get peers(): Peer[] {
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

    async shareService(name: string): Promise<SharedService | null> {
        if (!this.currentInstance?.host) {
            return null;
        }
        const existing = this.sharedServices.get(name);
        if (existing) {
            return existing;
        }
        const service = new OctSharedService(this.currentInstance.connection, name, true);
        this.sharedServices.set(name, service);
        this.updateServiceAvailability();
        return service;
    }

    async unshareService(name: string): Promise<void> {
        const service = this.sharedServices.get(name);
        if (service) {
            service.deactivate();
            this.sharedServices.delete(name);
        }
    }

    async getSharedService(name: string): Promise<SharedServiceProxy | null> {
        if (!this.currentInstance || this.currentInstance.host) {
            return null;
        }

        const existing = this.sharedServiceProxies.get(name);
        if (existing) {
            existing.setHostPeerId(this.currentInstance.hostId);
            existing.setAvailable(true);
            return existing;
        }

        const proxy = new OctSharedServiceProxy(
            this.currentInstance.connection,
            name,
            this.currentInstance.hostId,
            true,
        );
        this.sharedServiceProxies.set(name, proxy);
        this.updateServiceAvailability();
        return proxy;
    }

    convertLocalUriToShared(localUri: vscodeType.Uri): vscodeType.Uri {
        // OCT uses oct:// scheme. For now, convert file:// URIs to oct:// if in a shared workspace.
        // Placeholder: return the input URI as-is.
        return localUri;
    }

    convertSharedUriToLocal(sharedUri: vscodeType.Uri): vscodeType.Uri {
        // Placeholder: return the input URI as-is.
        return sharedUri;
    }

    get presenceProviders(): PresenceProvider[] {
        // Not yet implemented in OCT.
        return [];
    }

    private readonly onPresenceProviderRegisteredEmitter = new vscode.EventEmitter<PresenceProviderEvent>();
    readonly onPresenceProviderRegistered = this.onPresenceProviderRegisteredEmitter.event;

    get services(): Services {
        // Return a minimal Services object. Extended as OCT supports more features.
        return {
            async getRemoteServiceBroker() {
                // Not yet implemented in OCT.
                return null;
            },
        };
    }

    registerCommand(
        _command: string,
        _isEnabled?: () => boolean,
        _thisArg?: any,
    ): vscodeType.Disposable | null {
        return null;
    }

    registerTreeDataProvider<T>(
        _viewId: View,
        _treeDataProvider: vscodeType.TreeDataProvider<T>,
    ): vscodeType.Disposable | null {
        return null;
    }

    registerContactServiceProvider(
        _name: string,
        _contactServiceProvider: ContactServiceProvider,
    ): vscodeType.Disposable | null {
        return null;
    }

    async shareServer(_server: Server): Promise<vscodeType.Disposable> {
        throw new Error('shareServer is not yet supported in Open Collaboration Tools.');
    }

    async getContacts(_emails: string[]): Promise<ContactsCollection> {
        return {
            contacts: {},
            async dispose() {
                // no-op
            },
        };
    }

    async getPeerForTextDocumentChangeEvent(e: vscodeType.TextDocumentChangeEvent): Promise<Peer> {
        // Placeholder: cannot determine peer from OCT given a text document change.
        // This would require OCT's change event tracking; for now return a dummy peer.
        throw new Error('getPeerForTextDocumentChangeEvent is not yet supported in Open Collaboration Tools.');
    }

    async end(): Promise<void> {
        if (this.currentInstance) {
            await this.currentInstance.leave();
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

    async getApi(apiVersion: string): Promise<LiveShare | null> {
        if (apiVersion !== '1' && apiVersion !== '1.0') {
            return null;
        }
        return this.api;
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
