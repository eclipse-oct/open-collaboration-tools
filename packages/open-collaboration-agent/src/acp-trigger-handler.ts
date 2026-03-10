// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { DocumentSyncOperations, LineEdit } from './document-operations.js';

/**
 * Process an ACP agent/action or agent/response message and apply edits
 */
export async function processACPResponse(
    response: any,
    docPath: string,
    currentContent: string,
    documentOps: DocumentSyncOperations,
    triggerId: string,
    triggerLine?: number
): Promise<void> {
    console.error(`[ACP] Processing response for trigger ${triggerId}:`, JSON.stringify(response, null, 2));

    // Handle agent/action messages - Currently not used at all
    if (response.type === 'agent/action' && response.action === 'edit' && response.payload) {
        const payload = response.payload;
        if (payload.file && payload.edits) {
            const requestedFilePath = payload.file as string;
            const targetDocPath = requestedFilePath || docPath;
            const lineEdits = convertACPEditsToLineEdits(payload.edits);
            if (lineEdits.length > 0) {
                const targetContent = documentOps.getDocument(targetDocPath) ?? currentContent;
                console.error(`[ACP] Applying ${lineEdits.length} line edits to ${targetDocPath}`);

                // Set initial cursor position at the start of the first edit
                const firstEdit = lineEdits[0];
                const initialOffset = firstEdit.startLine > 0
                    ? targetContent.split('\n').slice(0, firstEdit.startLine - 1).reduce((acc, line) => acc + line.length + 1, 0)
                    : 0;
                documentOps.updateCursor(targetDocPath, initialOffset);

                await documentOps.applyEditsAnimated(targetDocPath, lineEdits);
            }
        }
    } else if (response.type === 'agent/response' && response.content !== undefined) {
        // Handle text-based responses - log for future chat integration
        const textContent = typeof response.content === 'string' ? response.content : '';

        if (textContent.trim()) {
            // Log agent response for future chat integration
            console.log(`[ACP Agent Response] ${textContent}`);
            // documentOps.getConnection().chat.sendMessage(textContent);
        } else {
            console.error('[ACP] Received empty text response');
        }
    } else {
        console.error('[ACP] Unknown response format:', response);
    }
}

/**
 * Convert ACP edit format to LineEdit format
 * ACP edits format may vary, so this function handles common formats
 */
function convertACPEditsToLineEdits(acpEdits: any[]): LineEdit[] {
    const lineEdits: LineEdit[] = [];

    for (const edit of acpEdits) {
        // Handle different ACP edit formats
        if (edit.type === 'replace' || edit.type === 'edit') {
            lineEdits.push({
                type: 'replace',
                startLine: edit.startLine || edit.line || 1,
                endLine: edit.endLine || edit.endLine || edit.startLine || edit.line || 1,
                content: edit.content || edit.text || '',
            });
        } else if (edit.type === 'insert') {
            lineEdits.push({
                type: 'insert',
                startLine: edit.startLine || edit.line || 1,
                content: edit.content || edit.text || '',
            });
        } else if (edit.type === 'delete') {
            lineEdits.push({
                type: 'delete',
                startLine: edit.startLine || edit.line || 1,
                endLine: edit.endLine || edit.endLine || edit.startLine || edit.line || 1,
            });
        } else if (edit.start && edit.end && edit.text !== undefined) {
            // Handle range-based edits (common in ACP)
            const startLine = edit.start.line + 1; // Convert 0-indexed to 1-indexed
            const endLine = edit.end.line + 1;
            if (edit.text === '') {
                // Delete
                lineEdits.push({
                    type: 'delete',
                    startLine,
                    endLine,
                });
            } else {
                // Replace
                lineEdits.push({
                    type: 'replace',
                    startLine,
                    endLine,
                    content: edit.text,
                });
            }
        } else {
            console.error('[ACP] Unknown edit format:', edit);
        }
    }

    return lineEdits;
}

