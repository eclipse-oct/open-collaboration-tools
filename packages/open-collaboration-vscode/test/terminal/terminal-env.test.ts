// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test } from 'vitest';
import { sanitizeTerminalEnv } from '../../src/terminal/terminal-env.js';

describe('sanitizeTerminalEnv', () => {

    test('removes extension host variables and keeps everything else', () => {
        const env = sanitizeTerminalEnv({
            PATH: '/usr/bin',
            HOME: '/home/user',
            ELECTRON_RUN_AS_NODE: '1',
            ELECTRON_NO_ATTACH_CONSOLE: '1',
            VSCODE_IPC_HOOK: '/run/user/1000/vscode.sock',
            VSCODE_PID: '42',
            SNAP: '/snap/code/1',
            SNAP_NAME: 'code',
            GDK_PIXBUF_MODULE_FILE: '/snap/loaders.cache',
            SNAPSHOT_DIR: '/data'
        });
        expect(env).toEqual({
            PATH: '/usr/bin',
            HOME: '/home/user',
            SNAPSHOT_DIR: '/data'
        });
    });

    test('keeps the VSCODE_ variables VS Code passes to its own terminals', () => {
        const env = sanitizeTerminalEnv({
            VSCODE_PORTABLE: '/portable',
            VSCODE_SHELL_LOGIN: '1'
        });
        expect(env).toEqual({
            VSCODE_PORTABLE: '/portable',
            VSCODE_SHELL_LOGIN: '1'
        });
    });

    test('does not modify its input', () => {
        const input = { ELECTRON_RUN_AS_NODE: '1' };
        sanitizeTerminalEnv(input);
        expect(input).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    });
});
