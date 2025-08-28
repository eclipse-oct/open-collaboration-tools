# OpenCode as OCT Agent (ACP Bridge)

OpenCode can be used instead of Claude Code as the ACP agent. When you start the **oct-agent** with OpenCode as the ACP agent, the ACP bridge spawns the OpenCode process on startup and forwards all `@agent` triggers to it.

## Overview

- **ACP Bridge:** The oct-agent spawns an ACP-capable process (e.g. `opencode acp`) and communicates via JSON-RPC over stdio.
- **OpenCode ACP:** The command `opencode acp` starts OpenCode as an ACP subprocess; it uses the same protocol as Claude Code via `@zed-industries/claude-code-acp`.
- **Flow:** OCT session → oct-agent → ACP bridge spawns `opencode acp` → triggers and edits work as usual.

## Prerequisites

1. **OpenCode installed** (e.g. `curl -fsSL https://opencode.ai/install | bash` or `npm install -g opencode-ai`).
2. **Anthropic (Claude) configured** in OpenCode (e.g. `/connect` in the OpenCode TUI or API key in `~/.config/opencode/opencode.json`).
3. **Model (optional):** Claude Sonnet 4.5 via `"model": "anthropic/claude-sonnet-4-5"` in the OpenCode config.

## 1. Install OpenCode

```bash
# Option A: Install script
curl -fsSL https://opencode.ai/install | bash

# Option B: npm
npm install -g opencode-ai

# Option C: Homebrew (macOS)
brew install anomalyco/tap/opencode
```

Verify: `opencode --version`

## 2. Configure OpenCode (Claude Sonnet 4.5)

- **API key:** Run `opencode` in the TUI, then `/connect` → Anthropic → enter API key (or “Create an API Key” / Claude Pro/Max).
- **Model:** In `~/.config/opencode/opencode.json` or per-project in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5"
}
```

See [OpenCode Docs – Config](https://opencode.ai/docs/config) and [Providers (Anthropic)](https://opencode.ai/docs/providers#anthropic).

## 3. Start oct-agent with OpenCode

The oct-agent spawns the ACP agent via the **`--acp-agent`** option. The default is `npx @zed-industries/claude-code-acp`. To use OpenCode:

```bash
cd /path/to/your/workspace
node /path/to/oct/packages/open-collaboration-agent/bin/agent -r <room-id> --acp-agent "opencode acp"
```

**From a built project:**

```bash
cd /path/to/open-collaboration-tools
npm run build --workspace=open-collaboration-agent
node packages/open-collaboration-agent/bin/agent.js -r <room-id> --acp-agent "opencode acp"
```

**Via the VSCode extension:**  
If the extension starts the agent, the command line used must override the ACP agent. Once the extension supports an option for the ACP agent command, set it to `opencode acp`. Otherwise start the agent manually as above.

## 4. Flow (ACP Bridge)

1. You start the oct-agent with `--acp-agent "opencode acp"`.
2. The ACP bridge spawns the command `opencode acp` as a child process (stdio).
3. The bridge performs ACP initialization and session creation.
4. When an `@agent` trigger is detected in the document, the bridge sends an ACP trigger to OpenCode.
5. OpenCode runs in the local workspace (process.cwd() = workspace root).
6. Tool calls (e.g. read/write file) go over ACP; the bridge applies write operations via OCT DocumentSync.
7. All participants in the OCT session see the changes in real time.

## 5. Usage in the OCT Room

- **Trigger:** A line starting with `@agent` (or your chosen agent name) followed by your prompt, then Enter.
- **Example:** `// @agent Refactor this function to use async/await`
- Behaviour is the same as with Claude Code: same triggers, same sync logic; only the LLM and tools are provided by OpenCode.

## 6. Notes

- **Workspace:** The oct-agent must run in the **workspace directory** (as described in the README). OpenCode inherits the same `cwd()` for file access.
- **Slash commands:** Via ACP, OpenCode does not support all slash commands (e.g. `/undo`, `/redo`); see [OpenCode ACP Support](https://opencode.ai/docs/acp/).
- **Troubleshooting:** If the agent does not start, check in the console that `opencode acp` is on your PATH and that the OpenCode config and API key are correct.

## References

- [OpenCode – Intro & Install](https://opencode.ai/docs/)
- [OpenCode – Config & Models](https://opencode.ai/docs/config)
- [OpenCode – ACP Support](https://opencode.ai/docs/acp/)
- [OpenCode – Providers (Anthropic)](https://opencode.ai/docs/providers#anthropic)
- **OCT Agent:** `README.md`, `ACP_CONCEPT.md`, `ARCHITECTURE.md`
