// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { ACPBridge } from '../src/acp-bridge.js';

describe('multi-file and new-file regressions', () => {
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

            // Proposals are buffered during a prompt cycle and flushed at the end
            // (see ACPBridge.handleResponse). Trigger the flush manually here to
            // verify the buffered proposal is forwarded to the editor.
            await (bridge as any).flushPendingProposals();

            expect(fs.existsSync(absolutePath)).toBe(false);
            expect(proposeChanges).toHaveBeenCalledTimes(1);
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

    test('ACPBridge flushPendingProposals returns count of flushed proposals', async () => {
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

        // No pending proposals -> 0
        const emptyResult = await (bridge as any).flushPendingProposals();
        expect(emptyResult).toBe(0);

        // Queue two proposals for different paths and verify the count
        try {
            await (bridge as any).handleFileSystemRequest({
                id: 'req-a',
                method: 'fs/write_text_file',
                params: {
                    path: path.join('tmp', `acp-count-a-${Date.now()}.ts`),
                    content: 'updated a',
                },
            });
            await (bridge as any).handleFileSystemRequest({
                id: 'req-b',
                method: 'fs/write_text_file',
                params: {
                    path: path.join('tmp', `acp-count-b-${Date.now()}.ts`),
                    content: 'updated b',
                },
            });

            const flushedCount = await (bridge as any).flushPendingProposals();
            expect(flushedCount).toBe(2);
            expect(proposeChanges).toHaveBeenCalledTimes(2);

            // Subsequent flush returns 0 since the buffer was cleared
            const afterFlush = await (bridge as any).flushPendingProposals();
            expect(afterFlush).toBe(0);
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
