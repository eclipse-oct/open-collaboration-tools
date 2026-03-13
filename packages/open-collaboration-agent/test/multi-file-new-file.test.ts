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

    test('ACPBridge write_text_file proposes changes without writing to disk when OCT document exists', async () => {
        const proposeChanges = vi.fn().mockResolvedValue(undefined);
        const sendMessage = vi.fn();

        const bridge = new ACPBridge('echo', {
            getDocument: () => 'original content',
            getActiveDocumentPath: () => 'workspace/active.ts',
            getConnection: () => ({
                editor: { proposeChanges },
            }),
            getSessionInfo: () => ({
                roomId: 'room',
                agentId: 'agent',
                agentName: 'Agent',
                hostId: 'host',
                serverUrl: 'http://localhost',
            }),
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
                    content: 'updated content',
                },
            });

            expect(fs.existsSync(absolutePath)).toBe(false);
            expect(proposeChanges).toHaveBeenCalledTimes(1);
            expect(proposeChanges.mock.calls[0]?.[0]).toBe('host');
            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'req-1', result: null })
            );
        } finally {
            fs.rmSync(path.resolve(process.cwd(), 'tmp'), { recursive: true, force: true });
        }
    });

    test('ACPBridge write_text_file skips proposeChanges when content is identical', async () => {
        const proposeChanges = vi.fn().mockResolvedValue(undefined);
        const sendMessage = vi.fn();

        const bridge = new ACPBridge('echo', {
            getDocument: () => 'same content',
            getActiveDocumentPath: () => 'workspace/active.ts',
            getConnection: () => ({
                editor: { proposeChanges },
            }),
            getSessionInfo: () => ({
                roomId: 'room',
                agentId: 'agent',
                agentName: 'Agent',
                hostId: 'host',
                serverUrl: 'http://localhost',
            }),
        } as any);

        (bridge as any).sendMessage = sendMessage;

        await (bridge as any).handleFileSystemRequest({
            id: 'req-2',
            method: 'fs/write_text_file',
            params: {
                path: 'some/file.ts',
                content: 'same content',
            },
        });

        expect(proposeChanges).not.toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'req-2', result: null })
        );
    });

    test('ACPBridge write_text_file writes locally when OCT document is missing and file does not exist', async () => {
        const proposeChanges = vi.fn().mockResolvedValue(undefined);
        const sendMessage = vi.fn();

        const bridge = new ACPBridge('echo', {
            getDocument: () => undefined,
            getActiveDocumentPath: () => 'workspace/active.ts',
            getConnection: () => ({
                editor: { proposeChanges },
            }),
            getSessionInfo: () => ({
                roomId: 'room',
                agentId: 'agent',
                agentName: 'Agent',
                hostId: 'host',
                serverUrl: 'http://localhost',
            }),
        } as any);

        (bridge as any).sendMessage = sendMessage;

        const relativePath = path.join('tmp', `acp-new-${Date.now()}.ts`);
        const absolutePath = path.resolve(process.cwd(), relativePath);

        try {
            await (bridge as any).handleFileSystemRequest({
                id: 'req-3',
                method: 'fs/write_text_file',
                params: {
                    path: relativePath,
                    content: 'export const created = true;',
                },
            });

            expect(fs.existsSync(absolutePath)).toBe(true);
            expect(fs.readFileSync(absolutePath, 'utf8')).toBe('export const created = true;');
            expect(proposeChanges).not.toHaveBeenCalled();
            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'req-3', result: null })
            );
        } finally {
            fs.rmSync(path.resolve(process.cwd(), 'tmp'), { recursive: true, force: true });
        }
    });

    test('ACPBridge write_text_file does not overwrite when OCT document is missing but file exists locally', async () => {
        const proposeChanges = vi.fn().mockResolvedValue(undefined);
        const sendMessage = vi.fn();

        const bridge = new ACPBridge('echo', {
            getDocument: () => undefined,
            getActiveDocumentPath: () => 'workspace/active.ts',
            getConnection: () => ({
                editor: { proposeChanges },
            }),
            getSessionInfo: () => ({
                roomId: 'room',
                agentId: 'agent',
                agentName: 'Agent',
                hostId: 'host',
                serverUrl: 'http://localhost',
            }),
        } as any);

        (bridge as any).sendMessage = sendMessage;

        const relativePath = path.join('tmp', `acp-existing-${Date.now()}.ts`);
        const absolutePath = path.resolve(process.cwd(), relativePath);

        try {
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, 'pre-existing content', 'utf8');

            await (bridge as any).handleFileSystemRequest({
                id: 'req-4',
                method: 'fs/write_text_file',
                params: {
                    path: relativePath,
                    content: 'new content from agent',
                },
            });

            expect(fs.readFileSync(absolutePath, 'utf8')).toBe('pre-existing content');
            expect(proposeChanges).not.toHaveBeenCalled();
            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'req-4', result: null })
            );
        } finally {
            fs.rmSync(path.resolve(process.cwd(), 'tmp'), { recursive: true, force: true });
        }
    });
});
