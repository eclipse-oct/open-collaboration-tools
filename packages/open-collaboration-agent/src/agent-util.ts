// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Deferred } from 'open-collaboration-protocol';
import type { IDocumentSync } from './document-sync.js';
import { StreamTextResult } from 'ai';
import type { LineEdit } from './prompt.js';

/**
 * Applies the text region changes returned by the LLM to the document.
 */
export function applyChanges(docPath: string, docContent: string, docLines: string[], changes: string[], documentSync: IDocumentSync): void {
    // Create mutable copies of the document content and lines
    let currentContent = docContent;
    let currentLines = docLines;

    for (const change of changes) {
        // Split the change text into lines
        const changeLines = change.split('\n');
        console.log('changeLines', changeLines);
        // Locate the change in the document with context
        const location = locateChangeInDocument(currentLines, changeLines);

        if (location.endLine >= location.startLine) {
            // Calculate character offsets from line information
            const startOffset = calculateOffset(currentContent, location.startLine);
            const endOffset = calculateOffset(currentContent, location.endLine) - 1;

            // Apply the edit
            documentSync.applyEdit(docPath, location.replacementText, startOffset, endOffset - startOffset);

            // Update our local document representation to reflect the change for subsequent edits
            currentContent =
                currentContent.substring(0, startOffset) +
                location.replacementText +
                currentContent.substring(endOffset);

            // Update the lines array
            currentLines = currentContent.split('\n');
        }
    }
}

export async function applyChangesStreamed(docPath: string, docContent: string, docLines: string[], documentSync: IDocumentSync, completedLine: string, streamedChanges: StreamTextResult<never, string>): Promise<void> {
    streamedChanges.usage.then(usage => {
        console.log(usage.completionTokens, usage.promptTokens, usage.totalTokens);
    });
    // console.log('docPath', docPath);
    // console.log('docContent', docContent);
    // console.log('docLines', docLines);
    // console.log('documentSync', documentSync);

    // Find the initial insertion point - we'll determine where to start inserting based on the completed line
    // For now, let's append to the end of the document
    let currentContent = docContent;
    let insertionOffset = currentContent.length;

    for await (const chunk of streamedChanges.textStream) {
        console.log('streamed chunk', chunk);

        // Break chunk into individual characters for more human-like typing
        for (const char of chunk) {

            // Insert the character at the current insertion point
            documentSync.applyEdit(docPath, char, insertionOffset, 0);

            // Update our local content and insertion offset for the next character
            currentContent = currentContent.substring(0, insertionOffset) + char + currentContent.substring(insertionOffset);
            insertionOffset += 1;

            // Add a small delay to simulate human typing speed
            // Adjust the delay based on character type for more realism
            const delay = getTypingDelay(char);
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}

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
 * Displays a loading animation at the specified position in the document.
 * @returns A promise that resolves when the animation is complete (aborted)
 */
export function animateLoadingIndicator(docPath: string, offset: number, documentSync: IDocumentSync, abortSignal: AbortSignal): Promise<void> {
    const deferred = new Deferred<void>();
    const animationChars = ['|', '/', '-', '\\'];
    let index = 0;
    let currentChar: string | undefined = undefined;
    let timer: NodeJS.Timeout | undefined = undefined;

    const updateChar = () => {
        if (abortSignal.aborted) {
            return;
        }

        // Add the next character in the sequence
        const nextChar = animationChars[index];
        documentSync.applyEdit(docPath, nextChar, offset, currentChar === undefined ? 0 : 1);
        currentChar = nextChar;
        index = (index + 1) % animationChars.length;

        // Schedule the next update
        timer = setTimeout(updateChar, 250);
    };

    // Cleanup if aborted
    abortSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        if (currentChar !== undefined) {
            documentSync.applyEdit(docPath, '', offset, 1);
            currentChar = undefined;
        }
        deferred.resolve();
    });

    // Start the animation
    updateChar();

    return deferred.promise;
}

/**
 * Locates where in the document the change should be applied by finding the best
 * matching context and identifying the section to be replaced.
 */
function locateChangeInDocument(docLines: string[], changeLines: string[]): {
    startLine: number,
    endLine: number,
    replacementText: string
} {
    // Helper function to compare two string arrays (slices)
    function arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }

    let docReplaceStartLine = 0;
    let docReplaceEndLine = docLines.length;
    let changeSliceStart = 0;
    let changeSliceEnd = changeLines.length;

    // Find the longest prefix of changeLines that matches in docLines
    for (let prefixLenInCl = Math.min(changeLines.length, docLines.length); prefixLenInCl >= 1; prefixLenInCl--) {
        const prefixCl = changeLines.slice(0, prefixLenInCl);
        for (let line = 0; line <= docLines.length - prefixLenInCl; line++) {
            if (arraysEqual(docLines.slice(line, line + prefixLenInCl), prefixCl)) {
                docReplaceStartLine = line + prefixLenInCl;
                changeSliceStart = prefixLenInCl;
                prefixLenInCl = 0; // Signal to break outer loop
                break; // Break inner loop
            }
        }
    }

    // Find the longest suffix of the remaining changeLines that matches in docLines
    // The suffix must start at or after the end of the identified prefix context in docLines
    const maxSuffixPossibleInCl = Math.min(changeLines.length - changeSliceStart, Math.max(0, docLines.length - docReplaceStartLine));
    for (let suffixLenInCl = maxSuffixPossibleInCl; suffixLenInCl >= 1; suffixLenInCl--) {
        const suffixCl = changeLines.slice(changeLines.length - suffixLenInCl);
        for (let line = docReplaceStartLine; line <= docLines.length - suffixLenInCl; line++) {
            if (arraysEqual(docLines.slice(line, line + suffixLenInCl), suffixCl)) {
                docReplaceEndLine = line;
                changeSliceEnd = changeLines.length - suffixLenInCl;
                suffixLenInCl = 0; // Signal to break outer loop
                break; // Break inner loop
            }
        }
    }

    const replacementText = changeLines.slice(changeSliceStart, changeSliceEnd).join('\n');

    return {
        startLine: docReplaceStartLine,
        endLine: docReplaceEndLine,
        replacementText: replacementText
    };
}

/**
 * Calculates the character offset in the document for a given line.
 */
function calculateOffset(text: string, line: number): number {
    const lines = text.split('\n');
    let offset = 0;

    for (let i = 0; i < line; i++) {
        offset += lines[i].length + 1; // +1 for the newline character
    }

    return offset;
}

/**
 * Applies line-based edits from MCP tool calls to the document.
 * Edits are sorted in descending order by line number to avoid offset shifts.
 */
export function applyLineEdits(
    docPath: string,
    docContent: string,
    edits: LineEdit[],
    documentSync: IDocumentSync
): void {
    if (edits.length === 0) {
        return;
    }

    let currentContent = docContent;

    // Sort edits by line number (descending) to avoid offset shifts when applying multiple edits
    const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);

    for (const edit of sortedEdits) {
        if (edit.type === 'replace' && edit.endLine !== undefined && edit.content !== undefined) {
            // Replace lines from startLine to endLine (inclusive, 1-indexed)
            const startOffset = calculateOffset(currentContent, edit.startLine - 1);
            const endOffset = calculateOffset(currentContent, edit.endLine);
            const length = endOffset - startOffset;

            console.log(`Replacing lines ${edit.startLine}-${edit.endLine} (offset ${startOffset}, length ${length})`);
            documentSync.applyEdit(docPath, edit.content, startOffset, length);

            // Update local state
            currentContent =
                currentContent.substring(0, startOffset) +
                edit.content +
                currentContent.substring(endOffset);
        } else if (edit.type === 'insert' && edit.content !== undefined) {
            // Insert content before the specified line (1-indexed)
            const insertOffset = edit.startLine === 1 ? 0 : calculateOffset(currentContent, edit.startLine - 1);

            console.log(`Inserting at line ${edit.startLine} (offset ${insertOffset})`);
            // Add newline if we're inserting in the middle of the document
            const contentToInsert = edit.startLine === 1 ? edit.content + '\n' : edit.content + '\n';
            documentSync.applyEdit(docPath, contentToInsert, insertOffset, 0);

            // Update local state
            currentContent =
                currentContent.substring(0, insertOffset) +
                contentToInsert +
                currentContent.substring(insertOffset);
        } else if (edit.type === 'delete' && edit.endLine !== undefined) {
            // Delete lines from startLine to endLine (inclusive, 1-indexed)
            const startOffset = calculateOffset(currentContent, edit.startLine - 1);
            const endOffset = calculateOffset(currentContent, edit.endLine);
            const length = endOffset - startOffset;

            console.log(`Deleting lines ${edit.startLine}-${edit.endLine} (offset ${startOffset}, length ${length})`);
            documentSync.applyEdit(docPath, '', startOffset, length);

            // Update local state
            currentContent =
                currentContent.substring(0, startOffset) +
                currentContent.substring(endOffset);
        }
    }
}
