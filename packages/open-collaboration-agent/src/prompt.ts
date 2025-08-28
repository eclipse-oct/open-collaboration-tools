// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { type CoreMessage, generateText, streamText, StreamTextResult } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

export interface PromptInput {
    document: string
    prompt: string
    promptOffset: number
    model: string
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
- Do **not** write any introductory text now any summary or concluding text. Do **not** write any placeholder text (e.g. "[remaining code unchanged]"). Your output **must** focus purely on the changes to the code.

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
