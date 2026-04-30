// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { IDocumentSync } from './document-sync.js';
import { LineEdit } from './document-operations.js';

/**
 * Returns a typing delay in milliseconds based on the character type
 * to simulate more realistic human typing patterns
 */
function getTypingDelay(char: string): number {
    // No delay for most characters to keep it responsive
    if (char === ' ') return 50;  // Slight pause after spaces
    if (char === '\n') return 100; // Longer pause after newlines
    if (char === '.' || char === ',' || char === ';') return 80; // Pause after punctuation
    if (char === '{' || char === '}' || char === '(' || char === ')') return 30; // Small pause for structural characters

    // Random variation for other characters (20-60ms)
    return Math.random() * 40 + 20;
}

/**
 * Calculates the character offset in the document for a given line.
 */
function calculateOffset(text: string, line: number): number {
    const lines = text.split('\n');
    let offset = 0;

    for (let i = 0; i < line && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for the newline character
    }

    return offset;
}

/**
 * Applies line-based edits with natural, progressive animation.
 * Makes the agent feel like a real colleague typing code changes.
 */
export async function applyLineEditsAnimated(
    docPath: string,
    docContent: string,
    edits: LineEdit[],
    documentSync: IDocumentSync
): Promise<void> {
    if (edits.length === 0) {
        return;
    }

    // Sort edits by line number (descending) to avoid offset shifts when applying multiple edits
    const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);

    for (let i = 0; i < sortedEdits.length; i++) {
        const edit = sortedEdits[i];

        // Add a small pause between different edit operations
        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        // Get fresh content from Yjs document (source of truth)
        const currentContent = documentSync.getDocumentContent(docPath) || '';

        if (edit.type === 'replace' && edit.endLine !== undefined && edit.content !== undefined) {
            // Replace only the differing middle segment:
            // - apply deletions immediately
            // - animate only newly inserted characters
            const startOffset = calculateOffset(currentContent, edit.startLine - 1);
            const endOffset = calculateOffset(currentContent, edit.endLine);
            const oldSegment = currentContent.substring(startOffset, endOffset);
            const newSegment = edit.content;

            console.log(`Replacing lines ${edit.startLine}-${edit.endLine} (offset ${startOffset}, length ${oldSegment.length})`);

            // Find common prefix
            let prefixLength = 0;
            const maxPrefix = Math.min(oldSegment.length, newSegment.length);
            while (prefixLength < maxPrefix && oldSegment[prefixLength] === newSegment[prefixLength]) {
                prefixLength++;
            }

            // Find common suffix (without overlapping prefix)
            let suffixLength = 0;
            while (
                suffixLength < (oldSegment.length - prefixLength) &&
                suffixLength < (newSegment.length - prefixLength) &&
                oldSegment[oldSegment.length - 1 - suffixLength] === newSegment[newSegment.length - 1 - suffixLength]
            ) {
                suffixLength++;
            }

            const oldDiffLength = oldSegment.length - prefixLength - suffixLength;
            const insertText = newSegment.slice(prefixLength, newSegment.length - suffixLength);
            const diffOffset = startOffset + prefixLength;

            // Apply deletions/replacements immediately
            if (oldDiffLength > 0) {
                documentSync.applyEdit(docPath, '', diffOffset, oldDiffLength);
                documentSync.updateCursorPosition(docPath, diffOffset);
            }

            // Animate only newly inserted text
            let insertOffset = diffOffset;
            for (const char of insertText) {
                documentSync.applyEdit(docPath, char, insertOffset, 0);
                insertOffset++;
                documentSync.updateCursorPosition(docPath, insertOffset);

                const delay = getTypingDelay(char);
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

        } else if (edit.type === 'insert' && edit.content !== undefined) {
            // Insert: type content character by character
            const insertOffset = edit.startLine === 1 ? 0 : calculateOffset(currentContent, edit.startLine - 1);
            const contentToInsert = edit.startLine === 1 ? edit.content + '\n' : edit.content + '\n';

            console.log(`Inserting at line ${edit.startLine} (offset ${insertOffset})`);

            let currentOffset = insertOffset;
            for (const char of contentToInsert) {
                documentSync.applyEdit(docPath, char, currentOffset, 0);
                currentOffset++;
                documentSync.updateCursorPosition(docPath, currentOffset);

                const delay = getTypingDelay(char);
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

        } else if (edit.type === 'delete' && edit.endLine !== undefined) {
            // Delete: remove content character by character (backwards)
            const startOffset = calculateOffset(currentContent, edit.startLine - 1);
            const endOffset = calculateOffset(currentContent, edit.endLine);
            const length = endOffset - startOffset;

            console.log(`Deleting lines ${edit.startLine}-${edit.endLine} (offset ${startOffset}, length ${length})`);

            for (let deleteLen = length; deleteLen > 0; deleteLen--) {
                documentSync.applyEdit(docPath, '', startOffset, 1);
                documentSync.updateCursorPosition(docPath, startOffset);
                await new Promise(resolve => setTimeout(resolve, 5)); // Fast deletion
            }
        }
    }
}
