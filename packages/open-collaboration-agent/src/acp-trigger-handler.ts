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

    // Handle agent/action messages
    if (response.type === 'agent/action' && response.action === 'edit' && response.payload) {
        const payload = response.payload;
        if (payload.file && payload.edits) {
            const requestedFilePath = payload.file;
            const activeDocPath = documentOps.getActiveDocumentPath() || docPath;
            const isNewFile = requestedFilePath !== activeDocPath;

            // Detect workspace mode: single-file vs multi-file
            // For now, we'll use a simple heuristic: if the requested file differs from active,
            // and we're in what appears to be a single-file context, redirect to active document
            // In a real implementation, we'd get this from workspace info
            // For now, we'll assume single-file if the file path differs (typical OCT playground scenario)
            const workspaceMode = isNewFile ? 'single-file' : 'multi-file'; // Simple heuristic

            if (isNewFile && workspaceMode === 'single-file') {
                // Single-file workspace: Redirect new file creation to active document
                console.error(`[ACP] Single-file workspace: Redirecting edits from ${requestedFilePath} to active OCT document ${activeDocPath}`);

                // Convert edits to append to end of active document
                const lineEdits = convertACPEditsToLineEdits(payload.edits);
                const lines = currentContent.split('\n');
                const insertLine = lines.length + 1;

                // Add separator comment for new file content
                if (currentContent.trim().length > 0) {
                    const separatorEdit: LineEdit = {
                        type: 'insert',
                        startLine: insertLine,
                        content: `\n// ============================================================================\n// New file: ${requestedFilePath}\n// ============================================================================\n`,
                    };
                    // Adjust line numbers for subsequent edits
                    const separatorLines = 4;
                    const adjustedEdits = lineEdits.map(edit => ({
                        ...edit,
                        startLine: edit.startLine + insertLine + separatorLines - 1,
                        endLine: edit.endLine ? edit.endLine + insertLine + separatorLines - 1 : undefined,
                    }));

                    await documentOps.applyEditsAnimated(activeDocPath, [separatorEdit, ...adjustedEdits]);
                } else {
                    // Empty document - just append edits
                    const adjustedEdits = lineEdits.map(edit => ({
                        ...edit,
                        startLine: edit.startLine + insertLine - 1,
                        endLine: edit.endLine ? edit.endLine + insertLine - 1 : undefined,
                    }));
                    await documentOps.applyEditsAnimated(activeDocPath, adjustedEdits);
                }
            } else {
                // Multi-file workspace or same file: Apply edits normally
                // TODO: In multi-file mode, we should create the file in OCT workspace
                // For now, we'll apply to the active document as a fallback
                if (isNewFile) {
                    console.error(`[ACP] Multi-file workspace: New file ${requestedFilePath} requested, but applying to active document ${activeDocPath} (file creation in OCT workspace not yet implemented)`);
                }

                const lineEdits = convertACPEditsToLineEdits(payload.edits);
                if (lineEdits.length > 0) {
                    console.error(`[ACP] Applying ${lineEdits.length} line edits to ${activeDocPath}`);
                    // Set initial cursor position at the start of the first edit
                    const firstEdit = lineEdits[0];
                    const initialOffset = firstEdit.startLine > 0
                        ? currentContent.split('\n').slice(0, firstEdit.startLine - 1).reduce((acc, line) => acc + line.length + 1, 0)
                        : 0;
                    documentOps.updateCursor(activeDocPath, initialOffset);

                    await documentOps.applyEditsAnimated(activeDocPath, lineEdits);
                }
            }
        }
    } else if (response.type === 'agent/response' && response.content !== undefined) {
        // Handle text-based responses (if ACP agent returns text instead of structured edits)
        const textContent = typeof response.content === 'string' ? response.content : '';

        if (textContent.trim()) {
            console.error(`[ACP] Received text response (${textContent.length} chars), inserting after trigger line`);

            // Find the trigger line if not provided
            let targetLine = triggerLine;
            if (targetLine === undefined) {
                const lines = currentContent.split('\n');
                // Try to find a line with @agent pattern (common trigger pattern)
                const triggerLineIndex = lines.findIndex(line => line.includes('@'));
                if (triggerLineIndex !== -1) {
                    targetLine = triggerLineIndex + 1; // Convert to 1-indexed
                } else {
                    // Fallback: insert at the end
                    targetLine = lines.length + 1;
                }
            }

            // Insert the text after the trigger line
            // Insert all text as a single edit (with newlines preserved)
            // The insert operation inserts before the specified line, so we insert at targetLine + 1
            // to insert after the trigger line
            const lineEdits: LineEdit[] = [{
                type: 'insert',
                startLine: targetLine + 1, // Insert after trigger line (before the next line)
                content: textContent, // Insert the full text (may contain newlines)
            }];

            console.error(`[ACP] Inserting text after line ${targetLine}`);
            // Set initial cursor position at the insertion point
            const initialOffset = targetLine > 0
                ? currentContent.split('\n').slice(0, targetLine).reduce((acc, line) => acc + line.length + 1, 0)
                : 0;
            documentOps.updateCursor(docPath, initialOffset);

            await documentOps.applyEditsAnimated(docPath, lineEdits);
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

