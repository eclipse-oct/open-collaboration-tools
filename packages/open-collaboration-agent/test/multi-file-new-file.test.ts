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

    test('ACPBridge write_text_file proposes new file as insert hunk when document is missing and host has no copy', async () => {
        const proposeChanges = vi.fn().mockResolvedValue(undefined);
        const sendMessage = vi.fn();

        const bridge = new ACPBridge('echo', {
            getDocument: () => undefined,
            getActiveDocumentPath: () => 'workspace/active.ts',
            openAndWaitForContent: vi.fn().mockResolvedValue(undefined),
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
        const newFileContent = 'export const created = true;';

        try {
            await (bridge as any).handleFileSystemRequest({
                id: 'req-3',
                method: 'fs/write_text_file',
                params: {
                    path: relativePath,
                    content: newFileContent,
                },
            });

            // The bridge must no longer silently write to disk for untracked
            // files. Instead, a buffered proposal with an empty-baseline insert
            // hunk represents the new file, which is forwarded as a single
            // proposeChanges broadcast on flush.
            expect(fs.existsSync(absolutePath)).toBe(false);

            const workspaceName = 'workspace';
            const octPath = path.join(workspaceName, path.relative(process.cwd(), absolutePath));
            const pending = (bridge as any).pendingProposals.get(octPath);
            expect(pending).toBeDefined();
            expect(pending.currentContent).toBe('');
            expect(pending.newContent).toBe(newFileContent);

            await (bridge as any).flushPendingProposals();
            expect(proposeChanges).toHaveBeenCalledTimes(1);
            expect(proposeChanges).toHaveBeenCalledWith(
                octPath,
                expect.arrayContaining([
                    expect.objectContaining({
                        text: newFileContent,
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 0 },
                        },
                    }),
                ])
            );
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

    test('ACPBridge read_text_file returns buffered proposal content for sequential edits to the same file', async () => {
        const proposeChanges = vi.fn().mockResolvedValue(undefined);
        const sendMessage = vi.fn();

        const original = 'A\nB\nC';
        const bridge = new ACPBridge('echo', {
            getDocument: () => original,
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

        const relativePath = path.join('tmp', `acp-sequential-${Date.now()}.ts`);
        const absolutePath = path.resolve(process.cwd(), relativePath);

        try {
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, original, 'utf8');

            // Edit 1: A -> A1
            const afterEdit1 = 'A1\nB\nC';
            await (bridge as any).handleFileSystemRequest({
                id: 'req-write-1',
                method: 'fs/write_text_file',
                params: {
                    path: relativePath,
                    content: afterEdit1,
                },
            });

            // Simulate the agent re-reading the file between edits. The read
            // must observe the buffered proposal from edit 1, otherwise edit 2
            // would clobber edit 1 in the "last write wins" buffer.
            sendMessage.mockClear();
            await (bridge as any).handleFileSystemRequest({
                id: 'req-read',
                method: 'fs/read_text_file',
                params: {
                    path: relativePath,
                },
            });

            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'req-read',
                    result: expect.objectContaining({ content: afterEdit1 }),
                })
            );

            // Edit 2: cumulative write applying C -> C1 on top of edit 1.
            const afterEdit2 = 'A1\nB\nC1';
            await (bridge as any).handleFileSystemRequest({
                id: 'req-write-2',
                method: 'fs/write_text_file',
                params: {
                    path: relativePath,
                    content: afterEdit2,
                },
            });

            // The buffered proposal must reflect BOTH edits, not just the last one.
            const activeDocPath = 'workspace/active.ts';
            const workspaceName = activeDocPath.split('/')[0];
            const octPath = path.join(workspaceName, path.relative(process.cwd(), absolutePath));
            const pending = (bridge as any).pendingProposals.get(octPath);
            expect(pending).toBeDefined();
            expect(pending.currentContent).toBe(original);
            expect(pending.newContent).toBe(afterEdit2);

            // Flushing emits a single proposal carrying the cumulative state.
            await (bridge as any).flushPendingProposals();
            expect(proposeChanges).toHaveBeenCalledTimes(1);
            expect(proposeChanges).toHaveBeenCalledWith(
                octPath,
                expect.arrayContaining([
                    expect.objectContaining({ text: afterEdit2 }),
                ])
            );
        } finally {
            fs.rmSync(path.resolve(process.cwd(), 'tmp'), { recursive: true, force: true });
        }
    });

    test('ACPBridge write_text_file produces one proposal per file across tracked, untracked, and new files', async () => {
        const proposeChanges = vi.fn().mockResolvedValue(undefined);
        const sendMessage = vi.fn();

        const trackedOriginal = 'tracked original';
        const untrackedOriginal = 'untracked original';

        // getDocument returns content only for the tracked file. The untracked
        // file lives on the host and is delivered via openAndWaitForContent.
        // The new file is unknown everywhere — the bridge must still propose it
        // as an insert hunk rather than touching disk.
        const trackedAbs = path.resolve(process.cwd(), 'tmp', `acp-multi-tracked-${Date.now()}.ts`);
        const untrackedAbs = path.resolve(process.cwd(), 'tmp', `acp-multi-untracked-${Date.now()}.ts`);
        const newAbs = path.resolve(process.cwd(), 'tmp', `acp-multi-new-${Date.now()}.ts`);

        const workspaceName = 'workspace';
        const trackedOctPath = path.join(workspaceName, path.relative(process.cwd(), trackedAbs));
        const untrackedOctPath = path.join(workspaceName, path.relative(process.cwd(), untrackedAbs));
        const newOctPath = path.join(workspaceName, path.relative(process.cwd(), newAbs));

        const openAndWaitForContent = vi.fn(async (p: string) => {
            if (p === untrackedOctPath) return untrackedOriginal;
            return undefined;
        });

        const bridge = new ACPBridge('echo', {
            getDocument: (p: string) => (p === trackedOctPath ? trackedOriginal : undefined),
            getActiveDocumentPath: () => 'workspace/active.ts',
            openAndWaitForContent,
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

        try {
            await (bridge as any).handleFileSystemRequest({
                id: 'req-tracked',
                method: 'fs/write_text_file',
                params: {
                    path: path.relative(process.cwd(), trackedAbs),
                    content: 'tracked updated',
                },
            });

            await (bridge as any).handleFileSystemRequest({
                id: 'req-untracked',
                method: 'fs/write_text_file',
                params: {
                    path: path.relative(process.cwd(), untrackedAbs),
                    content: 'untracked updated',
                },
            });

            await (bridge as any).handleFileSystemRequest({
                id: 'req-new',
                method: 'fs/write_text_file',
                params: {
                    path: path.relative(process.cwd(), newAbs),
                    content: 'export const created = true;',
                },
            });

            // openAndWaitForContent should only be invoked for the two files
            // that getDocument did not know about.
            expect(openAndWaitForContent).toHaveBeenCalledWith(untrackedOctPath);
            expect(openAndWaitForContent).toHaveBeenCalledWith(newOctPath);
            expect(openAndWaitForContent).toHaveBeenCalledTimes(2);

            // No silent disk writes for any of the three files.
            expect(fs.existsSync(trackedAbs)).toBe(false);
            expect(fs.existsSync(untrackedAbs)).toBe(false);
            expect(fs.existsSync(newAbs)).toBe(false);

            // Each file ends up with its own buffered proposal — the multi-file
            // bug (only the active file produces a proposal) must not regress.
            const trackedPending = (bridge as any).pendingProposals.get(trackedOctPath);
            const untrackedPending = (bridge as any).pendingProposals.get(untrackedOctPath);
            const newPending = (bridge as any).pendingProposals.get(newOctPath);

            expect(trackedPending).toEqual(expect.objectContaining({
                currentContent: trackedOriginal,
                newContent: 'tracked updated',
            }));
            expect(untrackedPending).toEqual(expect.objectContaining({
                currentContent: untrackedOriginal,
                newContent: 'untracked updated',
            }));
            expect(newPending).toEqual(expect.objectContaining({
                currentContent: '',
                newContent: 'export const created = true;',
            }));

            const flushed = await (bridge as any).flushPendingProposals();
            expect(flushed).toBe(3);
            expect(proposeChanges).toHaveBeenCalledTimes(3);
        } finally {
            fs.rmSync(path.resolve(process.cwd(), 'tmp'), { recursive: true, force: true });
        }
    });

    test('ACPBridge write_text_file proposes changes for untracked existing file after host opens it', async () => {
        const proposeChanges = vi.fn().mockResolvedValue(undefined);
        const sendMessage = vi.fn();

        const original = 'pre-existing content';
        const openAndWaitForContent = vi.fn().mockResolvedValue(original);

        const bridge = new ACPBridge('echo', {
            getDocument: () => undefined,
            getActiveDocumentPath: () => 'workspace/active.ts',
            openAndWaitForContent,
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
        const updated = 'new content from agent';

        try {
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, original, 'utf8');

            await (bridge as any).handleFileSystemRequest({
                id: 'req-4',
                method: 'fs/write_text_file',
                params: {
                    path: relativePath,
                    content: updated,
                },
            });

            const workspaceName = 'workspace';
            const octPath = path.join(workspaceName, path.relative(process.cwd(), absolutePath));

            // Bridge must request the host to open the file rather than touching disk.
            expect(openAndWaitForContent).toHaveBeenCalledWith(octPath);
            expect(fs.readFileSync(absolutePath, 'utf8')).toBe(original);

            // The buffered proposal must be diffed against the host's real
            // content, not against an empty baseline.
            const pending = (bridge as any).pendingProposals.get(octPath);
            expect(pending).toBeDefined();
            expect(pending.currentContent).toBe(original);
            expect(pending.newContent).toBe(updated);

            await (bridge as any).flushPendingProposals();
            expect(proposeChanges).toHaveBeenCalledTimes(1);
            expect(proposeChanges).toHaveBeenCalledWith(
                octPath,
                expect.arrayContaining([
                    expect.objectContaining({ text: updated }),
                ])
            );
            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'req-4', result: null })
            );
        } finally {
            fs.rmSync(path.resolve(process.cwd(), 'tmp'), { recursive: true, force: true });
        }
    });
});
