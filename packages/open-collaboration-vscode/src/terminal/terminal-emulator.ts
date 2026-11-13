// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import * as vscode from 'vscode';

/**
 * Upper bound for a serialized snapshot, in UTF-8 bytes. socket.io closes the whole connection
 * on messages above its 1 MB default `maxHttpBufferSize`, and compression is not guaranteed
 * (peers may negotiate `none`), so this leaves room for framing and encryption overhead.
 */
export const MAX_SNAPSHOT_BYTES = 512 * 1024;

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

    /**
     * A snapshot of the current screen contents, including escape sequences, with at most
     * `maxScrollback` lines of history. History is dropped from the top until the result fits
     * into `MAX_SNAPSHOT_BYTES`; the visible screen itself is always included.
     */
    serialize(maxScrollback: number): string {
        const buffer = this.terminal.buffer.active;
        let scrollback = Math.max(0, Math.min(maxScrollback, buffer.length - this.terminal.rows));
        let result = this.serializeAddon.serialize({ scrollback });
        while (scrollback > 0 && Buffer.byteLength(result, 'utf8') > MAX_SNAPSHOT_BYTES) {
            scrollback = Math.floor(scrollback / 2);
            result = this.serializeAddon.serialize({ scrollback });
        }
        return result;
    }

    dispose(): void {
        this.serializeAddon.dispose();
        this.terminal.dispose();
    }
}
