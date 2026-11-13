// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

/**
 * Abstraction over the process that actually runs the shell. Kept as a seam so an
 * alternative backend (or a "feature disabled" stub) can be swapped in without touching
 * the rest of the terminal sharing code. See docs/terminal-sharing.md §4.4.
 */
export interface PtyBackend {
    /** Send input as if typed into the terminal. */
    write(data: string): void;
    /** Resize the underlying pty. This is the only thing that determines line wrapping. */
    resize(columns: number, rows: number): void;
    /** Raw output from the shell, already decoded as UTF-8 text. */
    onData(listener: (data: string) => void): void;
    /** Fired exactly once, when the shell process has exited. */
    onExit(listener: (event: { code?: number; signal?: string }) => void): void;
    /** Terminate the shell process. Safe to call multiple times. */
    kill(): void;
}

export interface PtyBackendOptions {
    shell: string;
    shellArgs: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    columns: number;
    rows: number;
    name?: string;
}

export class PtyBackendUnavailableError extends Error {
    constructor(cause: unknown) {
        super('The native module required for terminal sharing (node-pty) could not be loaded.');
        this.name = 'PtyBackendUnavailableError';
        this.cause = cause;
    }
}
