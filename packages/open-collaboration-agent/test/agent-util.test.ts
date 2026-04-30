// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test, vi } from 'vitest';
import { applyLineEditsAnimated } from '../src/agent-util.js';
import type { IDocumentSync } from '../src/document-sync.js';

describe('agent-util', () => {
    describe('applyLineEditsAnimated', () => {
        test('should apply replace deletions instantly and animate only inserted diff', async () => {
            const docPath = 'test.ts';
            let content = 'const value = old;\n';
            const applyEditMock = vi.fn((_: string, text: string, offset: number, length: number) => {
                content = content.substring(0, offset) + text + content.substring(offset + length);
            });
            const updateCursorPositionMock = vi.fn();

            const documentSync: IDocumentSync = {
                applyEdit: applyEditMock,
                updateCursorPosition: updateCursorPositionMock,
                getDocumentContent: () => content
            };

            await applyLineEditsAnimated(docPath, content, [{
                type: 'replace',
                startLine: 1,
                endLine: 1,
                content: 'const value = new;\n'
            }], documentSync);

            expect(content).toBe('const value = new;\n');
            expect(applyEditMock).toHaveBeenCalledTimes(4);

            const [deleteCall, ...insertCalls] = applyEditMock.mock.calls;
            expect(deleteCall).toEqual([docPath, '', 14, 3]);
            expect(insertCalls).toEqual([
                [docPath, 'n', 14, 0],
                [docPath, 'e', 15, 0],
                [docPath, 'w', 16, 0]
            ]);
        });
    });
});
