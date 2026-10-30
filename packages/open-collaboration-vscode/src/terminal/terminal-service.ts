// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import * as os from 'node:os';
import * as types from 'open-collaboration-protocol';
import { ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import { inject, injectable } from 'inversify';
import { nanoid } from 'nanoid';
import { CollaborationInstance } from '../collaboration-instance.js';
import { CollaborationRoomService } from '../collaboration-room-service.js';
import { Settings } from '../utils/settings.js';
import { QuickPickItem, showQuickPick } from '../utils/quick-pick.js';
import { SharedTerminal } from './shared-terminal.js';
import { GuestTerminal } from './guest-terminal.js';
import { isNodePtyAvailable } from './node-pty-backend.js';

/**
 * Owns terminal sharing for the lifetime of one collaboration session. Only one
 * `CollaborationInstance` is ever active at a time (see inversify.ts), so this service keeps
 * a single flat set of fields that gets reset whenever a room is joined or left, rather than
 * one instance per room.
 *
 * On the host it owns the actual `SharedTerminal`s (pty + local view + subscriber bookkeeping).
 * On a guest it only keeps the terminals the user actually opened (rendered as `GuestTerminal`
 * views); the list of shared terminals is requested from the host on demand. Never bound or referenced from extension-web.ts: node-pty is a
 * native module and must stay unreachable from the web bundle (docs/terminal-sharing.md §4.3).
 */
@injectable()
export class TerminalService implements vscode.Disposable {

    @inject(CollaborationRoomService)
    private readonly roomService: CollaborationRoomService;

    private instance: CollaborationInstance | undefined;
    private connection: ProtocolBroadcastConnection | undefined;
    /** Listeners that live for the whole extension lifetime. */
    private readonly toDispose: vscode.Disposable[] = [];
    /** Listeners scoped to the current room session, torn down again in `reset()`. */
    private readonly sessionDisposables: vscode.Disposable[] = [];

    // --- host state -----------------------------------------------------------------------
    private readonly terminals = new Map<types.TerminalId, SharedTerminal>();
    private readonly hostViews = new Map<types.TerminalId, vscode.Terminal>();

    // --- guest state ------------------------------------------------------------------------
    private readonly guestViews = new Map<types.TerminalId, GuestTerminal>();
    private readonly guestVscodeTerminals = new Map<types.TerminalId, vscode.Terminal>();
    private readonly expectedSeq = new Map<types.TerminalId, number>();

    initialize(): void {
        this.toDispose.push(
            this.roomService.onDidJoinRoom(instance => this.onJoinRoom(instance)),
            vscode.window.onDidCloseTerminal(terminal => this.onDidCloseVscodeTerminal(terminal))
        );
    }

    private onJoinRoom(instance: CollaborationInstance): void {
        this.reset();
        this.instance = instance;
        this.connection = instance.connection;
        if (instance.host) {
            this.registerHostHandlers(instance);
        } else {
            this.registerGuestHandlers(instance);
        }
        instance.onDidDispose(() => this.reset());
    }

    private reset(): void {
        this.sessionDisposables.forEach(d => d.dispose());
        this.sessionDisposables.length = 0;

        for (const terminal of this.hostViews.values()) {
            terminal.dispose();
        }
        this.hostViews.clear();
        for (const terminal of this.terminals.values()) {
            terminal.dispose();
        }
        this.terminals.clear();

        for (const terminal of this.guestVscodeTerminals.values()) {
            terminal.dispose();
        }
        this.guestVscodeTerminals.clear();
        for (const view of this.guestViews.values()) {
            view.dispose();
        }
        this.guestViews.clear();
        this.expectedSeq.clear();

        this.instance = undefined;
        this.connection = undefined;
    }

    // === Host =================================================================================

    private registerHostHandlers(instance: CollaborationInstance): void {
        instance.setCapabilities({ terminals: isNodePtyAvailable() });

        const connection = instance.connection;
        connection.terminal.onList(() => Array.from(this.terminals.values()).map(terminal => terminal.info));
        connection.terminal.onSubscribe((origin, id) => {
            const terminal = this.terminals.get(id);
            if (!terminal) {
                throw new Error(`Unknown terminal: ${id}`);
            }
            return terminal.addSubscriber(origin);
        });
        connection.terminal.onUnsubscribe((origin, id) => {
            this.terminals.get(id)?.removeSubscriber(origin);
        });
        connection.terminal.onInput((origin, id, data) => {
            // Only a current subscriber may drive this terminal - an unsubscribed peer that
            // never had access is never trusted just because it knows the id.
            const terminal = this.terminals.get(id);
            if (terminal?.hasSubscriber(origin)) {
                terminal.handleRemoteInput(data);
            }
        });
        connection.terminal.onViewResize((origin, id, dimensions) => {
            this.terminals.get(id)?.handleRemoteViewResize(origin, dimensions);
        });

        // The connection's own room.onJoin/onLeave handlers are already owned by
        // CollaborationInstance (each message type only supports a single handler, see
        // abstract-connection.ts), so peer departures are observed indirectly here.
        this.sessionDisposables.push(instance.onDidUsersChange(async () => {
            const liveIds = new Set((await instance.connectedUsers).map(user => user.id));
            for (const terminal of this.terminals.values()) {
                for (const peerId of terminal.subscriberIds) {
                    if (!liveIds.has(peerId)) {
                        terminal.removeSubscriber(peerId);
                    }
                }
            }
        }));
    }

    async shareTerminal(): Promise<void> {
        const instance = this.instance;
        if (!instance?.host || !this.connection) {
            vscode.window.showErrorMessage(vscode.l10n.t('You must be hosting a collaboration session to share a terminal.'));
            return;
        }
        if (!isNodePtyAvailable()) {
            const openSettings = vscode.l10n.t('Learn More');
            vscode.window.showErrorMessage(
                vscode.l10n.t('Terminal sharing is unavailable: the native node-pty module could not be loaded on this platform or architecture.'),
                openSettings
            ).then(choice => {
                if (choice === openSettings) {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/eclipse-oct/open-collaboration-tools/blob/main/docs/terminal-sharing.md'));
                }
            });
            return;
        }

        const mode = await this.pickAccessMode();
        if (!mode) {
            return;
        }
        if (mode === 'readWrite' && !(await this.confirmReadWriteWarning())) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder?.uri.scheme === 'file' ? workspaceFolder.uri.fsPath : os.homedir();
        const id = nanoid();
        const ownPeer = await instance.ownUserData;
        const name = vscode.l10n.t('Shared Terminal');

        const terminal = new SharedTerminal({
            id,
            name,
            mode,
            ownerId: ownPeer.id,
            shell: Settings.getTerminalShell() ?? defaultShell(),
            shellArgs: Settings.getTerminalShellArgs(),
            cwd,
            scrollback: Settings.getTerminalScrollback(),
            isRoomReadonly: () => instance.permissions.readonly
        });
        this.terminals.set(id, terminal);

        terminal.onDidOutput(chunk => {
            // Output is targeted: only peers that subscribed to this terminal receive it.
            for (const peerId of terminal.subscriberIds) {
                this.connection?.terminal.output(peerId, id, chunk);
            }
        });
        terminal.onDidUpdate(() => {
            this.connection?.terminal.updated(terminal.info);
        });
        terminal.onDidExit(exit => {
            this.connection?.terminal.closed(id, exit);
        });

        const vsTerminal = vscode.window.createTerminal({
            name,
            pty: terminal.pseudoterminal,
            iconPath: new vscode.ThemeIcon('broadcast'),
            location: vscode.TerminalLocation.Panel
        });
        this.hostViews.set(id, vsTerminal);
        vsTerminal.show();

        this.connection?.terminal.opened(terminal.info);
    }

    private async pickAccessMode(): Promise<types.TerminalAccessMode | undefined> {
        const defaultMode = Settings.getTerminalDefaultAccessMode();
        const readLabel = '$(eye) ' + vscode.l10n.t('Read Only');
        const readWriteLabel = '$(edit) ' + vscode.l10n.t('Read & Write');
        const items: Array<QuickPickItem<types.TerminalAccessMode>> = [
            {
                key: 'read',
                label: defaultMode === 'read' ? readLabel + ' ' + vscode.l10n.t('(default)') : readLabel,
                detail: vscode.l10n.t('Participants can watch the terminal, but not type into it')
            },
            {
                key: 'readWrite',
                label: defaultMode === 'readWrite' ? readWriteLabel + ' ' + vscode.l10n.t('(default)') : readWriteLabel,
                detail: vscode.l10n.t('Participants can type into the terminal, running commands on your machine')
            }
        ];
        return showQuickPick(items, {
            placeholder: vscode.l10n.t('Select Access Mode for the Shared Terminal')
        });
    }

    private async confirmReadWriteWarning(): Promise<boolean> {
        const proceed = vscode.l10n.t('Share with Write Access');
        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t('Granting write access lets every participant of this session run arbitrary commands on your machine as you. It also bypasses "oct.files.exclude": a participant could read excluded files (e.g. .env) by simply typing "cat .env".'),
            { modal: true },
            proceed
        );
        return choice === proceed;
    }

    // === Guest =================================================================================

    private registerGuestHandlers(instance: CollaborationInstance): void {
        const connection = instance.connection;
        // Opened/Updated/Closed are broadcasts; only the ones for terminals we have open matter.
        connection.terminal.onOpened((origin, info) => {
            if (origin === instance.hostId) {
                this.notifyOpened(info);
            }
        });
        connection.terminal.onUpdated((origin, info) => {
            if (origin === instance.hostId) {
                this.guestViews.get(info.id)?.updateInfo(info);
            }
        });
        connection.terminal.onClosed((origin, id, exit) => {
            if (origin === instance.hostId) {
                this.guestViews.get(id)?.notifyClosed(exit);
            }
        });
        connection.terminal.onOutput((_, id, chunk) => {
            const view = this.guestViews.get(id);
            if (!view) {
                return;
            }
            const expected = this.expectedSeq.get(id) ?? 0;
            if (chunk.seq !== expected) {
                // A gap in the sequence: don't guess, just re-sync from a fresh snapshot.
                this.resubscribe(id);
                return;
            }
            view.write(chunk.data);
            this.expectedSeq.set(id, chunk.seq + 1);
        });

        this.sessionDisposables.push(connection.onReconnect(() => {
            for (const id of this.guestViews.keys()) {
                this.resubscribe(id);
            }
        }));
    }

    private notifyOpened(info: types.TerminalInfo): void {
        const open = vscode.l10n.t('Open');
        vscode.window.showInformationMessage(
            vscode.l10n.t('A terminal "{0}" was shared with you.', info.name),
            open
        ).then(choice => {
            if (choice === open) {
                this.openTerminal(info.id);
            }
        });
    }

    async openSharedTerminal(): Promise<void> {
        const instance = this.instance;
        if (!instance || instance.host || !this.connection || !instance.hostId) {
            return;
        }
        if (!instance.capabilities.terminals) {
            vscode.window.showInformationMessage(vscode.l10n.t('The host of this session does not support terminal sharing.'));
            return;
        }
        // Show the picker right away and fill it in once the host has answered.
        const quickPick = vscode.window.createQuickPick<QuickPickItem<types.TerminalId>>();
        quickPick.placeholder = vscode.l10n.t('Loading Shared Terminals...');
        quickPick.busy = true;
        let hidden = false;
        quickPick.onDidHide(() => hidden = true);
        this.connection.terminal.list(instance.hostId).then(infos => {
            if (hidden) {
                return;
            }
            quickPick.items = infos.map(info => ({
                key: info.id,
                label: '$(broadcast) ' + info.name,
                description: info.mode === 'read' ? vscode.l10n.t('read-only') : vscode.l10n.t('read & write'),
                detail: info.exit ? vscode.l10n.t('Process has exited') : undefined
            }));
            quickPick.placeholder = infos.length > 0
                ? vscode.l10n.t('Select a Shared Terminal to Open')
                : vscode.l10n.t('No terminals have been shared in this session yet.');
            quickPick.busy = false;
        }, error => {
            if (hidden) {
                return;
            }
            quickPick.hide();
            vscode.window.showErrorMessage(vscode.l10n.t('Could not retrieve the shared terminals: {0}', String(error)));
        });
        const id = await showQuickPick(quickPick);
        quickPick.dispose();
        if (id) {
            await this.openTerminal(id);
        }
    }

    private async openTerminal(id: types.TerminalId): Promise<void> {
        const existing = this.guestVscodeTerminals.get(id);
        if (existing) {
            existing.show();
            return;
        }
        const instance = this.instance;
        if (!instance || !this.connection || !instance.hostId) {
            return;
        }
        let snapshot: types.TerminalSnapshot;
        try {
            snapshot = await this.connection.terminal.subscribe(instance.hostId, id);
        } catch (error) {
            vscode.window.showErrorMessage(vscode.l10n.t('Could not open the shared terminal: {0}', String(error)));
            return;
        }
        this.expectedSeq.set(id, snapshot.seq + 1);

        const view = new GuestTerminal(snapshot.info, snapshot.buffer, {
            sendInput: data => this.connection?.terminal.input(instance.hostId!, id, data),
            sendViewResize: dimensions => this.connection?.terminal.viewResize(instance.hostId!, id, dimensions)
        });
        this.guestViews.set(id, view);

        const vsTerminal = vscode.window.createTerminal({
            name: snapshot.info.name,
            pty: view.pseudoterminal,
            iconPath: new vscode.ThemeIcon('broadcast'),
            location: vscode.TerminalLocation.Panel
        });
        this.guestVscodeTerminals.set(id, vsTerminal);
        vsTerminal.show();
    }

    private async resubscribe(id: types.TerminalId): Promise<void> {
        const instance = this.instance;
        const view = this.guestViews.get(id);
        if (!instance?.hostId || !this.connection || !view) {
            return;
        }
        try {
            const snapshot = await this.connection.terminal.subscribe(instance.hostId, id);
            this.expectedSeq.set(id, snapshot.seq + 1);
            view.applySnapshot(snapshot.info, snapshot.buffer);
        } catch {
            // The terminal may have been closed on the host in the meantime; a Closed
            // notification (already delivered, or still in flight) will handle the view.
        }
    }

    // === Shared cleanup =========================================================================

    private onDidCloseVscodeTerminal(vsTerminal: vscode.Terminal): void {
        for (const [id, terminal] of this.hostViews) {
            if (terminal === vsTerminal) {
                this.hostViews.delete(id);
                const shared = this.terminals.get(id);
                if (shared) {
                    if (!shared.info.exit) {
                        shared.kill();
                        this.connection?.terminal.closed(id, { signal: 'SIGHUP' });
                    }
                    this.terminals.delete(id);
                    shared.dispose();
                }
                return;
            }
        }
        for (const [id, terminal] of this.guestVscodeTerminals) {
            if (terminal === vsTerminal) {
                this.guestVscodeTerminals.delete(id);
                this.connection?.terminal.unsubscribe(this.instance?.hostId ?? '', id);
                this.guestViews.get(id)?.dispose();
                this.guestViews.delete(id);
                this.expectedSeq.delete(id);
                return;
            }
        }
    }

    dispose(): void {
        this.reset();
        this.toDispose.forEach(d => d.dispose());
        this.toDispose.length = 0;
    }
}

function defaultShell(): string {
    if (process.platform === 'win32') {
        return process.env.COMSPEC ?? 'powershell.exe';
    }
    return process.env.SHELL ?? '/bin/bash';
}
