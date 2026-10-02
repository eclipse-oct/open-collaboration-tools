// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import * as types from 'open-collaboration-protocol';

export interface GuestTerminalCallbacks {
    /** Sends `terminal/input`. Never called for a read-only terminal. */
    sendInput(data: string): void;
    /** Sends `terminal/viewResize`. Informational only (§9). */
    sendViewResize(dimensions: types.TerminalDimensions): void;
}

/**
 * The guest-side view of a shared terminal: a `vscode.Pseudoterminal` that renders bytes it
 * receives over the wire and, for a read-write terminal, forwards keystrokes back to the
 * owner. Like the host's own view, it never echoes input locally - the host's pty is the only
 * source of echo, see docs/terminal-sharing.md §3.
 */
export class GuestTerminal implements vscode.Disposable {

    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number | void>();
    private readonly overrideDimensionsEmitter = new vscode.EventEmitter<vscode.TerminalDimensions | undefined>();
    private readonly changeNameEmitter = new vscode.EventEmitter<string>();

    readonly pseudoterminal: vscode.Pseudoterminal;

    private mode: types.TerminalAccessMode;

    constructor(initialInfo: types.TerminalInfo, initialBuffer: string, private readonly callbacks: GuestTerminalCallbacks) {
        this.mode = initialInfo.mode;

        this.pseudoterminal = {
            onDidWrite: this.writeEmitter.event,
            onDidClose: this.closeEmitter.event,
            onDidOverrideDimensions: this.overrideDimensionsEmitter.event,
            onDidChangeName: this.changeNameEmitter.event,
            open: () => {
                if (initialInfo.dimensions) {
                    this.overrideDimensionsEmitter.fire(initialInfo.dimensions);
                }
                if (initialBuffer) {
                    // Reset before replaying the serialized snapshot so a late join always
                    // starts from a clean screen, matching what `\x1bc` does on a real terminal.
                    this.writeEmitter.fire('\x1bc' + initialBuffer);
                }
                if (initialInfo.exit) {
                    this.showExit(initialInfo.exit);
                }
            },
            close: () => {
                // Cleanup (unsubscribe, map bookkeeping) is centralized in TerminalService's
                // global `vscode.window.onDidCloseTerminal` listener, which fires for both a
                // user-initiated close (this callback) and an extension-initiated one (firing
                // `onDidClose` from `notifyClosed` below) - one place, no double-teardown.
            },
            handleInput: data => {
                if (this.mode === 'readWrite') {
                    this.callbacks.sendInput(data);
                }
            },
            setDimensions: dimensions => {
                this.callbacks.sendViewResize(dimensions);
            }
        };
    }

    /** Applies a chunk of output received via `terminal/output`. */
    write(data: string): void {
        this.writeEmitter.fire(data);
    }

    /** Applies a snapshot received from a fresh `terminal/subscribe`, e.g. after a reconnect. */
    applySnapshot(info: types.TerminalInfo, buffer: string): void {
        this.updateInfo(info);
        this.writeEmitter.fire('\x1bc' + buffer);
    }

    updateInfo(info: types.TerminalInfo): void {
        this.mode = info.mode;
        this.changeNameEmitter.fire(info.name);
        if (info.dimensions) {
            this.overrideDimensionsEmitter.fire(info.dimensions);
        }
    }

    notifyClosed(exit: types.TerminalExit | undefined): void {
        this.showExit(exit);
        this.closeEmitter.fire(exit?.code);
    }

    private showExit(exit: types.TerminalExit | undefined): void {
        const description = exit?.signal
            ? vscode.l10n.t('Process terminated by signal {0}', exit.signal)
            : vscode.l10n.t('Process exited with code {0}', String(exit?.code ?? 0));
        this.writeEmitter.fire(`\r\n\x1b[2m[${description}]\x1b[0m\r\n`);
    }

    dispose(): void {
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
        this.overrideDimensionsEmitter.dispose();
        this.changeNameEmitter.dispose();
    }
}
