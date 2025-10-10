// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { type CoreMessage, generateText, streamText, StreamTextResult } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export interface PromptInput {
    document: string
    prompt: string
    promptOffset: number
    model: string
}

export interface LineEdit {
    type: 'replace' | 'insert' | 'delete';
    startLine: number;
    endLine?: number;
    content?: string;
}

export async function executePrompt(input: PromptInput): Promise<string[]> {
    const provider = getProviderForModel(input.model);
    const languageModel = provider(input.model);
    const messages: CoreMessage[] = [];

    const processedDocument = prepareDocumentForLLM(input.document, input.promptOffset);

    messages.push({
        role: 'user',
        content: processedDocument
    });
    messages.push({
        role: 'user',
        content: `---USER PROMPT:\n${input.prompt}`
    });

    const result = await generateText({
        model: languageModel,
        system: systemPrompt,
        messages
    });

    return parseOutputRegions(result.text);
}

export function executePromptStreamed(input: PromptInput): StreamTextResult<never, string> {
    const provider = getProviderForModel(input.model);
    const languageModel = provider(input.model);
    const messages: CoreMessage[] = [];

    const processedDocument = prepareDocumentForLLM(input.document, input.promptOffset);

    messages.push({
        role: 'user',
        content: processedDocument
    });
    messages.push({
        role: 'user',
        content: `---USER PROMPT:\n${input.prompt}`
    });

    const result = streamText({
        model: languageModel,
        system: systemPrompt,
        messages
    });

    return result;
}

/**
 * Determines the LLM provider based on the model string.
 */
function getProviderForModel(modelId: string) {
    if (modelId.startsWith('claude-')) {
        return anthropic;
    }
    if (modelId.startsWith('gpt-') || modelId.startsWith('o')) {
        return openai;
    }
    throw new Error(`Unknown model: ${modelId}`);
}

const systemPrompt = `
You are a coding agent operating on a single source code file or a portion of it. Your task is to modify the code according to a user prompt. This same prompt is also embedded in the code, typically inside a comment line starting with the user-chosen agent name, e.g. \`// @my-agent\`. The location of the prompt inside the code is important to understand the purpose of the change.

Your response must be in **one** of the following two formats:

1. **Full File Replacement Format**
   Return the **entire updated source code**, incorporating the requested changes seamlessly. Use this format when the file is small or the changes affect many parts of the file.

2. **Partial Change Format**
   Return **only the modified code regions**, using the following structure:
   - Each modified region must:
     - Start with at least **one unchanged line of code before** the modified section (context).
     - End with at least **one unchanged line of code after** the modified section (context).
     - Clearly show the **resulting text after applying the change** (inserted, deleted, or replaced code).
   - Separate multiple modified regions using a line of **10 or more equal signs**, exactly:
\`\`\`
==========
\`\`\`
   - When providing multiple modified regions, ensure they are in the correct order as they appear in the code.

Additional Rules:
- Your understanding of the task must be based only on the user's prompt and the source code provided.
- Ensure there is enough surrounding context to uniquely and unambiguously locate each change within the original code.
- Be robust to partial files: do not assume full-file context unless given.
- If the task is straightforward, you may remove the user's prompt as part of your proposed changes.
- If you'd like to provide explanations or reasoning for a more complex task, keep the user's prompt and add your own comment below it.
- Do **not** write any introductory text nor any summary or concluding text. Do **not** write any placeholder text (e.g. "[remaining code unchanged]"). Your output **must** focus purely on the changes to the code.

Your output will be automatically parsed and applied to the original code. Therefore, format compliance is critical. Do not include anything outside the valid output formats.
`;

const CONTEXT_LIMIT = 12000;

function prepareDocumentForLLM(document: string, promptOffset: number): string {
    if (document.length <= 2 * CONTEXT_LIMIT) {
        return document;
    }

    let startPos = Math.max(0, promptOffset - CONTEXT_LIMIT);
    while (startPos > 0 && document[startPos - 1] !== '\n') {
        startPos--;
    }

    let endPos = Math.min(document.length, promptOffset + CONTEXT_LIMIT);
    while (endPos < document.length && document[endPos] !== '\n') {
        endPos++;
    }

    return document.substring(startPos, endPos);
}

function parseOutputRegions(text: string): string[] {
    // Remove any trailing line in square brackets (e.g., [...], [remaining code], etc.)
    text = text.replace(/\n\[[^\]]+\]\s*$/g, '');

    // Split by lines containing 10 or more equal signs
    const separatorRegex = /^={10,}$/;
    const lines = text.split('\n');
    const regions: string[] = [];
    let currentRegion: string[] = [];

    for (const line of lines) {
        if (separatorRegex.test(line.trim())) {
            if (currentRegion.length > 0) {
                regions.push(currentRegion.join('\n'));
                currentRegion = [];
            }
        } else {
            currentRegion.push(line);
        }
    }

    // Add the last region if it exists
    if (currentRegion.length > 0) {
        regions.push(currentRegion.join('\n'));
    }

    return regions;
}

// ============================================================================
// MCP Tool-based Execution
// ============================================================================

const systemPromptWithMCP = `
You are a coding agent operating on a single source code file. Your task is to modify the code according to a user prompt. This same prompt is also embedded in the code, typically inside a comment line starting with the user-chosen agent name.

You have access to the following tools:
- get_line_range: Read specific lines from the document (1-indexed line numbers)
- replace_lines: Replace a range of lines with new content
- insert_at_line: Insert new content before a specific line
- delete_lines: Delete a range of lines

Workflow:
1. Use get_line_range to understand the file structure and locate relevant code
2. Use replace_lines, insert_at_line, or delete_lines to make the requested changes
3. You can make multiple changes by calling tools multiple times
4. All edits are queued and will be applied in the optimal order automatically

Important:
- Line numbers are 1-indexed (first line is line 1)
- Always use get_line_range to confirm line numbers before modifying
- THE DOCUMENT DOES NOT CHANGE during your execution - all get_line_range calls return the same original document
- All your edit operations are queued and applied together at the end in the correct order
- This means you should always use the line numbers from the original document you see
- For multiple edits, simply specify the line numbers as they appear in the original document
- The system will automatically apply them in descending order to avoid line shifts
- Be precise with line ranges to avoid unintended changes
- When replacing lines, the replacement includes everything from start_line to end_line (inclusive)

CRITICAL - Marking Changes:
- You MUST mark all your changes with comments so users can identify what you modified
- Add a comment "// AI: <brief description>" or "/* AI: <brief description> */" before or after the changed code
- Use the appropriate comment syntax for the file type (e.g., // for JS/TS/Java, # for Python, <!-- --> for HTML)
- Keep the marker comments concise and descriptive
- Example for JavaScript:
  Original: function foo() { return x; }
  Modified: // AI: Added error handling
            function foo() {
                try {
                    return x;
                } catch (err) {
                    console.error(err);
                }
            }

CRITICAL - Complete All Requested Changes:
- Read the user's prompt carefully and ensure you complete ALL requested changes
- If the user asks for multiple operations (e.g., "add X after each function AND delete Y"), you must do ALL of them
- Don't stop after completing just one part of a multi-part request
- Use all 20 available tool calls if needed to complete complex tasks
`;

export async function executePromptWithMCP(input: PromptInput): Promise<LineEdit[]> {
    const provider = getProviderForModel(input.model);
    const languageModel = provider(input.model);
    const messages: CoreMessage[] = [];

    const processedDocument = prepareDocumentForLLM(input.document, input.promptOffset);

    messages.push({
        role: 'user',
        content: processedDocument
    });
    messages.push({
        role: 'user',
        content: `---USER PROMPT:\n${input.prompt}`
    });

    // Store edits that should be applied
    const pendingEdits: LineEdit[] = [];

    await generateText({
        model: languageModel,
        system: systemPromptWithMCP,
        messages,
        maxSteps: 20,  // Allow LLM to make many tool calls for complex multi-edit tasks
        tools: {
            get_line_range: {
                description: "Get specific lines from the document with line numbers. Lines are 1-indexed.",
                parameters: z.object({
                    start_line: z.number().int().positive().describe("Starting line number (1-indexed)"),
                    end_line: z.number().int().positive().describe("Ending line number (1-indexed, inclusive)")
                }),
                execute: async ({ start_line, end_line }) => {
                    const lines = input.document.split('\n');
                    if (start_line > lines.length || end_line > lines.length || start_line > end_line) {
                        return { error: `Invalid line range. Document has ${lines.length} lines. Requested: ${start_line}-${end_line}` };
                    }
                    const selectedLines = lines.slice(start_line - 1, end_line);
                    return selectedLines
                        .map((line, idx) => `${start_line + idx}: ${line}`)
                        .join('\n');
                }
            },
            replace_lines: {
                description: "Replace a specific range of lines with new content. The range is inclusive (start_line to end_line). All edits will be applied in the correct order at the end.",
                parameters: z.object({
                    start_line: z.number().int().positive().describe("Starting line number (1-indexed)"),
                    end_line: z.number().int().positive().describe("Ending line number (1-indexed, inclusive)"),
                    new_content: z.string().describe("The new content to replace the lines with")
                }),
                execute: async ({ start_line, end_line, new_content }) => {
                    const lines = input.document.split('\n');
                    if (start_line > lines.length || end_line > lines.length || start_line > end_line) {
                        return { error: `Invalid line range. Document has ${lines.length} lines.` };
                    }

                    // Queue this edit to be applied
                    pendingEdits.push({
                        type: 'replace',
                        startLine: start_line,
                        endLine: end_line,
                        content: new_content
                    });

                    return {
                        success: true,
                        message: `Queued replacement of lines ${start_line}-${end_line}`
                    };
                }
            },
            insert_at_line: {
                description: "Insert new content before the specified line number. All edits will be applied in the correct order at the end.",
                parameters: z.object({
                    line: z.number().int().positive().describe("Line number to insert before (1-indexed)"),
                    content: z.string().describe("The content to insert")
                }),
                execute: async ({ line, content }) => {
                    const lines = input.document.split('\n');
                    if (line > lines.length + 1) {
                        return { error: `Invalid line number. Document has ${lines.length} lines.` };
                    }

                    // Queue this edit to be applied
                    pendingEdits.push({
                        type: 'insert',
                        startLine: line,
                        content: content
                    });

                    return {
                        success: true,
                        message: `Queued insertion at line ${line}`
                    };
                }
            },
            delete_lines: {
                description: "Delete a range of lines from the document. All edits will be applied in the correct order at the end.",
                parameters: z.object({
                    start_line: z.number().int().positive().describe("Starting line number (1-indexed)"),
                    end_line: z.number().int().positive().describe("Ending line number (1-indexed, inclusive)")
                }),
                execute: async ({ start_line, end_line }) => {
                    const lines = input.document.split('\n');
                    if (start_line > lines.length || end_line > lines.length || start_line > end_line) {
                        return { error: `Invalid line range. Document has ${lines.length} lines.` };
                    }

                    // Queue this edit to be applied
                    pendingEdits.push({
                        type: 'delete',
                        startLine: start_line,
                        endLine: end_line
                    });

                    return {
                        success: true,
                        message: `Queued deletion of lines ${start_line}-${end_line}`
                    };
                }
            }
        }
    });

    console.log(`LLM made ${pendingEdits.length} edit operations`);

    return pendingEdits;
}
