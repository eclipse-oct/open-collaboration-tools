# Open Collaboration Agent - Code Analysis

## Overview
The `open-collaboration-agent` is an AI-powered coding assistant that joins collaborative editing sessions through the Open Collaboration Tools framework. It listens for `@agent` mentions in code files and executes LLM-powered code modifications in real-time.

## Core Workflow

### 1. Entry Point: `src/main.ts`
- **Purpose**: CLI setup using Commander.js
- **Configuration**:
  - `-s, --server`: OCT server URL (default: `https://api.open-collab.tools/`)
  - `-m, --model`: LLM model selection (default: `claude-3-5-sonnet-latest`)
  - `-r, --room`: Room ID (required)
- **Action**: Calls `startCLIAgent()` from `agent.ts`

### 2. Agent Initialization: `src/agent.ts:startCLIAgent()`
**Steps** (lines 20-102):

1. **Protocol Setup**: Initializes Open Collaboration Protocol with WebCrypto
2. **Authentication**:
   - Creates `ConnectionProvider` with SocketIO transport
   - Prints login URL to console
   - Waits for user to authenticate via browser
3. **Room Connection**:
   - Joins specified room using room ID
   - Connects to room using returned room token
4. **Signal Handlers**: Sets up graceful shutdown on SIGINT/SIGTERM
5. **Document Sync**: Creates `DocumentSync` instance
6. **Identity**: Waits for peer info to determine agent's username
7. **Agent Loop**: Calls `runAgent()` to start listening for prompts

### 3. Agent Main Loop: `src/agent.ts:runAgent()`
**Core Logic** (lines 104-203):

```typescript
State {
  executing: boolean        // Prevents concurrent executions
  documentChanged: boolean  // Tracks if document changed during execution
  animationAbort: AbortController | undefined
}
```

**Event Handlers**:

**a) Active Document Change** (line 116):
- Logs when host switches to a different file

**b) Document Content Change** (lines 121-202):
- **Trigger Detection**: Looks for newline insertions containing `@{agent-name}`
- **Extraction**: Parses the prompt text after the trigger
- **Execution Guard**: Skips if already executing (sets `documentChanged = true`)
- **Loading Animation**: Shows spinning indicator at prompt location
- **LLM Invocation**: Calls `executePrompt()` with:
  - Document content
  - Prompt text
  - Prompt offset (for context windowing)
  - Model ID
- **Change Application**: Applies returned code changes via `applyChanges()`
- **State Cleanup**: Resets execution flags

### 4. Document Synchronization: `src/document-sync.ts`
**Purpose**: Manages real-time document collaboration using Yjs CRDT

**Key Components**:

**a) Yjs Integration** (lines 40-60):
- `Y.Doc`: Yjs document
- `awarenessProtocol.Awareness`: Peer awareness
- `OpenCollaborationYjsProvider`: Sync provider with 10s resync timer

**b) Host Following** (lines 67-93):
- Listens to awareness changes from host
- Automatically switches to host's active document
- Requests document content via `connection.editor.open()`

**c) Change Tracking** (lines 125-167):
- Observes Yjs document changes
- Converts Yjs deltas to `DocumentChange` events
- Filters out:
  - Initial sync events
  - Local (agent-generated) changes
- Emits structured changes with line/column positions

**d) Edit Application** (lines 224-247):
- Applies text edits to Yjs document
- Special case for single-char replacements (flicker-free animation)

### 5. LLM Interaction: `src/prompt.ts`

**a) `executePrompt()` (lines 18-41)**:
- **Provider Selection**: Detects Anthropic (claude-*) vs OpenAI (gpt-*, o*)
- **Context Preparation**:
  - Calls `prepareDocumentForLLM()` to window content around prompt (12k chars before/after)
  - Sends document + user prompt as separate messages
- **System Prompt** (lines 81-110): Instructs LLM to return either:
  1. **Full file replacement**: Entire updated code
  2. **Partial changes**: Modified regions with context, separated by `==========`
- **Parsing**: `parseOutputRegions()` splits response by `==========` delimiter

**b) `executePromptStreamed()` (lines 43-66)**:
- Same as above but returns `StreamTextResult` for streaming responses
- Currently commented out in agent.ts (lines 159-171)

### 6. Change Application: `src/agent-util.ts`

**a) `applyChanges()` (lines 14-44)**:
- Iterates through LLM-returned change regions
- For each region:
  1. **Locate**: `locateChangeInDocument()` finds matching context in current doc
  2. **Calculate Offsets**: Converts line numbers to character offsets
  3. **Apply Edit**: Calls `documentSync.applyEdit()`
  4. **Update State**: Maintains local document copy for subsequent edits

**b) `locateChangeInDocument()` (lines 144-202)**:
- **Algorithm**:
  1. Find longest matching prefix (unchanged context before edit)
  2. Find longest matching suffix (unchanged context after edit)
  3. Everything between = replacement text
- Robust to partial files and ambiguous matches

**c) `animateLoadingIndicator()` (lines 102-138)**:
- Shows spinning animation (`|`, `/`, `-`, `\`) at 250ms intervals
- Aborted when LLM completes
- Cleanup removes the indicator character

**d) `applyChangesStreamed()` (lines 46-81)**:
- Experimental: Types out LLM response character-by-character
- Variable delays for realistic typing (50-100ms for spaces/newlines)
- Currently unused

## Essential Code Locations

| Functionality | File:Line |
|---------------|-----------|
| CLI entry point | `main.ts:14-21` |
| Agent initialization | `agent.ts:20-102` |
| Prompt trigger detection | `agent.ts:132-141` |
| LLM execution | `agent.ts:152-157` |
| Document following logic | `document-sync.ts:67-93` |
| Change event handling | `document-sync.ts:125-167` |
| LLM system prompt | `prompt.ts:81-110` |
| Context windowing | `prompt.ts:114-130` |
| Change localization algorithm | `agent-util.ts:144-202` |
| Edit application | `agent-util.ts:14-44` |

## Key Design Decisions

1. **Yjs CRDT**: Ensures conflict-free collaborative editing
2. **Context Windowing**: Limits LLM input to 24k chars (12k before/after prompt) for large files
3. **Change Format**: LLM returns either full file or context-anchored regions for unambiguous application
4. **State Management**: Prevents concurrent executions, handles document changes during processing
5. **Loading Animation**: Provides visual feedback during LLM processing
6. **Streaming Support**: Infrastructure exists but currently disabled (lines 159-171 in `agent.ts`)

## MCP (Model Context Protocol) Integration

### Current Tool Usage Analysis

**The agent currently does NOT use any LLM tools.** The implementation follows a simple prompt-response pattern:

1. User types `@agent <prompt>` in the document
2. Agent sends document content + prompt to LLM (`src/prompt.ts:34-38`)
3. LLM returns modified code regions or full file replacement (as plain text)
4. Agent parses and applies changes using string matching (`src/agent-util.ts:14-44`)

The LLM has no tools or function-calling capabilities available - it simply returns text that the `locateChangeInDocument()` algorithm attempts to match against the current file.

### Current Limitations: String Matching Fragility

The `locateChangeInDocument()` function (`src/agent-util.ts:144-202`) uses prefix/suffix string matching to locate where changes should be applied. This approach is **fragile** and breaks in several scenarios:

#### Problem Scenarios:

1. **Document Changed During Execution**
   - User or other collaborators edit the document while LLM is processing
   - String matching may fail or apply changes to wrong location
   - Mitigation exists (`documentChanged` flag) but doesn't solve ambiguity

2. **Multiple Similar Code Sections**
   ```typescript
   // File has two similar functions
   function calculateTotal(items) { ... }
   function calculateSubtotal(items) { ... }
   ```
   - LLM returns change for "calculateTotal"
   - If context is insufficient, may match wrong function
   - Prefix/suffix algorithm picks first match, not necessarily correct one

3. **Insufficient Context from LLM**
   - LLM must return enough unchanged lines before/after changes
   - If LLM is too concise, matching fails
   - System prompt requires "at least one unchanged line" but this may not be enough

4. **Large File Ambiguity**
   - With context windowing (±12k chars), LLM only sees partial file
   - May return changes that match multiple locations in full file
   - No line number information to disambiguate

5. **Silent Failures**
   - If `endLine < startLine`, change is silently skipped (line 26 in `applyChanges`)
   - No error message to user or log entry
   - User may not realize their prompt failed

### MCP Solution: Direct Position Tools

**MCP (Model Context Protocol) would give the LLM precise line-based tools** to read and modify the document, eliminating string matching entirely.

#### Example Tool Definitions:

```typescript
// Tool 1: Get specific lines with their numbers
{
  name: "get_line_range",
  description: "Get specific lines from the document with exact line numbers",
  parameters: {
    start_line: number,  // 1-indexed line number
    end_line: number     // inclusive
  },
  returns: string        // Lines with line numbers prepended
}

// Tool 2: Replace exact line range
{
  name: "replace_lines",
  description: "Replace a specific range of lines with new content",
  parameters: {
    start_line: number,
    end_line: number,
    new_content: string
  },
  returns: { success: boolean, lines_changed: number }
}

// Tool 3: Insert at specific line
{
  name: "insert_at_line",
  description: "Insert new content at a specific line number",
  parameters: {
    line: number,        // Insert before this line
    content: string
  },
  returns: { success: boolean, lines_inserted: number }
}

// Tool 4: Delete line range
{
  name: "delete_lines",
  description: "Delete a specific range of lines",
  parameters: {
    start_line: number,
    end_line: number
  },
  returns: { success: boolean, lines_deleted: number }
}

// Tool 5: Search for code pattern
{
  name: "search_code",
  description: "Search for a code pattern and return line numbers",
  parameters: {
    pattern: string,     // Regex or plain text
    max_results: number
  },
  returns: Array<{ line: number, content: string }>
}
```

### Concrete Benefits: Before/After Comparison

#### Before (Current String Matching):

**Scenario**: User asks to "Change the `calculateTotal` function to use reduce"

1. LLM returns:
   ```javascript
   function calculateTotal(items) {
       return items.reduce((sum, item) => sum + item.price, 0);
   }
   ```

2. Agent calls `locateChangeInDocument()` to fuzzy-match:
   - Searches entire document for matching prefix/suffix
   - May fail if:
     - Document changed during execution
     - Multiple similar function signatures exist
     - Not enough context provided by LLM

3. **Failure modes**:
   - Wrong function modified
   - Change silently skipped
   - Partial match causes syntax errors

#### After (With MCP Tools):

**Same scenario with MCP tools**:

1. LLM workflow:
   ```
   Step 1: Call get_line_range(1, 50) to see the file structure
   Step 2: Identify calculateTotal is at lines 23-26
   Step 3: Call replace_lines(23, 26, "function calculateTotal(items) {\n    return items.reduce((sum, item) => sum + item.price, 0);\n}")
   ```

2. Agent receives tool calls:
   - Each tool call has precise line numbers
   - No ambiguity about location
   - No string matching needed

3. **No failure modes**:
   - Exact location specified
   - If lines changed, tool can report conflict
   - User gets clear error message if line numbers invalid

### Implementation Path

#### 1. Add MCP SDK Integration

**File**: `src/prompt.ts`

Modify `executePrompt()` to include tool definitions:

```typescript
import { z } from 'zod';

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
        system: systemPromptWithMCP,  // Updated system prompt
        messages,
        tools: {
            get_line_range: {
                description: "Get specific lines from the document with line numbers. Lines are 1-indexed.",
                parameters: z.object({
                    start_line: z.number().int().positive(),
                    end_line: z.number().int().positive()
                }),
                execute: async ({ start_line, end_line }) => {
                    const lines = input.document.split('\n');
                    if (start_line > lines.length || end_line > lines.length) {
                        return { error: `Line range out of bounds. Document has ${lines.length} lines.` };
                    }
                    const selectedLines = lines.slice(start_line - 1, end_line);
                    return selectedLines
                        .map((line, idx) => `${start_line + idx}: ${line}`)
                        .join('\n');
                }
            },
            replace_lines: {
                description: "Replace a specific range of lines with new content",
                parameters: z.object({
                    start_line: z.number().int().positive(),
                    end_line: z.number().int().positive(),
                    new_content: z.string()
                }),
                execute: async ({ start_line, end_line, new_content }) => {
                    // Queue this edit operation to be applied later
                    // Return success status
                    return {
                        success: true,
                        start_line,
                        end_line,
                        replacement: new_content
                    };
                }
            },
            insert_at_line: {
                description: "Insert new lines before the specified line number",
                parameters: z.object({
                    line: z.number().int().positive(),
                    content: z.string()
                }),
                execute: async ({ line, content }) => {
                    return {
                        success: true,
                        insertion_point: line,
                        content: content
                    };
                }
            },
            delete_lines: {
                description: "Delete a range of lines from the document",
                parameters: z.object({
                    start_line: z.number().int().positive(),
                    end_line: z.number().int().positive()
                }),
                execute: async ({ start_line, end_line }) => {
                    return {
                        success: true,
                        deleted_lines: end_line - start_line + 1
                    };
                }
            }
        },
        maxToolRoundtrips: 5  // Allow LLM to make multiple tool calls
    });

    // Process tool call results instead of parsing text regions
    return processToolCallResults(result);
}
```

#### 2. Update System Prompt

Replace `systemPrompt` in `src/prompt.ts` with MCP-aware instructions:

```typescript
const systemPromptWithMCP = `
You are a coding agent operating on a single source code file. Your task is to modify the code according to a user prompt.

You have access to the following tools:
- get_line_range: Read specific lines from the document (1-indexed)
- replace_lines: Replace a range of lines with new content
- insert_at_line: Insert new content before a specific line
- delete_lines: Delete a range of lines

Workflow:
1. Use get_line_range to understand the file structure and locate relevant code
2. Use replace_lines, insert_at_line, or delete_lines to make changes
3. You can make multiple changes by calling tools multiple times

Important:
- Line numbers are 1-indexed (first line is line 1)
- Always use get_line_range first to confirm line numbers before modifying
- If you're unsure about line numbers, search incrementally
- Be precise with line ranges to avoid unintended changes
`;
```

#### 3. Create Tool Result Processor

New function to convert tool calls to document edits:

```typescript
interface LineEdit {
    type: 'replace' | 'insert' | 'delete';
    startLine: number;
    endLine?: number;
    content?: string;
}

function processToolCallResults(result: GenerateTextResult): LineEdit[] {
    const edits: LineEdit[] = [];

    // Extract tool calls from result
    for (const toolCall of result.toolCalls || []) {
        if (toolCall.toolName === 'replace_lines') {
            edits.push({
                type: 'replace',
                startLine: toolCall.args.start_line,
                endLine: toolCall.args.end_line,
                content: toolCall.args.new_content
            });
        } else if (toolCall.toolName === 'insert_at_line') {
            edits.push({
                type: 'insert',
                startLine: toolCall.args.line,
                content: toolCall.args.content
            });
        } else if (toolCall.toolName === 'delete_lines') {
            edits.push({
                type: 'delete',
                startLine: toolCall.args.start_line,
                endLine: toolCall.args.end_line
            });
        }
    }

    return edits;
}
```

#### 4. Modify Agent to Apply Line-Based Edits

Update `src/agent.ts` to use line-based edits instead of string regions:

```typescript
// In runAgent() after executePrompt() call
const lineEdits = await executePromptWithMCP({
    document: docContent,
    prompt,
    promptOffset: change.offset,
    model: options.model
});

// Apply line-based edits with precise offsets
applyLineEdits(docPath, currentContent, lineEdits, documentSync);
```

New function in `src/agent-util.ts`:

```typescript
export function applyLineEdits(
    docPath: string,
    docContent: string,
    edits: LineEdit[],
    documentSync: IDocumentSync
): void {
    let currentContent = docContent;
    let lines = currentContent.split('\n');

    // Sort edits by line number (descending) to avoid offset shifts
    edits.sort((a, b) => b.startLine - a.startLine);

    for (const edit of edits) {
        if (edit.type === 'replace') {
            const startOffset = calculateOffset(currentContent, edit.startLine - 1);
            const endOffset = calculateOffset(currentContent, edit.endLine);
            const length = endOffset - startOffset;

            documentSync.applyEdit(docPath, edit.content, startOffset, length);

            // Update local state
            currentContent =
                currentContent.substring(0, startOffset) +
                edit.content +
                currentContent.substring(endOffset);
            lines = currentContent.split('\n');
        }
        // Handle insert and delete types similarly...
    }
}
```

### Key Advantages Over Current Approach

✅ **Resilient to Document Changes**
   - Line numbers remain valid even if document changed slightly
   - Can detect conflicts (e.g., "line 50 doesn't match expected content")
   - Can re-query current state before applying edits

✅ **No Ambiguous Matching**
   - LLM specifies exact line numbers
   - No fuzzy string matching needed
   - No risk of modifying wrong code section

✅ **Better for Large Files**
   - LLM can query specific sections incrementally
   - Doesn't need to return full context for matching
   - Can explore file structure systematically

✅ **Supports Multi-Step Edits**
   - LLM can read → analyze → modify in multiple rounds
   - Can verify changes before applying
   - Can make related changes across different sections

✅ **Clearer Intent and Debugging**
   - Tool calls explicitly show what's being modified
   - Easy to log and debug exact operations
   - User can see "replace lines 23-26" in logs

✅ **Error Handling**
   - Can validate line numbers before applying
   - Can report conflicts (e.g., "line 50 was modified")
   - Can ask user to resolve conflicts

✅ **Reduced Token Usage**
   - LLM doesn't need to return full context lines
   - Only needs to specify line numbers and new content
   - Can incrementally query instead of processing full context window

### Migration Path

To migrate from current approach to MCP tools:

1. **Phase 1**: Implement MCP tools alongside existing text parsing
   - Keep both code paths
   - Detect if LLM response contains tool calls or text regions
   - Use appropriate handler

2. **Phase 2**: Update system prompt to prefer tools
   - Instruct LLM to use tools when available
   - Fall back to text regions for models without tool support

3. **Phase 3**: Deprecate text-based parsing
   - Remove `parseOutputRegions()` and `locateChangeInDocument()`
   - Require tool-capable models

### Dependencies to Add

```json
{
  "dependencies": {
    "zod": "^3.22.0"  // For tool parameter validation
  }
}
```

No additional MCP-specific packages needed - Vercel AI SDK (`ai` package) already supports tool calling via its built-in `tools` parameter.

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User in VS Code                          │
│                  Types: // @agent Write a function              │
│                         Presses Enter                            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Open Collaboration Server                      │
│                    (broadcasts via SocketIO)                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                      DocumentSync (Yjs)                          │
│  • Receives Yjs delta from server                               │
│  • Converts to DocumentChange events                            │
│  • Filters out initial sync & local changes                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                    runAgent() Event Handler                      │
│  • Detects newline insertion                                    │
│  • Checks for @agent trigger                                    │
│  • Extracts prompt text                                         │
│  • Starts loading animation                                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                      executePrompt()                             │
│  • Windows document context (±12k chars)                        │
│  • Sends to Anthropic/OpenAI API                                │
│  • Returns change regions or full file                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                        applyChanges()                            │
│  • Parses LLM output regions                                    │
│  • Locates each change by matching context                      │
│  • Calculates character offsets                                 │
│  • Applies edits to Yjs document                                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                   DocumentSync.applyEdit()                       │
│  • Inserts/deletes text in Yjs document                         │
│  • Triggers Yjs sync                                            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Open Collaboration Server                      │
│                    (broadcasts to all peers)                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                         User in VS Code                          │
│                   Sees AI-generated changes                      │
└─────────────────────────────────────────────────────────────────┘
```

## Sequence Diagram: Prompt Execution

```
User        Host Editor    OCT Server    Agent    DocumentSync    LLM API
 |               |              |          |            |            |
 |  Types        |              |          |            |            |
 |  @agent ...   |              |          |            |            |
 |  + Enter      |              |          |            |            |
 |               |              |          |            |            |
 |-------------->|              |          |            |            |
 |               |              |          |            |            |
 |               | Yjs Delta    |          |            |            |
 |               |------------->|          |            |            |
 |               |              |          |            |            |
 |               |              | Broadcast|            |            |
 |               |              |--------->|            |            |
 |               |              |          |            |            |
 |               |              |          | onDocumentChange()       |
 |               |              |          |----------->|            |
 |               |              |          |            |            |
 |               |              |          | Detect @agent trigger   |
 |               |              |          |<-----------|            |
 |               |              |          |            |            |
 |               |              |          | Start animation         |
 |               |              |          |----------->|            |
 |               |              |          |            |            |
 |               |              | Show |   |            |            |
 |               |<--------------------------|            |            |
 |               |              |          |            |            |
 |               |              |          | executePrompt()         |
 |               |              |          |-----------------------→|
 |               |              |          |            |            |
 |               |              |          |            |  LLM Response
 |               |              |          |<-----------------------|
 |               |              |          |            |            |
 |               |              |          | Stop animation          |
 |               |              |          |----------->|            |
 |               |              |          |            |            |
 |               |              |          | applyChanges()          |
 |               |              |          |----------->|            |
 |               |              |          |            |            |
 |               |              |          |  applyEdit()|            |
 |               |              |          |----------->|            |
 |               |              |          |            |            |
 |               |              |          |            | Yjs Delta  |
 |               |              |          |<-----------|            |
 |               |              |          |            |            |
 |               |              | Broadcast|            |            |
 |               |<--------------------------|            |            |
 |               |              |          |            |            |
 |  See changes  |              |          |            |            |
 |<--------------|              |          |            |            |
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                            main.ts                               │
│                   (CLI Entry Point - Commander)                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                           agent.ts                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              startCLIAgent()                              │  │
│  │  • Authentication                                         │  │
│  │  • Room joining                                           │  │
│  │  • Connection management                                  │  │
│  └──────────────────────┬────────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────▼─────────────────────────────────────┐ │
│  │              runAgent()                                    │ │
│  │  • Event loop                                             │ │
│  │  • Trigger detection                                      │ │
│  │  • Execution orchestration                                │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ↓                 ↓                 ↓
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  document-sync.ts│ │  prompt.ts   │ │  agent-util.ts   │
├──────────────────┤ ├──────────────┤ ├──────────────────┤
│ DocumentSync     │ │ executePrompt│ │ applyChanges     │
│ • Yjs setup      │ │ • Provider   │ │ • Locate changes │
│ • Host following │ │   selection  │ │ • Apply edits    │
│ • Change events  │ │ • Context    │ │ • Animation      │
│ • Edit apply     │ │   windowing  │ │                  │
└──────────────────┘ │ • LLM call   │ └──────────────────┘
                     │ • Parse      │
                     └──────────────┘
```

## State Machine: Agent Execution State

```
                 ┌──────────────────┐
                 │                  │
        ┌───────►│      IDLE        │◄──────┐
        │        │                  │       │
        │        └────────┬─────────┘       │
        │                 │                 │
        │                 │ @agent trigger  │
        │                 │ detected        │
        │                 │                 │
        │                 ↓                 │
        │        ┌──────────────────┐       │
        │        │                  │       │
        │        │   EXECUTING      │       │
        │        │                  │       │
        │        │  • Animation ON  │       │
        │        │  • LLM call      │       │
        │        │  • Apply changes │       │
        │        │                  │       │
        │        └────────┬─────────┘       │
        │                 │                 │
        │                 │ Complete        │
        │                 │                 │
        │                 └─────────────────┘
        │
        │  New @agent trigger during execution:
        │  • Set documentChanged = true
        │  • Stays in EXECUTING state
        │  • Does NOT start new execution
        └─────────────────────────────────────────
```

## Error Handling & Edge Cases

1. **Concurrent Prompts**: If user triggers agent while it's executing
   - Sets `documentChanged = true`
   - Current execution continues
   - No new execution starts
   - User must trigger again after completion

2. **Document Changes During Execution**:
   - Agent stores initial document content
   - If `documentChanged = true`, fetches fresh content before applying changes
   - Uses `documentSync.getActiveDocumentContent()`

3. **Large Files**:
   - Context windowing limits to 24k characters (±12k from prompt)
   - Cuts at line boundaries to avoid breaking syntax

4. **Authentication Failure**:
   - Prints login URL and waits indefinitely
   - User must complete browser authentication

5. **Connection Loss**:
   - `onDisconnect` handler exits process
   - No automatic reconnection (process must be restarted)

6. **Room Closed**:
   - `onClose` handler exits process gracefully

7. **Ambiguous Change Locations**:
   - `locateChangeInDocument()` uses longest prefix/suffix matching
   - Requires sufficient context from LLM
   - May fail silently if no match found (endLine < startLine)

## Dependencies

### Core Dependencies
- `open-collaboration-protocol`: Connection, peer, room management
- `open-collaboration-yjs`: Yjs provider for OCT protocol
- `yjs`: CRDT for document synchronization
- `y-protocols/awareness`: Peer awareness (cursor positions, active file)
- `ai`: Vercel AI SDK for unified LLM interface
- `@ai-sdk/anthropic`: Anthropic Claude provider
- `@ai-sdk/openai`: OpenAI GPT provider
- `commander`: CLI argument parsing
- `dotenv`: Environment variable loading

### Development Dependencies
- `nodemon`: Auto-restart on file changes
- `tsx`: TypeScript execution

## Configuration

### Environment Variables (.env)
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

### Supported Models
- **Anthropic**: Any model starting with `claude-` (e.g., `claude-3-5-sonnet-latest`)
- **OpenAI**: Models starting with `gpt-` or `o` (e.g., `gpt-4o`, `o1-preview`)

## Future Enhancements

Based on commented code and TODOs:

1. **Streaming Output** (lines 159-171 in agent.ts):
   - Character-by-character typing animation
   - Infrastructure exists but disabled
   - Would require careful handling of document state

2. **Better Concurrency Handling**:
   - Queue prompts instead of dropping them
   - Allow multiple agents in same room

3. **Multi-file Operations**:
   - Currently limited to active document
   - Could expand to workspace-wide changes

4. **Improved Error Recovery**:
   - Retry logic for API failures
   - Fallback models if primary fails

5. **Telemetry**:
   - Token usage tracking (partially implemented in streaming)
   - Performance metrics
   - User feedback collection

## Testing Notes

Manual testing workflow:
1. Start OCT server or use `api.open-collab.tools`
2. Create collaboration session in VS Code/Theia
3. Get room ID from session
4. Run `./bin/agent -r {room-id}`
5. Complete browser authentication
6. In editor, type `// @agent Write a factorial function` + Enter
7. Observe loading animation, then AI-generated code

Common issues:
- API keys not set in `.env`
- Room ID incorrect or expired
- Agent user not admitted to room (must approve in host editor)
- Network connectivity to OCT server
