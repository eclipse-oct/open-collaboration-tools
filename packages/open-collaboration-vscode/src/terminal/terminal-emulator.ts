// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import * as vscode from 'vscode';

/**
 * A headless xterm.js instance fed the same bytes as the real pty, kept purely to answer
 * "what does the screen look like right now" for late-joining guests (see
 * docs/terminal-sharing.md §5). It is a strictly passive observer:
 *  - its `onData` must never be wired back to the pty (device-status replies would double up)
 *  - it is not on the streaming path; guests receive raw pty chunks directly
 */
export class TerminalEmulator implements vscode.Disposable {

    private readonly terminal: Terminal;
    private readonly serializeAddon = new SerializeAddon();

    constructor(columns: number, rows: number, scrollback: number) {
        this.terminal = new Terminal({
            cols: columns,
            rows,
            scrollback,
            allowProposedApi: true
        });
        this.terminal.loadAddon(this.serializeAddon);
    }

    write(data: string): void {
        this.terminal.write(data);
    }

    resize(columns: number, rows: number): void {
        if (columns > 0 && rows > 0) {
            this.terminal.resize(columns, rows);
        }
    }

    /** A snapshot of the current screen contents, including escape sequences. */
    serialize(): string {
        return this.serializeAddon.serialize();
    }

    dispose(): void {
        this.serializeAddon.dispose();
        this.terminal.dispose();
    }
}
