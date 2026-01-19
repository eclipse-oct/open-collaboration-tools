# Open Collaboration Agent

An AI agent for Open Collaboration Tools (OCT) sessions that runs in your local workspace and synchronizes changes with the collaborative session.

## Setup

1. Build the project:

    ```bash
    npm run build
    ```

2. Create a `.env` file in `packages/open-collaboration-agent` with your API keys:

    ```
    ANTHROPIC_API_KEY=your_key_here
    OPENAI_API_KEY=your_key_here
    ```

    The `.env` file is auto-loaded by the CLI.

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
-   `-m, --model <string>`: LLM model to use (default: `claude-3-5-sonnet-latest`)
-   `--mode <embedded|acp>`: Agent mode (default: `embedded`)
    -   `embedded`: Direct LLM integration
    -   `acp`: Use external agent via Agent Client Protocol (e.g., Claude Code)
-   `--acp-agent <command>`: Command for ACP agent (default: `npx @zed-industries/claude-code-acp`)

### Example: Embedded Mode

```bash
cd ~/my-project
node ~/oct-tools/packages/open-collaboration-agent/bin/agent -r my-room-id -m gpt-4o
```

### Example: ACP Mode with Claude Code

```bash
cd ~/my-project
node ~/oct-tools/packages/open-collaboration-agent/bin/agent -r my-room-id --mode acp
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
-   File writes are synchronized to the OCT session (visible to all participants)
-   Your cursor position is visible to other session participants
-   Changes made by the agent appear in real-time to all collaborators

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

    - The agent's cursor is visible to all participants
    - Changes are synchronized in real-time
    - Other participants can see the agent's edits as they happen

## How It Works

```
Local Workspace → Agent (process.cwd())
                    ↓
                ACP Agent (if using ACP mode)
                    ↓
                Local File Operations
                    ↓
                OCT Session Sync
                    ↓
                All Participants See Changes
```

## Modes

### Embedded Mode (Default)

Direct integration with LLM APIs (Anthropic, OpenAI). Best for:

-   Simple tasks
-   Quick prototyping
-   Direct control over model selection

### ACP Mode

Connects to external agents via Agent Client Protocol. Best for:

-   Using specialized agents (Claude Code, etc.)
-   Advanced tooling support
-   Custom agent implementations

The ACP agent has access to your full local workspace while synchronizing changes back to the OCT session.
