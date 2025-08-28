// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import type { DocumentSync } from './document-sync.js';

/**
 * Represents a line-based edit operation
 */
export interface LineEdit {
    type: 'replace' | 'insert' | 'delete';
    startLine: number;
    endLine?: number;
    content?: string;
}

/**
 * Session information
 */
export interface SessionInfo {
    roomId: string;
    agentId: string;
    agentName: string;
    hostId: string;
    serverUrl: string;
}

/**
 * Core document operations interface.
 * This abstraction allows both the built-in agent (direct calls) and
 * external agents (via MCP tools) to use the same underlying functionality.
 */
export interface DocumentOperations {
    /**
     * Get the full content of a document
     */
    getDocument(path: string): string | undefined;

    /**
     * Get a specific range of lines from a document (1-indexed, inclusive)
     */
    getDocumentRange(path: string, startLine: number, endLine: number): string[] | undefined;

    /**
     * Apply a line-based edit to a document
     */
    applyEdit(path: string, edit: LineEdit): void;

    /**
     * Apply multiple line-based edits with animation
     */
    applyEditsAnimated(path: string, edits: LineEdit[]): Promise<void>;

    /**
     * Remove a line containing the trigger pattern
     */
    removeTriggerLine(path: string, trigger: string): void;

    /**
     * Update the cursor position for awareness
     */
    updateCursor(path: string, offset: number): void;

    /**
     * Get session information
     */
    getSessionInfo(): SessionInfo;

    /**
     * Get the currently active document path
     */
    getActiveDocumentPath(): string | undefined;
}

/**
 * Implementation of DocumentOperations backed by DocumentSync.
 * Used by both the built-in agent and the MCP server.
 */
export class DocumentSyncOperations implements DocumentOperations {
    constructor(
        private readonly documentSync: DocumentSync,
        private readonly sessionInfo: SessionInfo
    ) { }

    getConnection(): ProtocolBroadcastConnection {
        return this.documentSync.getConnection();
    }

    getDocument(path: string): string | undefined {
        return this.documentSync.getDocumentContent(path);
    }

    getDocumentRange(path: string, startLine: number, endLine: number): string[] | undefined {
        const content = this.documentSync.getDocumentContent(path);
        if (!content) {
            return undefined;
        }

        const lines = content.split('\n');
        if (startLine < 1 || endLine > lines.length || startLine > endLine) {
            throw new Error(`Invalid line range: ${startLine}-${endLine} (document has ${lines.length} lines)`);
        }

        return lines.slice(startLine - 1, endLine);
    }

    applyEdit(path: string, edit: LineEdit): void {
        const content = this.documentSync.getDocumentContent(path);
        if (!content) {
            throw new Error(`Document not found: ${path}`);
        }

        if (edit.type === 'replace' && edit.endLine !== undefined && edit.content !== undefined) {
            // Replace lines from startLine to endLine (inclusive, 1-indexed)
            const startOffset = this.calculateOffset(content, edit.startLine - 1);
            const endOffset = this.calculateOffset(content, edit.endLine);
            const length = endOffset - startOffset;

            this.documentSync.applyEdit(path, edit.content, startOffset, length);
        } else if (edit.type === 'insert' && edit.content !== undefined) {
            // Insert content before the specified line (1-indexed)
            const insertOffset = edit.startLine === 1 ? 0 : this.calculateOffset(content, edit.startLine - 1);
            const contentToInsert = edit.startLine === 1 ? edit.content + '\n' : edit.content + '\n';

            this.documentSync.applyEdit(path, contentToInsert, insertOffset, 0);
        } else if (edit.type === 'delete' && edit.endLine !== undefined) {
            // Delete lines from startLine to endLine (inclusive, 1-indexed)
            const startOffset = this.calculateOffset(content, edit.startLine - 1);
            const endOffset = this.calculateOffset(content, edit.endLine);
            const length = endOffset - startOffset;

            this.documentSync.applyEdit(path, '', startOffset, length);
        } else {
            throw new Error(`Invalid edit: ${JSON.stringify(edit)}`);
        }
    }

    async applyEditsAnimated(path: string, edits: LineEdit[]): Promise<void> {
        const { applyLineEditsAnimated } = await import('./agent-util.js');
        const content = this.documentSync.getDocumentContent(path);
        if (!content) {
            throw new Error(`Document not found: ${path}`);
        }
        await applyLineEditsAnimated(path, content, edits, this.documentSync);
    }

    removeTriggerLine(path: string, trigger: string): void {
        const content = this.documentSync.getDocumentContent(path);
        if (!content) {
            return;
        }

        const lines = content.split('\n');
        const triggerLineIndex = lines.findIndex(line => line.includes(trigger));

        if (triggerLineIndex !== -1) {
            const triggerLineOffset = lines.slice(0, triggerLineIndex).reduce((acc, line) => acc + line.length + 1, 0);
            const triggerLineLength = lines[triggerLineIndex].length + 1; // +1 for newline

            this.documentSync.applyEdit(path, '', triggerLineOffset, triggerLineLength);
        }
    }

    updateCursor(path: string, offset: number): void {
        this.documentSync.updateCursorPosition(path, offset);
    }

    getSessionInfo(): SessionInfo {
        return this.sessionInfo;
    }

    getActiveDocumentPath(): string | undefined {
        return this.documentSync.getActiveDocumentPath();
    }

    /**
     * Helper: Calculate character offset for a given line number
     */
    private calculateOffset(text: string, line: number): number {
        const lines = text.split('\n');
        let offset = 0;

        for (let i = 0; i < line; i++) {
            offset += lines[i].length + 1; // +1 for the newline character
        }

        return offset;
    }
}
