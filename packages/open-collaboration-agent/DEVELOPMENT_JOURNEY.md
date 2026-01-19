# OCT Agent: Development Journey

**Status:** 📚 Historical Documentation
**Last Updated:** 2026-01-19

## Purpose of This Document

This document chronicles the development journey of the Open Collaboration Tools (OCT) Agent, documenting the architectural decisions, challenges encountered, and solutions implemented. It serves as a guide to understanding **why** the current architecture exists and **how** we arrived at the final design.

## What is the OCT Agent?

The OCT Agent is an AI-powered participant in collaborative coding sessions that can:
- Join OCT sessions as a peer
- Respond to `@agent` triggers in shared documents
- Make real-time code edits visible to all participants
- Operate in two modes: **Embedded** (direct LLM) or **ACP** (external agent integration)

## Development Timeline

```mermaid
gantt
    title OCT Agent Development Timeline
    dateFormat YYYY-MM-DD
    section Phase 1 MCP Integration
    MCP Notification Problem discovered :milestone, 2025-10-20, 0d
    Agent Autonomy Problem identified :milestone, 2025-10-21, 0d
    section Phase 2 ACP Solution
    ACP Concept developed :milestone, 2025-11-21, 0d
    section Phase 3 Final Implementation
    Architecture finalized :milestone, 2026-01-19, 0d
    Deployment analysis completed :milestone, 2026-01-19, 0d
```

## Phase 1: MCP Integration Attempts (October 2025)

### The Initial Vision

The first approach attempted to integrate the agent with Claude Code using the **Model Context Protocol (MCP)**. The idea was elegant:

1. OCT Agent runs as an MCP server
2. Claude Code connects as MCP client
3. When `@agent` triggers are detected, send MCP notifications
4. Claude Code automatically invokes agent to process triggers

### Problem 1: MCP Notification Limitation

**Discovered:** October 20, 2025
**Documented in:** [MCP_NOTIFICATION_PROBLEM.md](MCP_NOTIFICATION_PROBLEM.md)

**What we learned:**
- MCP notifications are **passive information updates**
- Claude Code receives notifications but doesn't automatically invoke agents
- MCP is designed for **client → server** (pull), not **server → client** (push)

**The architectural mismatch:**

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant OCT as OCT MCP Server
    participant Claude as Claude Code
    participant Agent as Agent

    Dev->>OCT: Writes @agent trigger
    OCT->>OCT: Detects trigger
    OCT->>Claude: MCP Notification
    Claude->>Claude: Receives notification
    Note over Claude,Agent: ❌ No automatic agent invocation
    Note over Agent: Agent never gets called
```

**Solutions explored:**
- **Solution A**: Blocking wait tool (`oct_wait_for_trigger`)
- **Solution B**: MCP sampling (server-initiated AI inference)
- **Solution C**: Hybrid auto-detecting approach

**Result:** Solution C was implemented but revealed a deeper problem...

### Problem 2: Agent Autonomy Problem

**Discovered:** October 21, 2025
**Documented in:** [AGENT_AUTONOMY_PROBLEM.md](AGENT_AUTONOMY_PROBLEM.md)

**The core issue:**
- Task agents in Claude Code are designed for **one-off tasks**
- After processing first trigger, agent **terminates automatically**
- No mechanism for persistent background agents
- Subsequent triggers have no agent to process them

**The lifecycle problem:**

```mermaid
flowchart TB
    subgraph first [First Trigger - Works]
        T1[Trigger arrives]-->Launch[Launch background agent]
        Launch-->Wait[Agent calls oct_wait_for_trigger]
        Wait-->Process[Agent processes trigger]
        Process-->Exit[Agent Task completes and EXITS]
    end

    subgraph second [Second Trigger - Fails]
        T2[Trigger arrives]-->Queue[Queued in pendingTriggers]
        Queue-->NoAgent[❌ No agent running to dequeue]
    end

    Exit-->T2

    style NoAgent fill:#f99
    style Exit fill:#f99
```

**Why this was a fundamental problem:**
- Not a bug in our implementation
- Architectural limitation in Claude Code's Task agent system
- MCP protocol doesn't provide agent lifecycle management
- Workarounds were complex and fragile

**Key insight:** MCP is the wrong protocol for our use case.

### Why MCP Wasn't Ideal

| Aspect | What MCP Provides | What OCT Agent Needs |
|--------|-------------------|---------------------|
| **Communication** | Unidirectional (Client → Server) | Bidirectional (Both ways) |
| **Triggering** | Client decides when to call tools | External events trigger agent |
| **Lifecycle** | Client-managed | Session-managed |
| **Use Case** | Tools/Resources for agents | Agent collaboration |

## Phase 2: ACP Solution (November 2025)

### The Breakthrough: Agent Client Protocol

**Developed:** November 21, 2025
**Documented in:** [ACP_CONCEPT.md](ACP_CONCEPT.md)

**Discovery:** The `@zed-industries/claude-code-acp` package provides proper bidirectional communication with Claude Code through the Agent Client Protocol.

### Why ACP Solved the Problems

**ACP provides:**
- ✅ **Bidirectional communication**: Server can send requests to agent
- ✅ **Event-driven architecture**: External events naturally trigger agent actions
- ✅ **Session-based**: Proper lifecycle management
- ✅ **Direct stdio communication**: Lower latency, simpler flow
- ✅ **Structured tool calls**: Agent gets context and responds with edits

**The ACP flow:**

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Bridge as ACP Bridge
    participant ACP as Claude Code ACP
    participant Yjs as Document Sync

    Dev->>Bridge: Writes @agent trigger
    Bridge->>Bridge: Detects trigger
    Bridge->>ACP: session/prompt (JSON-RPC)
    ACP->>ACP: Process with Claude Code
    ACP->>Bridge: tool_call (edit)
    Bridge->>Bridge: Auto-approve permission
    Bridge->>Yjs: Apply edits
    Yjs->>Dev: Changes visible in real-time
```

### The "Switch" Architecture

The solution was to make the OCT Agent a **dual-mode system**:

**Mode A: Embedded Agent**
- Direct LLM integration (Anthropic, OpenAI)
- No external dependencies
- Fast, efficient for simple tasks
- Hardwired workflow

**Mode B: ACP Bridge**
- Integration with external agents (Claude Code, etc.)
- Bidirectional communication via ACP
- Advanced capabilities
- Flexible tool-based workflows

**Key innovation:** The OCT Agent CLI became a "switch" that routes to the appropriate backend based on user preference.

## Phase 3: Final Architecture (January 2026)

### Current Implementation

**Finalized:** January 19, 2026
**Documented in:** [ARCHITECTURE.md](ARCHITECTURE.md)

The final architecture consists of 6 layers:

```mermaid
flowchart TB
    subgraph Layer6 [Layer 6 IDE Integration]
        VSCode[VSCode Extension]
    end

    subgraph Layer5 [Layer 5 Trigger Detection]
        TriggerDetect[Trigger Detection]
    end

    subgraph Layer4 [Layer 4 Agent Modes]
        Embedded[Embedded Agent]
        ACP[ACP Bridge]
    end

    subgraph Layer3 [Layer 3 Document Operations]
        DocOps[DocumentSyncOperations]
    end

    subgraph Layer2 [Layer 2 Document Sync]
        Yjs[Yjs CRDT]
    end

    subgraph Layer1 [Layer 1 Protocol Connection]
        Connection[OCT Connection]
    end

    VSCode-->TriggerDetect
    TriggerDetect-->Embedded
    TriggerDetect-->ACP
    Embedded-->DocOps
    ACP-->DocOps
    DocOps-->Yjs
    Yjs-->Connection
```

**Unified interface:** Both modes share the same `DocumentOperations` abstraction, ensuring consistency regardless of which mode is used.

### Deployment Considerations

**Analyzed in:** [REMOTE_AGENT_CHALLENGES.md](REMOTE_AGENT_CHALLENGES.md)

**Key constraint:** Agent must run in workspace directory
- Uses `fs.readFileSync()` for local file access
- No remote file streaming
- `process.cwd()` is workspace root

**Supported scenarios:**
- ✅ Host starts agent (same machine as workspace)
- ⚠️ Participant starts agent (requires manual workspace sync)
- ❌ Remote agent server (no workspace access)

**Design philosophy:** Local-first architecture for simplicity, performance, and security.

## Documentation Roadmap

### For Understanding the Journey

Read in this order to understand the development process:

1. **[DEVELOPMENT_JOURNEY.md](DEVELOPMENT_JOURNEY.md)** (this file) - Overview of the journey
2. **[MCP_NOTIFICATION_PROBLEM.md](MCP_NOTIFICATION_PROBLEM.md)** - First integration attempt
3. **[AGENT_AUTONOMY_PROBLEM.md](AGENT_AUTONOMY_PROBLEM.md)** - Why MCP failed
4. **[ACP_CONCEPT.md](ACP_CONCEPT.md)** - The solution
5. **[ARCHITECTURE.md](ARCHITECTURE.md)** - Final implementation

### For Using the Agent

Read in this order if you just want to use it:

1. **[README.md](README.md)** - Getting started guide
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** - How it works
3. **[REMOTE_AGENT_CHALLENGES.md](REMOTE_AGENT_CHALLENGES.md)** - Deployment scenarios

### For Specific Topics

- **Integration patterns**: [ACP_CONCEPT.md](ACP_CONCEPT.md)
- **Deployment scenarios**: [REMOTE_AGENT_CHALLENGES.md](REMOTE_AGENT_CHALLENGES.md)
- **Architecture layers**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Historical context**: [MCP_NOTIFICATION_PROBLEM.md](MCP_NOTIFICATION_PROBLEM.md) and [AGENT_AUTONOMY_PROBLEM.md](AGENT_AUTONOMY_PROBLEM.md)

## Architectural Learnings

### 1. Protocol Selection Matters

**Lesson:** Choose protocols based on your communication pattern, not popularity.

- MCP is excellent for client-driven tool access
- ACP is better for event-driven agent collaboration
- The right protocol eliminates workarounds

### 2. Bidirectional Communication is Hard

**Lesson:** Server-initiated actions require proper protocol support.

What we learned:
- Notifications are not the same as requests
- Polling and blocking are workarounds, not solutions
- Agent lifecycle management needs to be built into the protocol

### 3. Simplicity Through Abstraction

**Lesson:** Shared abstractions enable flexibility.

The `DocumentOperations` interface:
- Allows both Embedded and ACP modes to coexist
- Makes testing easier (mock the interface)
- Enables future additions without breaking existing code

### 4. Document the Journey, Not Just the Destination

**Lesson:** Historical context helps future developers understand "why."

Benefits:
- New team members understand design decisions
- Avoids repeating past mistakes
- Provides justification for current architecture
- Helps evaluate when to reconsider decisions

### 5. Local-First is a Feature, Not a Limitation

**Lesson:** Constraints drive good design.

The local workspace requirement:
- Eliminates file streaming complexity
- Improves performance (no network latency)
- Enhances security (no workspace upload)
- Simplifies implementation

Trade-off: Remote deployment requires different approach, but that's okay.

## Key Milestones

| Date | Milestone | Significance |
|------|-----------|--------------|
| 2025-10-20 | MCP Notification Problem discovered | First attempt at integration, learned MCP limitations |
| 2025-10-21 | Agent Autonomy Problem identified | Understood fundamental architectural mismatch |
| 2025-11-21 | ACP Concept developed | Found the right protocol for the job |
| 2026-01-19 | Architecture finalized | Dual-mode system with shared abstractions |

## Evolution Summary

```mermaid
flowchart LR
    subgraph attempt1 [Attempt 1 MCP]
        MCP[MCP Integration]-->Notif[Notifications dont trigger agents]
        Notif-->Auto[Autonomy problem]
    end

    subgraph solution [Solution ACP]
        ACP[Agent Client Protocol]-->Bidir[Bidirectional communication]
        Bidir-->Session[Session management]
    end

    subgraph final [Final Design]
        Dual[Dual-Mode System]-->Emb[Embedded Mode]
        Dual-->ACP2[ACP Mode]
        Emb-->Shared[Shared DocumentOperations]
        ACP2-->Shared
    end

    Auto-->ACP
    Session-->Dual

    style Notif fill:#f99
    style Auto fill:#f99
    style Bidir fill:#9f9
    style Session fill:#9f9
    style Shared fill:#9f9
```

## Conclusion

The OCT Agent development journey demonstrates that:

1. **First solutions aren't always the best solutions** - MCP seemed ideal but had fundamental limitations
2. **Understanding protocols deeply matters** - Knowing the difference between MCP and ACP was crucial
3. **Flexibility through abstraction pays off** - The dual-mode system serves different use cases
4. **Documentation is a gift to future developers** - This journey guide helps others understand the "why"

The current architecture is not just the result of implementation, but the result of learning, iterating, and finding the right tools for the job.

## Related Documentation

### Historical Context
- [MCP_NOTIFICATION_PROBLEM.md](MCP_NOTIFICATION_PROBLEM.md) - First integration challenge
- [AGENT_AUTONOMY_PROBLEM.md](AGENT_AUTONOMY_PROBLEM.md) - Lifecycle problem with MCP

### Current Implementation
- [ARCHITECTURE.md](ARCHITECTURE.md) - Complete architecture overview
- [ACP_CONCEPT.md](ACP_CONCEPT.md) - ACP integration design
- [README.md](README.md) - User guide and getting started

### Deployment
- [REMOTE_AGENT_CHALLENGES.md](REMOTE_AGENT_CHALLENGES.md) - Deployment scenarios and constraints

### Other
- [CHAT_CONCEPT.md](CHAT_CONCEPT.md) - Future: Chat-based triggering
- [CLAUDE_CODE_PLUGIN_CONCEPT.md](CLAUDE_CODE_PLUGIN_CONCEPT.md) - Claude Code integration details
- [CODE_ANALYSIS.md](CODE_ANALYSIS.md) - Code structure and implementation details
