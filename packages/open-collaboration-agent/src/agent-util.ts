// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Deferred } from 'open-collaboration-protocol';
import type { IDocumentSync } from './document-sync.js';

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

        // Locate the change in the document with context
        const location = locateChangeInDocument(currentLines, changeLines);

        if (location.endLine > location.startLine) {
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
