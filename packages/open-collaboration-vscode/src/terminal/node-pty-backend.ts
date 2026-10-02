// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { PtyBackend, PtyBackendOptions, PtyBackendUnavailableError } from './pty-backend.js';

// node-pty is a native module and must never be reachable from the web extension bundle
// (see docs/terminal-sharing.md §4.3). A lazy `require` keeps it out of any static import
// graph so bundlers cannot follow it into extension-web.ts, and it also lets us turn a
// missing/broken native module into an actionable error instead of an activation crash.
type NodePtyModule = typeof import('node-pty');

function loadNodePty(): NodePtyModule {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        return require('node-pty') as NodePtyModule;
    } catch (error) {
        throw new PtyBackendUnavailableError(error);
    }
}

export function isNodePtyAvailable(): boolean {
    try {
        loadNodePty();
        return true;
    } catch {
        return false;
    }
}

export class NodePtyBackend implements PtyBackend {

    private readonly pty: import('node-pty').IPty;

    constructor(options: PtyBackendOptions) {
        const nodePty = loadNodePty();
        this.pty = nodePty.spawn(options.shell, options.shellArgs, {
            name: options.name ?? 'xterm-256color',
            cols: options.columns,
            rows: options.rows,
            cwd: options.cwd,
            env: options.env as { [key: string]: string }
        });
    }

    write(data: string): void {
        this.pty.write(data);
    }

    resize(columns: number, rows: number): void {
        // A pty resize to a non-positive size throws; guard against transient zero-size
        // layout events from VS Code (e.g. a panel being dragged to fully collapsed).
        if (columns > 0 && rows > 0) {
            this.pty.resize(columns, rows);
        }
    }

    onData(listener: (data: string) => void): void {
        this.pty.onData(listener);
    }

    onExit(listener: (event: { code?: number; signal?: string }) => void): void {
        this.pty.onExit(event => listener({
            code: event.exitCode,
            signal: event.signal !== undefined ? String(event.signal) : undefined
        }));
    }

    kill(): void {
        try {
            this.pty.kill();
        } catch {
            // Already dead; nothing to do.
        }
    }
}
