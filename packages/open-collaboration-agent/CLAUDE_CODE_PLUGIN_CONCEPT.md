# Claude Code Plugin: OCT Collaboration Agent Integration

## Overview

This plugin enables Claude Code to join Open Collaboration Tools (OCT) sessions as a peer using a **dual-mode architecture**: a built-in CLI agent with hardwired workflow for efficiency, and an MCP (Model Context Protocol) server that exposes OCT functionality to external AI agents like Claude Code. The aim is to enable collaborative, AI-powered code assistance in real-time developer sessions.

## Architecture

### Dual-Mode Approach

The implementation supports **two execution modes** sharing the same core functionality:

#### Mode 1: Built-in CLI Agent (Hardwired)

**Location:** `packages/open-collaboration-agent/src/agent.ts`

-   **Purpose:** Standalone agent optimized for direct CLI usage
-   **Execution:** Hardwired workflow - no tool calls, direct LLM → edits pipeline
-   **Efficiency:** Faster execution, fewer tokens, no tool call overhead
-   **Usage:** `oct-agent --room <room-id> --model <model>`
-   **Workflow:**
    1. Detect `@agent` trigger in document
    2. Call LLM with `executeLLM()` → returns `LineEdit[]` directly (JSON response)
    3. Apply edits via `DocumentSyncOperations`
    4. Remove trigger line
    5. Update cursor position

#### Mode 2: MCP Server for External Agents (Dynamic)

**Location:** `packages/open-collaboration-agent/src/mcp-server.ts`

-   **Purpose:** Bridge for MCP-compatible AI clients (Claude Code, Cursor, etc.)
-   **Execution:** Dynamic tool calls - AI agent decides when to call which tools
-   **Flexibility:** Standard MCP protocol, works with any compatible client
-   **Usage:** Start server via `.claude/settings.json`, connect via `/connect-to-oct <room-id>`
-   **Trigger Detection:** MCP server monitors document changes via `DocumentSync` and exposes triggers as MCP resources
-   **Workflow:**
    1. AI client connects via `oct_connect` tool
    2. **MCP server detects `@agent` trigger** via `setupMCPTriggerDetection()` using `DocumentSync`
    3. **MCP server starts loading animation** and sends resource update notification
    4. **AI client receives notification** about new trigger via `oct://triggers/current` resource
    5. AI client calls `oct_trigger_start_processing` to stop the animation
    6. AI client reads context via `oct_get_document_range`
    7. AI client applies edits via `oct_apply_edit`
    8. AI client calls `oct_trigger_complete` to mark trigger as done
    9. AI client removes trigger via `oct_remove_trigger_line`

#### Shared Core: Document Operations Layer

**Location:** `packages/open-collaboration-agent/src/document-operations.ts`

Both modes use the same underlying functionality:

```typescript
interface DocumentOperations {
    getDocument(path: string): string | undefined;
    getDocumentRange(
        path: string,
        startLine: number,
        endLine: number
    ): string[];
    applyEdit(path: string, edit: LineEdit): void;
    applyEditsAnimated(path: string, edits: LineEdit[]): Promise<void>;
    removeTriggerLine(path: string, trigger: string): void;
    updateCursor(path: string, offset: number): void;
    getSessionInfo(): SessionInfo;
}

class DocumentSyncOperations implements DocumentOperations {
    // Backed by DocumentSync (Yjs CRDT)
}
```

**Benefits:**

-   Built-in agent: Direct, efficient execution
-   MCP server: Flexible, AI-agnostic, standard protocol
-   Shared code: Single source of truth for OCT operations

### Communication Flow (MCP Mode)

```
1. User runs: /connect-to-oct <room-id>
         ↓
2. Claude Code calls oct_connect MCP tool
         ↓
3. MCP server initiates authentication
         ↓
4. **CRITICAL**: Server returns login URL to Claude Code
         ↓
5. Claude Code displays login URL to user
   "Please open this URL in your browser to authenticate:
    https://api.open-collab.tools/login?token=..."
         ↓
6. User opens URL in browser and completes authentication
         ↓
7. MCP server completes connection and joins OCT room as peer
         ↓
8. MCP server sets up trigger detection via setupMCPTriggerDetection()
   - Registers DocumentSync.onDocumentChange() handler
   - Monitors for @agent triggers in document changes
         ↓
9. Developer writes "@agent add error handling" in code
         ↓
10. OCT Document Sync (Yjs CRDT) detects change
         ↓
11. MCP server's documentChangeHandler detects trigger:
   - Starts loading animation (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ spinner)
   - Creates TriggerEvent and adds to pendingTriggers queue
   - Sends notifications/resources/updated notification for oct://triggers/current
         ↓
12. Claude Code receives notification automatically
         ↓
13. Claude Code (oct-collab-agent) immediately reads oct://triggers/current resource
         ↓
14. Claude Code automatically calls oct_trigger_start_processing to stop animation
         ↓
15. Claude Code uses MCP tools to process trigger automatically:
   - Read document context (oct_get_document_range)
   - Apply code edits (oct_apply_edit)
   - Mark trigger complete (oct_trigger_complete)
   - Remove trigger line (oct_remove_trigger_line)
         ↓
16. Changes sync via Yjs to all session participants
```

### Communication Flow (Built-in CLI Agent)

```
1. User runs: oct-agent --room <room-id>
         ↓
2. Agent authenticates (browser login)
         ↓
3. Agent joins OCT room as peer
         ↓
4. Developer writes "@agent add error handling" in code
         ↓
5. DocumentSync detects trigger
         ↓
6. Agent calls executeLLM() → receives LineEdit[] JSON
         ↓
7. Agent applies edits via DocumentSyncOperations
         ↓
8. Agent removes trigger line
         ↓
9. Changes sync via Yjs to all session participants
```

## Current Implementation

### Trigger Mechanism: In-Document @agent Mentions

**Current State:** OCT does not yet have chat functionality. Instead, the agent uses an in-document trigger system:

1. Developer writes `@agent <prompt>` in any document (usually in a comment)
2. When the line is completed (newline inserted), the agent detects the trigger
3. Agent extracts the prompt and executes the requested task
4. After completion, the trigger line is automatically removed

**Example:**

```javascript
// @agent Add input validation for email addresses
function registerUser(email, password) {
    // ... existing code
}
```

**Note:** Chat-based triggering will be added in a future version when the OCT protocol includes chat support (see `CHAT_CONCEPT.md`).

## Key Features & Workflow

1. **Setup & Connection (MCP Mode with Claude Code)**

    - MCP server automatically starts when Claude Code launches
    - User runs `/connect-to-oct <room-id>` slash command
    - Claude Code calls `oct_connect` tool dynamically
    - Server authenticates (browser login) and joins OCT session as peer
    - Agent identity is registered (e.g., "my-agent")
    - Trigger pattern becomes `@my-agent`

    **Setup & Connection (Built-in CLI Agent)**

    - User runs `oct-agent --room <room-id> --model <model>`
    - Agent authenticates (browser login) and joins directly
    - Hardwired workflow begins monitoring for triggers

2. **Real-time Code Editing**

    - Developers write `@agent` followed by task description in code
    - **MCP server automatically detects trigger** via `DocumentSync.onDocumentChange()`
    - **Loading animation starts immediately** (rotating spinner at trigger position)
    - **MCP client receives notification** and automatically processes it
    - **Agent automatically calls `oct_trigger_start_processing`** to stop animation
    - **Agent automatically reads document context** via `oct_get_document_range`
    - **Agent automatically applies precise line-based edits** via `oct_apply_edit`
    - Changes appear instantly for all session participants via Yjs CRDT
    - Agent marks changes with comment markers (e.g., `// AI: description`)
    - **Agent automatically calls `oct_trigger_complete`** to mark trigger as done
    - **Trigger line is automatically removed** via `oct_remove_trigger_line`
    - **No user intervention required** - the entire process is automatic

3. **Collaborative Features**

    - **Peer Visibility**: Agent appears as a collaborator in the session
    - **Cursor Tracking**: Agent's cursor position is visible during edits
    - **Real-time Sync**: All changes use Yjs CRDT for conflict-free merging
    - **Multi-participant**: Multiple developers and the agent work simultaneously
    - **Host Control**: Session host can manage agent permissions

4. **Security & Permissions**
    - Browser-based authentication required to join sessions
    - End-to-end encryption via OCT protocol
    - Agent has same permissions as other session peers
    - Host can remove agent peer at any time
    - All actions are logged and auditable

## Technical Components

| Component               | Description                                              | Location                             |
| ----------------------- | -------------------------------------------------------- | ------------------------------------ |
| **Built-in CLI Agent**  | Standalone agent with hardwired workflow                 | `src/agent.ts`                       |
| **MCP Server**          | Bridges external AI clients to OCT via stdio transport   | `src/mcp-server.ts`                  |
| **MCP Tools**           | Tool implementations (oct_connect, oct_apply_edit, etc.) | `src/mcp-tools.ts`                   |
| **MCP Resources**       | Resource providers (session info, documents)             | `src/mcp-resources.ts`               |
| **Document Operations** | Shared abstraction layer for both modes                  | `src/document-operations.ts`         |
| **Document Sync**       | Real-time document synchronization using Yjs CRDT        | `src/document-sync.ts`               |
| **LLM Execution**       | Direct LLM call (built-in) and tool-based (MCP)          | `src/prompt.ts`                      |
| **Agent Utilities**     | Cursor tracking, animated edits, loading indicators      | `src/agent-util.ts`                  |
| **Slash Command**       | `/connect-to-oct` command for Claude Code                | `.claude/commands/connect-to-oct.md` |
| **Subagent Config**     | Claude Code subagent configuration                       | `.claude/agents/oct-collab-agent.md` |
| **Settings**            | MCP server registration (no room ID!)                    | `.claude/settings.json`              |

## MCP Tools

The MCP server exposes these tools to Claude Code and other MCP-compatible clients:

### Connection Management

-   **`oct_connect`**: Connect to an OCT room (roomId, optional serverUrl)
-   **`oct_disconnect`**: Disconnect from the current OCT session
-   **`oct_get_connection_status`**: Check if connected and get session info

### Document Operations

-   **`oct_get_document`**: Read full document with line numbers (1-indexed)
-   **`oct_get_document_range`**: Get specific line ranges (startLine, endLine)
-   **`oct_apply_edit`**: Apply line-based edit (type, startLine, endLine, content)
-   **`oct_remove_trigger_line`**: Remove the @agent trigger after completion

### Trigger Management

-   **`oct_trigger_start_processing`**: Stop the loading animation for a trigger and mark it as being processed
-   **`oct_trigger_complete`**: Mark a trigger as completed and remove it from pending triggers

### Session Information

-   **`oct_get_session_info`**: Get session metadata (room ID, agent name, host)

## MCP Resources

Resources provide read-only access to OCT session data:

-   **`oct://session/info`**: Session metadata (connection status, room ID, agent name)
-   **`oct://documents/{path}`**: Document content by path
-   **`oct://triggers/current`**: Most recent @agent trigger detected (includes docPath, docContent, prompt, offset)
-   **`oct://triggers/pending`**: All pending @agent triggers waiting to be processed

**Resource Update Notifications:** When a trigger is detected, the MCP server sends a `notifications/resources/updated` notification with the `oct://triggers/current` URI, alerting connected clients about new triggers.

## Example Workflows

### Code Editing Workflow

```typescript
// Developer writes in VS Code:
// @agent Convert this to use async/await
function fetchUser(id) {
    return fetch(`/api/users/${id}`)
        .then((res) => res.json())
        .then((data) => data.user);
}

// MCP Server (automatic):
// 1. Detects trigger via DocumentSync.onDocumentChange
// 2. Starts loading animation: ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
// 3. Sends resource update notification for oct://triggers/current

// Claude Code agent (automatically triggered by notification):
// 1. Automatically reads oct://triggers/current resource
// 2. Calls oct_trigger_start_processing to stop animation
// 3. Reads document context via oct_get_document_range
// 4. Applies changes via oct_apply_edit:
// AI: Converted to async/await pattern
async function fetchUser(id) {
    const res = await fetch(`/api/users/${id}`);
    const data = await res.json();
    return data.user;
}
// 5. Calls oct_trigger_complete
// 6. Removes trigger line via oct_remove_trigger_line
```

### Error Handling Addition

```python
# @agent Add try-except error handling
def process_data(filename):
    data = json.load(open(filename))
    return data['results']

# Becomes:
# AI: Added error handling for file operations and JSON parsing
def process_data(filename):
    try:
        with open(filename, 'r') as f:
            data = json.load(f)
            return data['results']
    except FileNotFoundError:
        print(f"Error: File {filename} not found")
        return None
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in {filename}")
        return None
```

## Installation & Setup

### Prerequisites

-   Node.js >= 20.10.0
-   Claude Code installed (for MCP mode) or command line (for built-in agent)
-   Active OCT collaboration session

### Setup for MCP Mode (Claude Code)

1. **Build the agent package**

    ```bash
    cd packages/open-collaboration-agent
    npm install
    npm run build
    ```

2. **Configure Claude Code**

    The `.claude/settings.json` file is already configured:

    ```json
    {
        "mcpServers": {
            "oct-collaboration": {
                "command": "node",
                "args": ["./packages/open-collaboration-agent/bin/mcp-server"],
                "env": {
                    "OCT_SERVER_URL": "https://api.open-collab.tools/"
                }
            }
        }
    }
    ```

    **Note:** No `OCT_ROOM_ID` in config - connection is dynamic!

3. **Start Claude Code**

    The MCP server will automatically start when Claude Code launches.

4. **Connect to an OCT session**

    Run the slash command:

    ```
    /connect-to-oct <your-room-id>
    ```

    Claude Code will:

    - Call `oct_connect` tool with the room ID
    - Display authentication URL if needed
    - Confirm successful connection

### Setup for Built-in CLI Agent

1. **Build the agent package**

    ```bash
    cd packages/open-collaboration-agent
    npm install
    npm run build
    ```

2. **Run the agent**

    ```bash
    oct-agent --room <room-id> --model claude-3-5-sonnet-latest
    ```

    The agent will:

    - Prompt for browser authentication
    - Join the room as a peer
    - Monitor for `@agent` triggers

### Authentication

**CRITICAL WORKFLOW STEP**: Authentication is required for both modes and follows this pattern:

#### MCP Mode (Claude Code)

1. When you run `/connect-to-oct <room-id>`, the MCP tool will initiate authentication
2. **The tool will return a `loginUrl` in the response** - this is NOT an error!
3. Claude Code MUST display this URL prominently to the user:

    ```
    🔐 Authentication Required

    Please open this URL in your browser to log in:
    https://api.open-collab.tools/login?token=...

    The connection will complete automatically once you authenticate.
    ```

4. The tool call remains active and waits for browser authentication
5. Once the user authenticates in their browser, the connection completes successfully

#### Built-in CLI Agent

1. When you run `oct-agent --room <room-id>`, the agent prints a login URL to stderr:
    ```
    Please open the following URL in your browser to log in:
    https://api.open-collab.tools/login?token=...
    ```
2. Open this URL in your browser and complete authentication
3. The agent automatically continues once authentication is complete

**Important**: The login URL is a required part of the connection flow, not an error condition. Both the user and Claude Code must understand this is expected behavior.

## Future Enhancements

### Chat-based Triggering (Planned)

When OCT adds chat functionality (see `CHAT_CONCEPT.md`):

-   **Direct Messages**: Send prompts directly to agent peer
-   **Group Chat @-mentions**: `@agent` in group chat for transparent collaboration
-   **Conversational Context**: Multi-turn conversations with the agent
-   **Status Updates**: Agent announces when starting/completing work
-   **Clarification Questions**: Agent can ask for more details

### Additional Features (Planned)

-   **Code Review Mode**: Agent reviews pull requests and suggests improvements
-   **Documentation Generation**: Auto-generate docstrings and README updates
-   **Refactoring Assistant**: Large-scale code refactoring across multiple files
-   **Test Generation**: Create unit tests for existing functions
-   **Meeting Notes**: Transcribe and summarize collaboration sessions

## Reusability

The MCP server (integrated in this package) is **AI-agnostic** and can be used with any MCP-compatible client:

-   **Claude Code** (primary target)
-   **Cursor** (with MCP support)
-   **Windsurf** (with MCP support)
-   **Cline** (with MCP support)
-   Any custom MCP client using stdio transport

## Package Structure

```
packages/open-collaboration-agent/
├── src/
│   ├── agent.ts              # Built-in CLI agent (hardwired)
│   ├── mcp-server.ts         # MCP server for external clients
│   ├── mcp-tools.ts          # MCP tool implementations
│   ├── mcp-resources.ts      # MCP resource providers
│   ├── document-operations.ts # Shared abstraction layer
│   ├── document-sync.ts      # Yjs document sync
│   ├── prompt.ts             # LLM execution (both modes)
│   ├── agent-util.ts         # Cursor tracking, animations
│   └── main.ts               # CLI entry point
├── bin/
│   ├── agent                 # oct-agent CLI
│   └── mcp-server            # oct-mcp-server CLI
└── package.json              # Both binaries exported
```

## Documentation

-   **This Document**: Complete architecture and setup guide
-   **Chat Concept**: `CHAT_CONCEPT.md` - Future chat-based triggering
-   **Code Analysis**: `CODE_ANALYSIS.md` - Implementation details
-   **Main OCT Documentation**: https://www.open-collab.tools/

## Conclusion

This dual-mode architecture provides the best of both worlds:

**Built-in CLI Agent:**

-   Optimized for direct usage with hardwired workflow
-   Faster execution without tool call overhead
-   Simpler prompt engineering (direct JSON response)
-   Ideal for dedicated agent deployments

**MCP Server:**

-   Standard protocol for AI-agnostic integration
-   Works with Claude Code, Cursor, and other MCP clients
-   Dynamic tool discovery and flexible workflows
-   Ideal for developer-driven collaborative sessions

Both modes share the same `DocumentOperations` core, ensuring consistent behavior and maintainability. The `/connect-to-oct` slash command makes it natural to join sessions on-demand without hardcoded configuration. The in-document `@agent` trigger system works today, with chat-based triggering planned for future releases when the OCT protocol adds chat support.
