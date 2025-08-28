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
 * Core document operations interface used by the ACP bridge.
 */
export interface DocumentOperations {
    /**
     * Get the full content of a document
     */
    getDocument(path: string): string | undefined;

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

    async applyEditsAnimated(path: string, edits: LineEdit[]): Promise<void> {
        const { applyLineEditsAnimated } = await import('./agent-util.js');
        const content = this.documentSync.getDocumentContent(path);
        if (content === undefined) {
            throw new Error(`Document not found: ${path}`);
        }
        await applyLineEditsAnimated(path, content, edits, this.documentSync);
    }

    removeTriggerLine(path: string, trigger: string): void {
        const content = this.documentSync.getDocumentContent(path);
        if (content === undefined) {
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
}
