// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test, vi } from 'vitest';
import { TerminalEmulator } from '../../src/terminal/terminal-emulator.js';

vi.mock('vscode', () => ({}));

describe('TerminalEmulator', () => {

    test('serializeWhenParsed includes output written right before it', async () => {
        const emulator = new TerminalEmulator(80, 24, 1000);
        try {
            const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
            emulator.write(lines.join('\r\n'));
            // xterm parses asynchronously: a synchronous serialize would miss the tail.
            const snapshot = await emulator.serializeWhenParsed(1000);
            expect(snapshot).toContain('line 199');
        } finally {
            emulator.dispose();
        }
    });

    test('serializeWhenParsed excludes output written after it', async () => {
        const emulator = new TerminalEmulator(80, 24, 1000);
        try {
            emulator.write('before');
            const snapshot = emulator.serializeWhenParsed(1000);
            emulator.write(' after');
            const result = await snapshot;
            expect(result).toContain('before');
            expect(result).not.toContain('after');
        } finally {
            emulator.dispose();
        }
    });
});
