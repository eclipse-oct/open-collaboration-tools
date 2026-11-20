// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

/**
 * Variables the extension host sets for itself that must not leak into a shared shell. Mirrors
 * `sanitizeProcessEnvironment` in VS Code's `src/vs/base/common/processes.ts`, which VS Code
 * applies to its own integrated terminals:
 *  - `ELECTRON_RUN_AS_NODE` would make `code .` or any other Electron app start as plain Node
 *  - `VSCODE_*` exposes the host window's IPC handles to everyone who can see the terminal; the
 *    allowlisted ones are meant to reach the shell
 *  - `SNAP*` and `GDK_PIXBUF_*` come from the Snap package and break native apps started from it
 */
const KEYS_TO_REMOVE = [
    /^ELECTRON_.+$/,
    /^VSCODE_(?!(PORTABLE|SHELL_LOGIN|ENV_REPLACE|ENV_APPEND|ENV_PREPEND)).+$/,
    /^SNAP(|_.*)$/,
    /^GDK_PIXBUF_.+$/
];

/** A copy of `env` that is safe to hand to a shared terminal's shell. */
export function sanitizeTerminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const result: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined && !KEYS_TO_REMOVE.some(pattern => pattern.test(key))) {
            result[key] = value;
        }
    }
    return result;
}
