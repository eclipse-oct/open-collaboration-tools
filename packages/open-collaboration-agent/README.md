# Open Collaboration Agent

An AI agent for Open Collaboration Tools (OCT) sessions that runs in your local workspace and proposes changes to the collaborative session for review.

## Setup

1. Build the project:

    ```bash
    npm run build
    ```

2. Configure your ACP agent: The oct-agent connects to an external ACP-capable agent (e.g. Claude Code via `npx @zed-industries/claude-code-acp`). API keys and model selection are configured in that ACP agent’s environment, not in the oct-agent package.

3. Create a collaboration session in your IDE and copy the room ID.

## Development Usage

The agent runs from your **local workspace** where you have your project files. This allows the agent to access your full project context.

## Starting the Agent

### Option 1: From VSCode Extension (Recommended)

If you're using VSCode with the Open Collaboration Tools extension:

1. Open your project workspace in VSCode
2. Create or join an OCT room
3. Command Palette (Cmd+Shift+P) → "Open Collaboration Tools: Start Agent"
4. The agent starts automatically in a terminal with correct configuration

This is the easiest way to start the agent as it:
- Automatically uses the correct room ID and server URL
- Starts the agent in your workspace directory
- Handles development vs production environments

### Option 2: Manual CLI Execution

**From your project workspace:**

```bash
cd /path/to/your/project
node /path/to/oct-project/packages/open-collaboration-agent/bin/agent -r {room-id}
```

**Options:**

-   `-r, --room <string>`: Room ID to join (required)
-   `-s, --server <string>`: OCT server URL (default: `https://api.open-collab.tools/`)
-   `--acp-agent <command>`: Command to run the ACP agent (default: `npx @zed-industries/claude-code-acp`). Use this to connect any ACP-capable agent.
-   `--config <path>`: Path to an `oct-agent.config.json` file (see [Configuration](#configuration) below). Defaults to `./oct-agent.config.json` in the current working directory.

### Example

```bash
cd ~/my-project
node ~/oct-tools/packages/open-collaboration-agent/bin/agent -r my-room-id
```

## Configuration

The agent reads an optional `oct-agent.config.json` file from the working directory (or from a custom path via `--config`). The file is **fully optional** — if it is missing, the agent falls back to conservative built-in defaults. Configuration is intentionally **agent-agnostic**: the same file works with any ACP-capable adapter (Claude Code, Gemini CLI, Codex-ACP, …). Adapter-specific markdown files such as `CLAUDE.md` or `GEMINI.md` are **not** part of the OCT agent contract.

### Full example

```json
{
    "toolWhitelist": {
        "allowedKinds": ["read", "edit"],
        "allowedToolNames": ["mcp__acp__Read", "mcp__acp__Edit", "mcp__acp__Write"]
    },
    "systemPrompt": [
        "You are operating inside a collaborative OCT session.",
        "All file changes are delivered to other participants as reviewable diff proposals, not persisted directly.",
        "When a request affects multiple code locations or multiple files, apply all relevant edits in a single run."
    ]
}
```

### `toolWhitelist`

Controls which ACP tool calls the bridge is allowed to approve when the agent requests permission. A tool call is allowed if **either** its declared ACP `kind` is in `allowedKinds`, **or** its tool name (as reported by the adapter) is in `allowedToolNames`. Anything else is denied.

| Field              | Type       | Default                                                          | Description                                                                                                                  |
| ------------------ | ---------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `allowedKinds`     | `string[]` | `["read", "edit"]`                                               | ACP-standard tool kinds. Common values: `read`, `edit`, `delete`, `move`, `search`, `execute`.                               |
| `allowedToolNames` | `string[]` | `["mcp__acp__Read", "mcp__acp__Edit", "mcp__acp__Write"]`        | Adapter-specific tool names used as a fallback when an adapter does not set a standard `kind`. Override per adapter if used. |

Enabling additional capabilities (for example workspace search via Glob/Grep, or shell execution) is **opt-in**:

```json
{
    "toolWhitelist": {
        "allowedKinds": ["read", "edit", "search"]
    }
}
```

### `systemPrompt`

An optional instruction string (or array of strings) that is prepended to every prompt sent to the ACP agent as a standard ACP `text` content block — **before** the user prompt and any `resource_link` blocks. Because it travels through the regular ACP protocol, every adapter receives the same instructions.

-   **Type:** `string | string[]`
-   **Default:** unset (no system prompt is sent)
-   When an array is provided, entries are joined with newlines, so you can keep one instruction per line in the config.
-   Empty strings, whitespace-only values, and non-string array entries are ignored.

Example use cases:

-   Tell the agent that it is operating inside a collaborative review session and that edits are surfaced as diff proposals.
-   Encourage the agent to perform multi-file or multi-location edits in a single run when the request warrants it.
-   Constrain output style (e.g. "respond in English", "do not add code comments").

```json
{
    "systemPrompt": [
        "You are operating inside a collaborative OCT session.",
        "All file changes are delivered to other participants as reviewable diff proposals."
    ]
}
```

## Workspace Context (IMPORTANT)

The agent MUST run in the workspace directory because:

-   **Reads files from local filesystem**: Uses `fs.readFileSync(absolutePath, 'utf8')`
-   **No remote file streaming**: Files are NOT sent over the network
-   **`process.cwd()` is workspace root**: All relative paths resolve from workspace
-   **File writes sync via OCT**: Changes are synchronized to the session (Yjs CRDT)

### Deployment Scenarios

**✅ Supported: Local Agent**
- Agent runs on same machine as workspace
- Has direct filesystem access
- Typical for personal development or single-developer workflows

**❌ Not Supported: Remote Agent**
- Agent runs on different machine than workspace
- Cannot access workspace files directly
- See `REMOTE_AGENT_CHALLENGES.md` for details

### How It Works

-   The agent has access to all files in your local project directory
-   File reads come from your local filesystem
-   File writes are proposed via the OCT session as reviewable diffs (visible to all participants)
-   Changes are not applied automatically – participants accept or reject them in their editor

## Using the Agent

1. **Authentication:**

    - Open the login URL shown in the terminal
    - Use simple login (choose a username like `agent`)
    - In your host workspace, allow the agent user to enter the session

2. **Triggering the Agent:**

    Write a line starting with `@agent` (or whatever username you chose) followed by your prompt:

    ```typescript
    // @agent Write a factorial function
    ```

3. **Execute the Prompt:**

    Press Enter at the end of the line and wait for the agent to respond... ✨

4. **Collaboration:**

    - The agent proposes file changes as diffs in the OCT session
    - Participants review the proposed changes and accept or reject them in their editor
    - When the agent only replies with text (no file changes), the response is delivered through the chat without an extra confirmation message

## How It Works

```
Local Workspace → oct-agent (process.cwd())
                    ↓
                ACP Agent (e.g. Claude Code)
                    ↓
                Local File Operations
                    ↓
                OCT Session: Proposed Diffs
                    ↓
                Participants Review & Accept Changes
```

## ACP

The agent connects to an external ACP-capable agent (Agent Client Protocol), such as Claude Code via `npx @zed-industries/claude-code-acp`. You can use any ACP adapter by overriding `--acp-agent`. The ACP agent has access to your full local workspace while synchronizing changes back to the OCT session.
