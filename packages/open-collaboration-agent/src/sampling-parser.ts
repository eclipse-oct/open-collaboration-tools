// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { LineEdit } from './document-operations.js';

/**
 * System prompt for MCP sampling requests
 * Instructs the AI to return structured edits that can be parsed
 */
export const SAMPLING_SYSTEM_PROMPT = `You are a collaborative code editing assistant. When given a code editing task, you should:

1. Analyze the provided code context
2. Generate the requested changes
3. Return your edits in a structured format with clear markers

IMPORTANT: Always mark your changes with AI marker comments so developers know what you modified:
- JavaScript/TypeScript/Java/C++: // AI: <description>
- Python/Ruby/Shell: # AI: <description>
- HTML/XML: <!-- AI: <description> -->
- CSS: /* AI: <description> */

Your response should focus on the specific changes needed. Be precise and minimal in your edits.`;

/**
 * Sampling response from MCP client
 */
export interface SamplingResponse {
    role: 'assistant';
    content: Array<{
        type: 'text';
        text: string;
    }>;
    model?: string;
    stopReason?: string;
}

/**
 * Parsed edit result
 */
export interface ParsedEdit {
    type: 'replace' | 'insert' | 'delete';
    startLine: number;
    endLine?: number;
    content?: string;
    description?: string;
}

/**
 * Parse AI response from sampling to extract code edits
 * This is a best-effort parser that looks for common patterns in AI responses
 */
export function parseSamplingResponse(
    response: SamplingResponse,
    originalContent: string
): ParsedEdit[] {
    const edits: ParsedEdit[] = [];

    // Extract text content from response
    const responseText = response.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');

    // Try to extract code blocks
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
    const codeBlocks: string[] = [];
    let match;

    while ((match = codeBlockRegex.exec(responseText)) !== null) {
        codeBlocks.push(match[1]);
    }

    // If we found code blocks, treat the first/largest as the edit
    if (codeBlocks.length > 0) {
        // Use the largest code block as it's likely the main edit
        const mainEdit = codeBlocks.reduce((a, b) => (a.length > b.length ? a : b));

        // For now, we'll do a simple replacement approach:
        // Find where the new code should go by looking at the original content
        // This is a simplified parser - in production you'd want more sophisticated logic

        // Try to infer the edit type and location
        // Check if this looks like a full file replacement or a partial edit
        // For now, we'll assume it's an insert at the trigger location
        edits.push({
            type: 'insert',
            startLine: 1, // Will be adjusted by caller based on trigger location
            content: mainEdit,
            description: 'AI-generated code from sampling',
        });
    } else if (responseText.trim()) {
        // No code blocks found, but we have text
        // Try to use the text directly as code
        edits.push({
            type: 'insert',
            startLine: 1,
            content: responseText.trim(),
            description: 'AI-generated response',
        });
    }

    return edits;
}

/**
 * Convert parsed edits to DocumentSyncOperations LineEdit format
 */
export function convertToLineEdits(
    parsedEdits: ParsedEdit[],
    triggerLineNumber: number
): LineEdit[] {
    return parsedEdits.map(edit => {
        const lineEdit: LineEdit = {
            type: edit.type,
            startLine: triggerLineNumber + (edit.startLine - 1),
            endLine: edit.endLine ? triggerLineNumber + (edit.endLine - 1) : undefined,
            content: edit.content,
        };

        return lineEdit;
    });
}

/**
 * Create sampling request parameters for a trigger
 */
export function createSamplingRequest(
    docPath: string,
    docContent: string,
    prompt: string,
    triggerOffset: number
): {
    messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>;
    systemPrompt: string;
    maxTokens: number;
} {
    // Extract context around the trigger location
    const contextLines = 20; // lines before and after
    const lines = docContent.split('\n');
    const triggerLineIndex = docContent.substring(0, triggerOffset).split('\n').length - 1;

    const startLine = Math.max(0, triggerLineIndex - contextLines);
    const endLine = Math.min(lines.length, triggerLineIndex + contextLines);

    const contextSnippet = lines
        .slice(startLine, endLine)
        .map((line, idx) => `${startLine + idx + 1}: ${line}`)
        .join('\n');

    const userMessage = `File: ${docPath}

Context (showing lines ${startLine + 1}-${endLine}):
\`\`\`
${contextSnippet}
\`\`\`

Task: ${prompt}

Please provide the code changes needed. Include AI marker comments (e.g., // AI: added validation) for all changes.`;

    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: userMessage,
                },
            },
        ],
        systemPrompt: SAMPLING_SYSTEM_PROMPT,
        maxTokens: 4096,
    };
}
