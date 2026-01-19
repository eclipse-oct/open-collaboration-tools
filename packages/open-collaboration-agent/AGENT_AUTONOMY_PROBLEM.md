# Agent Autonomy Problem

**Date:** 2025-10-21
**Status:** ⚠️ HISTORICAL - Problem gelöst durch ACP Bridge Architektur
**Nachfolger:** Siehe [ARCHITECTURE.md](ARCHITECTURE.md) und [ACP_CONCEPT.md](ACP_CONCEPT.md)

> **Historischer Kontext:** Dieses Dokument beschreibt ein architektonisches Problem
> bei der Integration des OCT Agenten mit Claude Code über MCP (Model Context Protocol).
> Das Problem führte zur ACP-Bridge-Lösung. Der Agent läuft heute ausschließlich über
> ACP (Embedded-Modus wurde entfernt). Die hier beschriebenen Limitierungen gelten
> für die **MCP-basierte Integration nicht mehr**.

## Problem Statement

The OCT collaboration agent can successfully process the **first** `@agent` trigger, but cannot autonomously handle **subsequent** triggers without manual intervention. After processing one trigger, the agent terminates and no longer monitors for new triggers.

### What Works ✅

1. **First Trigger Processing**:
   - Trigger is detected by MCP server
   - Fallback approach is used (sampling not supported)
   - Trigger is queued in `serverState.pendingTriggers` and `serverState.currentTrigger`
   - Background agent processes the trigger successfully
   - All edits are applied correctly

2. **Tool Pre-approval**:
   - All OCT MCP tools are pre-approved and don't require user authentication
   - Tools like `oct_wait_for_trigger`, `oct_trigger_start_processing`, etc. work without approval prompts

3. **Trigger Queueing**:
   - `processTriggerViaFallback()` (mcp-server.ts:142-175) correctly queues triggers
   - `oct_wait_for_trigger()` (mcp-tools.ts:546-555) checks for existing triggers before waiting

### What Doesn't Work ❌

**Subsequent triggers are not processed automatically.**

The flow breaks down like this:

```
Trigger 1 arrives → Background agent launched → Processes trigger → Agent Task completes and exits
                                                                      ↓
Trigger 2 arrives → Queued in pendingTriggers → [No agent running to dequeue it] → ❌ Stuck
```

### Observed Behavior

From the logs:
```
[ERROR] MCP server "oct-collaboration" Server stderr: [MCP] Attempting sampling approach for trigger
[ERROR] MCP server "oct-collaboration" Server stderr: [MCP] Sampling not supported by client
[ERROR] MCP server "oct-collaboration" Server stderr: [MCP] Using fallback approach (notification + blocking wait)
```

After this:
- `processTriggerViaFallback` is called ✅
- Trigger is queued in `pendingTriggers` and `currentTrigger` ✅
- `triggerWaiters` array exists but is empty (no agent waiting) ⚠️
- MCP notification is sent ✅
- **BUT**: No agent is running to receive it or call `oct_wait_for_trigger()` ❌

## Root Cause Analysis

### The Core Issue: Task Agent Lifecycle

The problem is **architectural**, not a bug in the implementation:

1. **Task Agents Are Not Persistent**
   - The `/connect-to-oct` command launches the agent using the Task tool
   - Task agents are designed for **one-off tasks**, not continuous monitoring
   - After completing their work, Task agents **terminate automatically**
   - There's no built-in mechanism for "persistent background agents" in Claude Code

2. **Agent Termination After First Trigger**
   ```
   /connect-to-oct → Launches background agent Task
                     ↓
   Agent calls oct_wait_for_trigger() → Blocks (waiting)
                     ↓
   Trigger arrives → Returned to agent
                     ↓
   Agent processes trigger → oct_apply_edit, oct_trigger_complete, etc.
                     ↓
   Agent Task completes → ❌ AGENT EXITS
                     ↓
   [No agent running] → Next trigger has nobody to process it
   ```

3. **No Re-invocation Mechanism**
   - The agent prompt (`.claude/commands/connect-to-oct.md:37`) says: "Continuously call oct_wait_for_trigger()... then loop back to oct_wait_for_trigger()"
   - However, Task agents don't naturally loop - they complete and exit
   - There's no way for the MCP server to re-launch the agent when new triggers arrive
   - MCP notifications are passive - they don't trigger agent invocation

### Why Timing Isn't The Issue

Initially, it seemed like a timing problem (trigger arrives before agent starts waiting). However, the code already handles this:

- **mcp-tools.ts:546-555**: `oct_wait_for_trigger` checks `currentTrigger` first
- If a trigger is already queued, it returns immediately without waiting
- So even if the agent starts after the trigger arrives, it should still pick it up

**BUT**: This only works if an agent is running. If no agent calls `oct_wait_for_trigger()`, the queued triggers just sit there.

### Why Authentication Isn't The Issue

The user mentioned: "To add triggerWaiters I need to verify that you as an Agent are authenticated."

However, looking at the pre-approved tools list, all OCT tools are already pre-approved:
- `mcp__oct-collaboration__oct_get_connection_status`
- `mcp__oct-collaboration__oct_trigger_start_processing`
- `mcp__oct-collaboration__oct_get_document`
- `mcp__oct-collaboration__oct_apply_edit`
- `mcp__oct-collaboration__oct_trigger_complete`
- `mcp__oct-collaboration__oct_remove_trigger_line`
- `mcp__oct-collaboration__oct_wait_for_trigger`

So authentication/approval is not blocking autonomous operation.

## The Three Interconnected Issues

### 1. **Agent Lifecycle Problem** (Primary Issue)
- Task agents terminate after completion
- No persistent background agent capability in Claude Code
- Agent can't "loop back" to wait for the next trigger

### 2. **Trigger Queueing Works But Isn't Consumed**
- Triggers are correctly queued in `pendingTriggers` and `currentTrigger`
- `oct_wait_for_trigger` would correctly dequeue them
- **BUT**: No agent is running to call `oct_wait_for_trigger()`

### 3. **MCP Notifications Are Passive**
- MCP server sends `notifications/resources/updated` correctly
- Claude Code receives the notification at protocol level
- **BUT**: Notifications don't automatically invoke agents
- Notifications are informational, not imperative

## Why Current Solutions Don't Work

### Solution A (Blocking Wait) - Partial Success
- **Implemented**: ✅ Yes
- **Status**: Works for first trigger only
- **Problem**: Agent terminates after processing first trigger
- **Result**: Subsequent triggers are queued but never processed

### Solution B (Sampling) - Not Supported Yet
- **Implemented**: ✅ Yes (with auto-detection)
- **Status**: Claude Code doesn't support server-initiated sampling
- **Problem**: Falls back to Solution A, which has the agent lifecycle issue
- **Result**: Same problem as Solution A

### Solution C (Hybrid) - Currently Deployed
- **Implemented**: ✅ Yes
- **Status**: Correctly falls back to Solution A
- **Problem**: Inherits Solution A's agent lifecycle limitation
- **Result**: Works for first trigger, fails for subsequent triggers

## Comparison: What Would Work vs. What We Have

### Ideal Architecture (Not Possible with Current Claude Code)
```
MCP Server detects trigger
      ↓
Sends notification to Claude Code
      ↓
Claude Code automatically invokes agent (built-in feature)
      ↓
Agent processes trigger
      ↓
Agent terminates
      ↓
[Next trigger] → Cycle repeats (Claude Code invokes agent again)
```

### Current Architecture (What We Have)
```
User runs /connect-to-oct
      ↓
Manually launch background agent as Task
      ↓
Agent calls oct_wait_for_trigger() and blocks
      ↓
Trigger arrives → Agent wakes up and processes it
      ↓
Agent Task completes and EXITS
      ↓
[Next trigger arrives] → No agent running to handle it ❌
```

## Possible Workarounds

### Workaround 1: **Manual Agent Re-launch** (Current State)
After each trigger, the user manually launches a new monitoring agent.

**Pros**:
- Simple, no code changes needed
- Works reliably when executed

**Cons**:
- Not autonomous
- Requires user intervention for every trigger
- Defeats the purpose of automatic monitoring

### Workaround 2: **Main Claude Instance Handles Triggers**
Instead of a background agent, the main Claude Code session monitors MCP notifications and responds directly.

**Pros**:
- Main instance doesn't terminate
- Can handle triggers continuously

**Cons**:
- Requires changes to Claude Code itself (not in our control)
- Main instance might be busy with other tasks
- Notification handling would need to be built into Claude Code

### Workaround 3: **Polling Agent with Timeout**
Instead of blocking indefinitely, the agent runs for a fixed period (e.g., 5 minutes), checks for triggers, processes them, then exits. The connect command periodically re-launches it.

**Pros**:
- Works within Task agent limitations
- Can be implemented in current codebase

**Cons**:
- Not truly blocking/efficient
- Delay between agent relaunches means triggers might wait
- More complex orchestration needed

### Workaround 4: **Wait for Sampling Support** (Best Long-term Solution)
When Claude Code adds support for server-initiated sampling (Solution B), the MCP server can handle everything without needing a persistent agent.

**Pros**:
- Cleanest architecture
- No agent lifecycle issues
- Truly autonomous
- Already implemented (just waiting for client support)

**Cons**:
- Requires changes to Claude Code
- Unknown timeline for implementation
- Blocks autonomous operation until then

## Recommended Path Forward

### Short-term: Accept Current Limitations
1. **Document the limitation** ✅ (this file)
2. **Update user-facing docs** to explain:
   - First trigger is handled automatically
   - Subsequent triggers require manual agent re-launch
   - This is a Claude Code limitation, not a bug
3. **Simplify the workflow**:
   - User connects via `/connect-to-oct`
   - Agent handles first trigger automatically
   - User runs a simple command to "resume monitoring" for next trigger

### Medium-term: Implement Polling Workaround
1. **Create a polling-based agent** that:
   - Runs for a fixed duration (e.g., 5 minutes)
   - Continuously checks for triggers
   - Processes any that arrive
   - Exits after timeout
2. **Modify `/connect-to-oct`** to:
   - Launch the polling agent
   - Set up a reminder for the user to re-launch after timeout
3. **Add helper command**: `/resume-oct-monitoring`
   - Re-launches the polling agent
   - Can be called after timeout or manual termination

### Long-term: Wait for Sampling Support
1. **Monitor Claude Code updates** for sampling support
2. **When sampling is added**:
   - The hybrid implementation (Solution C) will automatically detect and use it
   - Agent lifecycle problem disappears
   - Fully autonomous operation achieved
3. **No code changes needed** - already implemented and waiting

## Technical Details

### Relevant Code Locations

1. **mcp-server.ts:142-175** - `processTriggerViaFallback()`
   - Queues triggers correctly
   - Notifies waiters if they exist
   - Sends MCP notification

2. **mcp-tools.ts:535-580** - `oct_wait_for_trigger()` handler
   - Checks `currentTrigger` first (handles queued triggers)
   - Adds to `triggerWaiters` if no trigger available
   - Blocks until trigger arrives

3. **mcp-server.ts:377** - ServerState initialization
   - `pendingTriggers: []` - initialized correctly
   - `triggerWaiters` - NOT initialized (initialized lazily in oct_wait_for_trigger)

4. **.claude/commands/connect-to-oct.md:31-42** - Agent launch
   - Uses Task tool to launch background agent
   - Provides prompt telling agent to "continuously" call oct_wait_for_trigger
   - BUT: Task agents don't naturally loop

### State Management

**ServerState interface** (mcp-server.ts:44-57):
```typescript
interface ServerState {
    connection?: ProtocolBroadcastConnection;
    documentSync?: DocumentSync;
    documentOps?: DocumentSyncOperations;
    sessionInfo?: SessionInfo;
    serverUrl: string;
    pendingConnection?: Promise<void>;
    mcpServer?: Server;
    triggerCleanup?: () => void;
    pendingTriggers: TriggerEvent[];           // ✅ Queues triggers
    currentTrigger?: TriggerEvent;              // ✅ Stores latest trigger
    triggerWaiters?: Array<(trigger: TriggerEvent) => void>;  // ⚠️ Empty when agent not running
    samplingSupported?: boolean | null;         // ✅ Caches sampling detection
}
```

### Message Flow

**When a trigger is detected:**

1. `documentChangeHandler` (mcp-server.ts:204-325) detects `@agent` pattern
2. Creates `TriggerEvent` object
3. Attempts sampling (fails → cached as unsupported)
4. Calls `processTriggerViaFallback(serverState, triggerEvent)`
5. `processTriggerViaFallback`:
   - Pushes to `pendingTriggers` ✅
   - Sets `currentTrigger` ✅
   - Checks `triggerWaiters` - EMPTY ⚠️
   - Sends MCP notification ✅
   - **BUT**: No agent running to receive it ❌

**When agent calls `oct_wait_for_trigger`:**

1. Checks `state.connection` (must be connected)
2. Checks `state.currentTrigger` - if exists, return immediately ✅
3. Otherwise, add to `state.triggerWaiters` and block
4. Returns when `processTriggerViaFallback` notifies waiters

**The problem:**
- Step 5 sends notification, but no agent is running
- Step 1-4 of second flow never happens (no agent to call the tool)
- Triggers accumulate in `pendingTriggers` but are never dequeued

## Questions for Further Investigation

1. **Can Claude Code support persistent background agents?**
   - Is there a way to keep an agent running indefinitely?
   - Can we hook into the agent lifecycle to restart it?

2. **Can MCP notifications trigger agent invocation?**
   - Is there a mechanism for notifications to automatically launch agents?
   - Can we register a handler that invokes agents on specific notifications?

3. **When will Claude Code support sampling?**
   - Is sampling support on the roadmap?
   - Can we get early access for testing?

4. **Are there alternative agent patterns?**
   - Can we use a different type of background process?
   - Are there other MCP patterns we haven't considered?

## Conclusion

**Can the agent act completely autonomously?**
- **NO** - Not with the current Claude Code architecture
- **First trigger**: Yes, handled automatically ✅
- **Subsequent triggers**: No, requires manual intervention ❌

**Why?**
- Task agents terminate after completion
- No persistent background agent capability
- MCP notifications don't trigger agent invocation

**What works:**
- Trigger detection ✅
- Trigger queueing ✅
- Tool pre-approval ✅
- Hybrid sampling/fallback approach ✅

**What doesn't work:**
- Agent persistence ❌
- Continuous monitoring ❌
- True autonomous operation ❌

**Best path forward:**
- Short-term: Accept limitation, document clearly
- Medium-term: Implement polling workaround
- Long-term: Wait for sampling support in Claude Code

The implementation is correct and complete. The limitation is in the Claude Code agent architecture itself, not in the OCT MCP server code.

---

## Update 2026-01-19

Dieses Problem wurde durch die Entwicklung der **ACP Bridge Architektur** gelöst:

- **Lösung:** Der OCT Agent verwendet ACP (Agent Client Protocol) statt MCP
- **Aktuell:** Nur noch ACP-Modus (Embedded wurde entfernt); beliebige ACP-Agenten über `--acp-agent`
- **Ergebnis:** Das Task Agent Lifecycle Problem existiert nicht mehr

**Siehe:**
- [ARCHITECTURE.md](ARCHITECTURE.md) - Aktuelle Implementierung
- [ACP_CONCEPT.md](ACP_CONCEPT.md) - ACP Bridge Design
- [DEVELOPMENT_JOURNEY.md](DEVELOPMENT_JOURNEY.md) - Vollständige Entwicklungsgeschichte

Die MCP-Integration wurde als **historisch wertvoll** dokumentiert, zeigt aber einen Ansatz, der durch die bessere ACP-Lösung ersetzt wurde.
