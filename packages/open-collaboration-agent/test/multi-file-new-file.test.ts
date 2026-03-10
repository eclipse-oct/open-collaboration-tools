// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { processACPResponse } from '../src/acp-trigger-handler.js';
import { ACPBridge } from '../src/acp-bridge.js';
import { DocumentSyncOperations, type LineEdit } from '../src/document-operations.js';

describe('multi-file and new-file regressions', () => {
    test('processACPResponse applies edits to requested target file', async () => {
        const applyEditsAnimated = vi.fn<(_: string, __: LineEdit[]) => Promise<void>>().mockResolvedValue();
        const updateCursor = vi.fn();

        const documentOps = {
            getActiveDocumentPath: () => 'workspace/active.ts',
            getDocument: (docPath: string) => docPath === 'workspace/target.ts' ? 'const x = 1;\n' : undefined,
            applyEditsAnimated,
            updateCursor,
        } as any;

        await processACPResponse(
            {
                type: 'agent/action',
                action: 'edit',
                payload: {
                    file: 'workspace/target.ts',
                    edits: [{ type: 'insert', startLine: 1, content: 'const created = true;' }],
                },
            },
            'workspace/original.ts',
            'console.log("active");',
            documentOps,
            'trig-test'
        );

        expect(applyEditsAnimated).toHaveBeenCalledTimes(1);
        expect(applyEditsAnimated.mock.calls[0]?.[0]).toBe('workspace/target.ts');
        expect(updateCursor).toHaveBeenCalledWith('workspace/target.ts', 0);
    });

    test('DocumentSyncOperations treats empty document content as valid', async () => {
        const applyEdit = vi.fn();
        const updateCursorPosition = vi.fn();

        const documentSyncMock = {
            getConnection: () => ({}) as any,
            getDocumentContent: () => '',
            applyEdit,
            updateCursorPosition,
            getActiveDocumentPath: () => 'workspace/empty.ts',
        } as any;

        const documentOps = new DocumentSyncOperations(documentSyncMock, {
            roomId: 'room',
            agentId: 'agent',
            agentName: 'Agent',
            hostId: 'host',
            serverUrl: 'http://localhost',
        });

        documentOps.applyEdit('workspace/empty.ts', {
            type: 'insert',
            startLine: 1,
            content: 'export const value = 1;',
        });

        await expect(documentOps.applyEditsAnimated('workspace/empty.ts', [])).resolves.toBeUndefined();
        expect(applyEdit).toHaveBeenCalled();
    });

    test('ACPBridge write_text_file creates missing file before OCT sync', async () => {
        const applyEditsAnimated = vi.fn<(_: string, __: LineEdit[]) => Promise<void>>().mockResolvedValue();
        const sendMessage = vi.fn();

        const bridge = new ACPBridge('echo', {
            getDocument: () => '',
            applyEditsAnimated,
        } as any);

        (bridge as any).sendMessage = sendMessage;

        const relativePath = path.join('tmp', `acp-write-${Date.now()}.ts`);
        const absolutePath = path.resolve(process.cwd(), relativePath);

        try {
            await (bridge as any).handleFileSystemRequest({
                id: 'req-1',
                method: 'fs/write_text_file',
                params: {
                    path: relativePath,
                    content: 'export const created = true;',
                },
            });

            expect(fs.existsSync(absolutePath)).toBe(true);
            expect(fs.readFileSync(absolutePath, 'utf8')).toBe('export const created = true;');
            expect(applyEditsAnimated).toHaveBeenCalledTimes(1);
        } finally {
            fs.rmSync(path.resolve(process.cwd(), 'tmp'), { recursive: true, force: true });
        }
    });
});
