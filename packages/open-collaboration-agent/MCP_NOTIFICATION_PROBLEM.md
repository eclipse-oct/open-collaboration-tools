# MCP Notification Problem and Solutions

---
**STATUS: ARCHIVED - MCP code simplified to skeleton**

This document describes historical MCP integration attempts. The MCP code has been
simplified to a minimal skeleton for future extensions. The main agent uses ACP exclusively.

**Date:** 2025-10-20
**Original Status:** ✅ IMPLEMENTED - Solution C (Hybrid Auto-Detecting Approach)
**Current Status:** 🗄️ ARCHIVED - Code simplified, kept as reference
---

## Problem Statement

The OCT collaboration agent MCP server successfully detects `@agent` triggers and sends MCP resource update notifications, but Claude Code (the MCP client) does not automatically respond to these notifications with agent action.

### What Works ✅

1. **MCP Server** (`packages/open-collaboration-agent/src/mcp-server.ts`):

    - Detects `@agent` triggers via `DocumentSync.onDocumentChange()` handler (line 78-157)
    - Starts loading animation at trigger position (line 113)
    - Creates `TriggerEvent` and queues it in `serverState.pendingTriggers` (line 130-131)
    - Sends MCP `notifications/resources/updated` for `oct://triggers/current` (line 138-150)
    - **Confirmed in logs:** `[MCP] Sent resource update notification`

2. **MCP Resources** (`packages/open-collaboration-agent/src/mcp-resources.ts`):

    - Exposes `oct://triggers/current` resource with trigger details (line 160-174)
    - Exposes `oct://triggers/pending` resource with all pending triggers (line 178-192)

3. **Agent Definition** (`.claude/agents/oct-collab-agent.md`):

    - Documents the expected workflow when notifications arrive (line 10-27)
    - Describes automatic trigger processing steps (line 29-77)

4. **Claude Code MCP Client**:
    - Receives the MCP notification at protocol level (confirmed in logs)
    - Has access to all MCP tools and resources

### What Doesn't Work ❌

**Claude Code does not automatically invoke the agent when MCP notifications arrive.**

The notification flow stops at:

```
MCP Server → (sends notification) → Claude Code → (receives notification) → ❌ No automatic agent invocation
```

Expected behavior:

```
MCP Server → (sends notification) → Claude Code → (receives notification) → ✅ Auto-invoke oct-collab-agent → Process trigger
```

### Root Cause

MCP protocol is designed for:

-   **Client → Server (tools)**: Client calls tools on server ✅
-   **Server → Client (notifications)**: Server sends passive notifications ✅

But there's no standard MCP mechanism for:

-   **Server → Client → Agent**: Server notification automatically triggers AI agent action ❌

Claude Code receives the notification but has no built-in mechanism to automatically launch an agent in response to MCP resource update notifications.

## Why MCP Is Not Ideal for Agent Integration

### MCP Protocol Design Philosophy

MCP (Model Context Protocol) is designed for a specific interaction model:

**Intended Use Case:**
- AI Agent (Client) requests information from external tools (Server)
- Client controls the flow - decides when to call which tools
- Server responds to client requests
- **Unidirectional flow: Client → Server**

**What MCP Is Good For:**
- Exposing external data sources to AI agents (databases, APIs, file systems)
- Providing tools that agents can call on-demand
- Client-driven workflows where agent decides what to do

### The Bidirectional Communication Problem

Our use case requires **bidirectional communication**:

**What We Need:**
- External event (code change) triggers AI agent action
- Server needs to "push" work to the agent
- **Bidirectional flow: Server → Agent AND Agent → Server**

**Why MCP Struggles:**

1. **No Server-Initiated Agent Invocation**
   - MCP notifications are passive information updates
   - Claude Code receives notifications but doesn't automatically invoke agents
   - No standard mechanism for "notification → trigger agent task"

2. **Workarounds Have Limitations**
   - Solution A (Blocking Wait): Requires long-running background agent
   - Solution B (Sampling): Not yet supported by Claude Code
   - Solution C (Hybrid): Combines both, but still a workaround

3. **Architecture Mismatch**
   - MCP expects client to drive the workflow
   - Our workflow is event-driven (code changes trigger agent)
   - We're trying to make a pull-based protocol work for push-based events

### Why ACP (Agent Client Protocol) Is Better

The ACP (Agent Client Protocol) mode using `@zed-industries/claude-code-acp` provides proper bidirectional communication:

**ACP Advantages:**
- ✅ **Designed for bidirectional communication**: Server can send requests to agent
- ✅ **Event-driven architecture**: External events naturally trigger agent actions
- ✅ **Direct stdio communication**: Lower latency, simpler flow
- ✅ **Session-based**: Proper lifecycle management for long-running agents
- ✅ **Tool call model**: Agent gets proper context and can respond with structured edits

**ACP vs MCP Comparison:**

| Aspect | MCP | ACP |
|--------|-----|-----|
| Communication | Unidirectional (Client → Server) | Bidirectional (Both ways) |
| Event Handling | Passive notifications | Active requests |
| Agent Lifecycle | Client-managed | Session-managed |
| Trigger Flow | Workarounds needed | Native support |
| Use Case Fit | Tools/Resources for agents | Agent collaboration |

### Current MCP Implementation: A Compromise

The current Solution C (Hybrid) implementation works but is essentially a workaround:

1. **Not true bidirectional communication** - we're simulating it with:
   - Background agent polling via blocking tool call
   - Notification as a "wake-up signal" (but agent must already be running)

2. **Requires manual agent setup**:
   - User must launch background monitoring agent
   - Agent must call `oct_wait_for_trigger()` in a loop
   - Additional complexity compared to native event handling

3. **Why we still implemented it**:
   - Works with current Claude Code MCP client
   - Better than purely manual triggering
   - Provides automatic operation (once agent is running)
   - Will automatically upgrade when sampling support arrives

### Recommendation

**For new implementations:** Use the oct-agent; it connects via ACP by default and provides proper bidirectional communication. Override the ACP agent with `--acp-agent` if needed.

**For MCP mode (oct-mcp-server):** Understand it's a compromise that works but isn't architecturally ideal. The hybrid approach is the best we can do within MCP's limitations.

## Proposed Solutions

### Solution A: Long-running Agent with Blocking Wait

**Description:**
Add a blocking MCP tool `oct_wait_for_trigger()` that waits until a trigger arrives, then returns. Launch a background agent that calls this tool in a loop.

**Implementation:**

1. **Add blocking tool to MCP server** (`mcp-tools.ts`):

    ```typescript
    oct_wait_for_trigger: {
      description: "Block until next @agent trigger arrives",
      handler: async () => {
        // Wait for serverState.currentTrigger to be populated
        // Return trigger data when available
      }
    }
    ```

2. **Modify `/connect-to-oct` command** to auto-launch monitoring agent:

    ```markdown
    After successful connection:

    -   Launch oct-collab-agent as background Task
    -   Agent calls oct_wait_for_trigger() (blocks)
    -   When trigger arrives, tool returns with data
    -   Agent processes trigger automatically
    -   Agent loops back to oct_wait_for_trigger()
    ```

**Workflow:**

```
/connect-to-oct → Connection succeeds
                ↓
Auto-launch background oct-collab-agent
                ↓
Agent calls oct_wait_for_trigger() → BLOCKS (no tokens used)
                ↓
Developer writes: @agent add validation
                ↓
MCP server detects trigger
                ↓
oct_wait_for_trigger() returns with trigger data
                ↓
Agent processes trigger automatically
                ↓
Agent loops: oct_wait_for_trigger() → BLOCKS again
```

**Pros:**

-   ✅ Fully automatic - no user intervention needed
-   ✅ Token-efficient - only uses tokens during actual processing
-   ✅ True push-based architecture
-   ✅ Seamless collaboration experience
-   ✅ Works with current Claude Code Task agent system

**Cons:**

-   ❌ Requires implementing new blocking tool in MCP server
-   ❌ Need to handle edge cases (connection loss, agent crashes)
-   ❌ Requires proper cleanup when disconnecting

**Best for:** Production-ready solution with good UX and efficiency

---

### Solution B: MCP Sampling Request Pattern

**Description:**
Use MCP's sampling capability to have the server send a completion request directly to Claude Code. When a trigger is detected, the MCP server initiates an AI inference request with the prompt and context, receives the generated edit back, and applies it directly to the document.

**Implementation:**

1. **MCP server detects trigger** (`mcp-server.ts` already has `sampling: {}` capability declared):

    - Parse `@agent` trigger and extract prompt
    - Gather document context around the trigger location

2. **Server sends sampling request to Claude Code**:

    ```typescript
    // Send sampling/createMessage request
    const result = await server.request({
        method: "sampling/createMessage",
        params: {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Document:\n${documentContext}\n\nPrompt: ${triggerPrompt}`,
                    },
                },
            ],
            systemPrompt: "You are a code editing assistant...",
            maxTokens: 4096,
        },
    });
    ```

3. **Claude Code processes request**:

    - Runs AI inference on the provided prompt and context
    - Returns generated code/edits as response

4. **MCP server applies the edit**:
    - Parse the AI response
    - Apply changes to the document using existing DocumentSync
    - Complete trigger and remove trigger line

**Workflow:**

```
Developer writes: @agent add validation
                ↓
MCP server detects trigger
                ↓
Server sends sampling request to Claude Code:
  - Prompt: "add validation"
  - Context: Document content around trigger
                ↓
Claude Code AI processes the request
                ↓
Returns AI-generated edit/code to MCP server
                ↓
MCP server applies edit directly to document
                ↓
Done! No agent, no user interaction needed
```

**Pros:**

-   ✅ Fully automatic - no user intervention needed
-   ✅ Token-efficient - only uses tokens during actual processing
-   ✅ Server maintains complete control of the flow
-   ✅ No need for long-running agents or background tasks
-   ✅ Clean architecture - server-initiated AI inference
-   ✅ MCP protocol already supports sampling (capability declared in our server)

**Cons:**

-   ❌ Need to verify Claude Code MCP client supports server-initiated sampling requests
-   ❌ Requires parsing AI response to extract edits (vs. structured tool calls)
-   ❌ Server-side AI response parsing may be less reliable than tool-based editing

**Best for:** Clean, automatic solution if Claude Code supports server-initiated sampling

---

### Solution C: Hybrid Auto-Detecting Approach

**Description:**
Combine both solutions with automatic capability detection. When a trigger is detected, first attempt to use MCP sampling. If sampling is not supported (error response), gracefully fall back to the notification pattern that works with the blocking wait tool.

**Implementation:**

1. **On trigger detection** (`mcp-server.ts`):

    ```typescript
    async function handleTrigger(trigger: TriggerEvent) {
        // Start loading animation
        await startLoadingAnimation(trigger);

        try {
            // Attempt Solution B: MCP Sampling
            const samplingResult = await server.request({
                method: "sampling/createMessage",
                params: {
                    messages: [
                        {
                            role: "user",
                            content: {
                                type: "text",
                                text: `Document:\n${documentContext}\n\nPrompt: ${trigger.prompt}`,
                            },
                        },
                    ],
                    systemPrompt: "You are a code editing assistant...",
                    maxTokens: 4096,
                },
            });

            // Success! Sampling is supported
            console.log("[MCP] Using sampling approach");
            await parseAndApplyEdit(samplingResult, trigger);
            await completeTrigger(trigger.id);
        } catch (error) {
            // Check if sampling is not supported
            if (isSamplingNotSupportedError(error)) {
                console.log(
                    "[MCP] Sampling not supported, using notification approach"
                );

                // Fall back to Solution A: Blocking Wait
                // Queue trigger and send notification
                // (Requires agent running with oct_wait_for_trigger())
                state.pendingTriggers.push(trigger);
                state.currentTrigger = trigger;

                await server.notification({
                    method: "notifications/resources/updated",
                    params: { uri: "oct://triggers/current" },
                });
            } else {
                // Some other error occurred
                console.error(
                    "[MCP] Sampling failed with unexpected error:",
                    error
                );
                throw error;
            }
        }
    }
    ```

2. **Error detection helper**:

    ```typescript
    function isSamplingNotSupportedError(error: any): boolean {
        // Check for common "not supported" error patterns
        return (
            error?.code === -32601 || // Method not found
            error?.message?.includes("not supported") ||
            error?.message?.includes("sampling")
        );
    }
    ```

3. **For Solution A fallback**: Keep `oct_wait_for_trigger()` tool and agent setup as described in Solution A

4. **Optional optimization - cache detection result**:

    ```typescript
    let samplingSupported: boolean | null = null; // null = not yet tested

    async function handleTrigger(trigger: TriggerEvent) {
        if (samplingSupported === false) {
            // Skip sampling attempt if we know it doesn't work
            await useSolutionAPath(trigger);
            return;
        }

        try {
            await attemptSampling(trigger);
            samplingSupported = true; // Remember it works
        } catch (error) {
            if (isSamplingNotSupportedError(error)) {
                samplingSupported = false; // Remember it doesn't work
                await useSolutionAPath(trigger);
            }
        }
    }
    ```

    This eliminates the latency issue after the first trigger.

**Workflow:**

```
Developer writes: @agent add validation
                ↓
MCP server detects trigger
                ↓
Attempt sampling request
                ↓
        ┌───────┴────────┐
        ↓                ↓
    Success          Not Supported
        ↓                ↓
   Parse & Apply    Send notification
   response         (Solution A path)
        ↓                ↓
   Complete         Agent processes
   trigger          via blocking wait
```

**Pros:**

-   ✅ Best of both worlds - uses optimal method available
-   ✅ Future-proof - automatically adapts when sampling becomes available
-   ✅ Works with different MCP clients (some may support sampling today)
-   ✅ Graceful degradation - no user-visible failure
-   ✅ Single codebase supports both approaches
-   ✅ Can detect and log which method is being used

**Cons:**

-   ❌ More complex implementation (combines both solutions)
-   ❌ Requires maintaining both code paths
-   ⚠️ First trigger adds latency from failed sampling request (mitigated by caching detection result, see step 4)

**Best for:** Production deployment that needs to work now AND in the future

---

## Comparison Matrix

| Criterion                  | Solution A (Blocking Wait) | Solution B (Sampling)    | Solution C (Hybrid)         |
| -------------------------- | -------------------------- | ------------------------ | --------------------------- |
| **Automatic**              | ✅ Yes                     | ✅ Yes                   | ✅ Yes                      |
| **Token Efficient**        | ✅ Yes                     | ✅ Yes                   | ✅ Yes                      |
| **Implementation Time**    | ⏱️ 2-3 hours               | ⏱️ 3-4 hours             | ⏱️ 4-5 hours                |
| **User Experience**        | ⭐⭐⭐⭐ Excellent         | ⭐⭐⭐⭐⭐ Perfect       | ⭐⭐⭐⭐⭐ Perfect          |
| **Architecture**           | Agent-based (client-side)  | Server-initiated AI      | Adaptive (both)             |
| **Requires Active Agent**  | ✅ Yes (background task)   | ❌ No                    | ⚠️ Only if sampling fails   |
| **Edit Control**           | Agent uses MCP tools       | Server parses AI text    | Both (adaptive)             |
| **Reliability**            | 🟢 High (structured tools) | 🟡 Medium (text parsing) | 🟢 High (graceful fallback) |
| **Future-proof**           | ❌ No                      | ⚠️ If supported          | ✅ Yes                      |
| **Maintenance Complexity** | 🟡 Medium                  | 🟢 Low                   | 🟠 Medium-High (both paths) |
| **Works with Claude Code** | ✅ Yes (now)               | ❌ Not yet               | ✅ Yes (now + future)       |

## Recommendation

**Primary recommendation: Solution C (Hybrid Auto-Detecting)**

Solution C is the best choice for production deployment:

-   ✅ **Works immediately** with current Claude Code (via Solution A path)
-   ✅ **Future-proof** - automatically switches to sampling when available
-   ✅ **No manual intervention** needed when Claude Code adds sampling support
-   ✅ **Compatible with other MCP clients** that may already support sampling
-   ✅ **Graceful degradation** - transparent to users
-   ⚠️ Higher implementation complexity (both code paths needed)
-   ⚠️ Requires agent setup for fallback path

**Why not Solution B alone?**
Solution B (sampling only) would be ideal architecturally, but Claude Code doesn't currently support server-initiated sampling. Waiting for this feature would block development.

**Why not Solution A alone?**
Solution A (blocking wait only) works now but lacks future-proofing. When sampling becomes available, you'd need code changes to take advantage of it. Solution C automatically adapts.

**Alternative: Solution A (for simplicity)**

If you want to minimize complexity and are okay with manual migration later:

-   ✅ Simpler implementation (single code path)
-   ✅ Works with current Claude Code Task agent system
-   ✅ More reliable structured tool-based editing
-   ❌ Requires code changes when sampling becomes available
-   ❌ Not compatible with MCP clients that support sampling

## Decision Tree

**Recommended Path:**

1. **Implement Solution C (Hybrid)** for production-ready, future-proof system
    - Implement both sampling attempt and blocking wait fallback
    - Deploy with confidence it works today and automatically improves later
    - Monitor logs to see which path is being used

**Alternative Paths (if you need simpler implementation):**

2. **Quick Start: Implement Solution A only**

    - Get working system quickly (2-3 hours)
    - Plan migration to Solution C or B when sampling support arrives
    - Accept that you'll need code changes later

3. **Wait for Sampling: Implement Solution B only**
    - Only viable if you can wait for Claude Code to add sampling support
    - Cleanest architecture when it works
    - Not recommended due to unknown timeline

## Implementation Status

**✅ COMPLETED:** Solution C (Hybrid Auto-Detecting Approach) has been fully implemented.

### What Was Implemented

1. **✅ Blocking Wait Infrastructure (Solution A components)**
   - Added `oct_wait_for_trigger()` blocking tool in `mcp-tools.ts:217-224`
   - Added `triggerWaiters` array to ServerState in `mcp-server.ts:49`
   - Tool handler implemented in `mcp-tools.ts:535-580`

2. **✅ Sampling Components (Solution B components)**
   - Created `sampling-parser.ts` with:
     - `createSamplingRequest()` - builds sampling request with context
     - `parseSamplingResponse()` - extracts edits from AI response
     - `SAMPLING_SYSTEM_PROMPT` - instructions for AI code editing
     - `convertToLineEdits()` - converts parsed edits to line format

3. **✅ Hybrid Trigger Handler (Solution C)**
   - Added `isSamplingNotSupportedError()` helper in `mcp-server.ts:62-72`
   - Added `attemptSamplingForTrigger()` in `mcp-server.ts:78-133`
   - Added `processTriggerViaFallback()` in `mcp-server.ts:138-168`
   - Implemented hybrid approach in document change handler `mcp-server.ts:251-310`
   - Added `samplingSupported` caching to ServerState `mcp-server.ts:50`

4. **✅ Agent Auto-Launch**
   - Modified `/connect-to-oct` command to auto-launch monitoring agent `.claude/commands/connect-to-oct.md:31-41`
   - Modified `/disconnect-from-oct` command with cleanup logic `.claude/commands/disconnect-from-oct.md:7-9`

### How It Works

When a developer writes `@agent <prompt>` in their code:

1. **First Trigger (Detection Phase)**
   - MCP server attempts sampling request first
   - If sampling fails with "not supported" error:
     - Caches result: `samplingSupported = false`
     - Falls back to notification + blocking wait approach
     - Background agent receives trigger via `oct_wait_for_trigger()`
   - If sampling succeeds:
     - Caches result: `samplingSupported = true`
     - Applies edits directly from AI response
     - Removes trigger line automatically

2. **Subsequent Triggers (Cached Path)**
   - System uses cached `samplingSupported` value
   - Skips detection attempt on every trigger
   - Routes directly to the appropriate handler
   - No latency penalty after first trigger

### Current Behavior with Claude Code

Currently uses **fallback path** (Solution A):
- Logs show: `[MCP] Sampling not supported, using notification approach`
- Background monitoring agent handles triggers via `oct_wait_for_trigger()`
- Works seamlessly with current Claude Code

### Future Behavior

When Claude Code adds sampling support:
- System automatically detects and switches to sampling path
- Logs will show: `[MCP] Using sampling approach (succeeded)`
- No code changes needed - transition is automatic
- More efficient server-side processing

### Monitoring and Logs

Key log messages to watch:
- `[MCP] Using sampling approach (succeeded)` - Sampling is working
- `[MCP] Sampling not supported, using notification approach` - Using fallback
- `[MCP] Skipping sampling (previously detected as unsupported)` - Cached fallback
- `[MCP] oct_wait_for_trigger called - blocking until trigger arrives` - Agent waiting

## Next Steps (Archived)

### Recommended: Implement Solution C (Hybrid)

1. **Implement blocking wait infrastructure** (Solution A components)

    - Add `oct_wait_for_trigger()` blocking tool to `mcp-tools.ts`
    - Modify `/connect-to-oct` command to auto-launch monitoring agent
    - Add cleanup logic in `/disconnect-from-oct`
    - Test blocking wait flow works independently

2. **Implement sampling with fallback** (Solution C)

    - Add trigger handler in `mcp-server.ts` that attempts sampling first
    - Implement `isSamplingNotSupportedError()` error detection
    - On sampling failure, fall back to notification pattern
    - Add logging to track which path is used: `[MCP] Using sampling approach` vs `[MCP] Sampling not supported, using notification approach`

3. **Implement sampling response parser** (for when it works)

    - Create system prompt for code editing via sampling
    - Implement AI response parser to extract edits from text
    - Apply edits using existing `DocumentSync` operations

4. **Testing**

    - Test with current Claude Code (should use Solution A path)
    - Verify logs show: `[MCP] Sampling not supported, using notification approach`
    - Verify agent receives trigger via blocking wait and processes correctly
    - Test with other MCP clients if available

5. **Documentation Updates**
    - Update `CLAUDE_CODE_PLUGIN_CONCEPT.md` to document hybrid approach
    - Add usage examples showing both paths
    - Document how to interpret logs to know which path is active
    - Note that system will automatically upgrade when sampling becomes available

### Alternative: Quick Start with Solution A only

If you need a faster path to production:

1. Skip sampling implementation entirely
2. Implement only blocking wait tool and agent setup
3. Plan migration to Solution C later when time permits

## Technical Notes

### Current MCP Tools Available

-   `oct_connect(roomId, serverUrl?)` - Connect to room
-   `oct_disconnect()` - Disconnect from room
-   `oct_get_connection_status()` - Check connection
-   `oct_get_document(path)` - Read full document
-   `oct_get_document_range(path, startLine, endLine)` - Read line range
-   `oct_apply_edit(path, edit)` - Apply line-based edit
-   `oct_trigger_start_processing(triggerId)` - Stop loading animation
-   `oct_trigger_complete(triggerId)` - Mark trigger done
-   `oct_remove_trigger_line(path)` - Remove @agent line
-   `oct_get_session_info()` - Get session metadata

### Current MCP Resources Available

-   `oct://session/info` - Connection status and session info
-   `oct://documents/{path}` - Document content by path
-   `oct://triggers/current` - Most recent trigger (sent with notification)
-   `oct://triggers/pending` - All pending triggers

### Files Involved

-   `.claude/agents/oct-collab-agent.md` - Agent definition
-   `.claude/commands/connect-to-oct.md` - Connection slash command
-   `packages/open-collaboration-agent/src/mcp-server.ts` - MCP server (sends notifications)
-   `packages/open-collaboration-agent/src/mcp-tools.ts` - MCP tool implementations
-   `packages/open-collaboration-agent/src/mcp-resources.ts` - MCP resource providers
