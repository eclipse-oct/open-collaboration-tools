# Remote Agent Deployment: Challenges & Limitations

**Date:** 2025-01-19
**Status:** Analysis & Design Document

## Problem Statement

The current open-collaboration-agent architecture **requires the agent to run on the same machine as the workspace** it's editing. This document explains why this limitation exists, when it matters, and explores potential future solutions.

## Current Architecture Constraints

### Filesystem Access Pattern

The agent directly reads files from the local filesystem:

**In ACP Bridge** (`src/acp-bridge.ts:501`):
```typescript
// Read file from local filesystem
let content = fs.readFileSync(absolutePath, 'utf8');
```

The ACP agent receives document context via the bridge; file reads for multi-file or workspace access use the local filesystem. The MCP server (oct-mcp-server) uses `DocumentSync` (Yjs) for document content.

### Why This Matters

```
┌──────────────────────────────────────┐
│     Machine A: Developer             │
│                                      │
│  ┌────────────┐                      │
│  │ Workspace  │ ← Files stored here  │
│  │ /project/  │                      │
│  └────────────┘                      │
│                                      │
│  ┌────────────┐                      │
│  │ VSCode     │                      │
│  │  + OCT     │                      │
│  └────────────┘                      │
└──────────┬───────────────────────────┘
           │ OCT Protocol (WebSocket)
           │ Only Yjs operations
           │ NO file content
           ↓
┌──────────────────────────────────────┐
│         OCT Server (Cloud)           │
│  - Routes messages                   │
│  - No file storage                   │
│  - Only Yjs sync state               │
└──────────┬───────────────────────────┘
           │ OCT Protocol
           ↓
┌──────────────────────────────────────┐
│     Machine B: Remote Agent          │
│                                      │
│  ┌────────────┐                      │
│  │ oct-agent  │                      │
│  └────────────┘                      │
│       ↓ fs.readFileSync()?           │
│  ┌────────────┐                      │
│  │ Workspace  │ ❌ NOT HERE!         │
│  │ /???/      │                      │
│  └────────────┘                      │
└──────────────────────────────────────┘
```

**The Problem:**
- Agent on Machine B tries to read files from local filesystem
- Files only exist on Machine A
- OCT protocol doesn't transfer file contents - only document edits (Yjs operations)
- Agent has no way to access workspace files

### What Gets Synchronized vs What Doesn't

**✅ Synchronized via OCT (Yjs CRDT):**
- Currently open document content
- Document edits in real-time
- Cursor positions
- Active document path

**❌ NOT Synchronized:**
- File system structure (directory tree)
- Closed files / files not currently open
- File metadata (permissions, timestamps)
- Binary files
- Project configuration files (unless opened)

## Deployment Scenarios

### Scenario 1: Host Starts Agent (✅ Supported)

```
┌─────────────────────────────────────┐
│     Developer's Machine             │
│                                     │
│  ┌──────────┐      ┌──────────┐    │
│  │ VSCode   │      │oct-agent │    │
│  │  (Host)  │      │ (Guest)  │    │
│  └────┬─────┘      └────┬─────┘    │
│       │                 │           │
│  ┌────▼─────────────────▼───┐       │
│  │      Workspace            │       │
│  │    /home/dev/project/     │       │
│  │    - src/                 │       │
│  │    - package.json         │       │
│  └───────────────────────────┘       │
└─────────────────────────────────────┘
        │
        ↓ OCT Protocol
   [OCT Server]
```

**How it works:**
1. Developer creates OCT room in VSCode
2. Developer starts agent in same workspace directory
3. Agent reads files directly from disk
4. Agent joins room as guest peer
5. Both VSCode and agent see all changes via Yjs

**Why it works:**
- Both VSCode and agent run on same machine
- Both have access to same filesystem
- Agent uses `process.cwd()` = `/home/dev/project/`

**Use Cases:**
- Single developer with AI assistant
- Local testing and development
- Personal productivity enhancement

### Scenario 2: Participant Starts Agent (⚠️ Limited Support)

```
┌────────────────────┐          ┌────────────────────┐
│   Machine A        │          │   Machine B        │
│   (Host)           │          │   (Guest)          │
│                    │          │                    │
│ ┌────────────┐     │          │ ┌────────────┐     │
│ │  VSCode    │     │          │ │  oct-agent │     │
│ │  /workspace/│     │          │ │  /workspace/│     │
│ │  - src/    │     │          │ │  - src/    │     │
│ └─────┬──────┘     │          │ └─────┬──────┘     │
└───────┼────────────┘          └───────┼────────────┘
        │                               │
        └───────────────┬───────────────┘
                        ↓
                   [OCT Server]
```

**Requirements:**
- Guest must have **identical copy** of workspace
- Files must be at same relative paths
- Guest must keep workspace in sync manually

**Challenges:**
- ❌ No automatic workspace synchronization
- ❌ File changes outside OCT session not reflected
- ❌ Different file versions cause confusion
- ⚠️ Works only if guest manually syncs (git pull, etc.)

**Use Cases:**
- Team member joins to help with AI suggestions
- Multiple developers with git-synced workspace
- Requires manual coordination

### Scenario 3: Remote Agent Server (❌ Not Supported)

```
┌────────────────────┐          ┌────────────────────┐
│   Developer        │          │   Cloud Agent      │
│   Machine          │          │   Server           │
│                    │          │                    │
│ ┌────────────┐     │          │ ┌────────────┐     │
│ │  VSCode    │     │          │ │  oct-agent │     │
│ │            │     │          │ │  (pool)    │     │
│ │ Workspace: │     │          │ │            │     │
│ │ /project/  │     │          │ │ Workspace: │     │
│ │            │     │          │ │ ???        │     │
│ └─────┬──────┘     │          │ └─────┬──────┘     │
└───────┼────────────┘          └───────┼────────────┘
        │                               │
        └───────────────┬───────────────┘
                        ↓
                   [OCT Server]
```

**Why it doesn't work:**
- Cloud agent has no access to developer's local files
- OCT doesn't transfer complete workspace
- No file streaming mechanism in current protocol

**Why you might want this:**
- Centralized agent serving multiple developers
- Powerful cloud hardware for agent
- No local agent installation required
- Consistent agent behavior across team

**Why it's not implemented:**
- Major architectural change needed
- File streaming adds complexity and latency
- Security concerns (uploading workspace to cloud)
- Current design prioritizes simplicity

## Technical Deep Dive

### Code References

**1. ACP Bridge File Reading** (`src/acp-bridge.ts:498-534`)

```typescript
if (message.method === 'fs/read_text_file') {
    // Read file from local filesystem
    try {
        let content = fs.readFileSync(absolutePath, 'utf8');

        // Security check: ensure path is within workspace
        const workspaceRoot = path.normalize(process.cwd());
        if (!absolutePath.startsWith(workspaceRoot)) {
            // Reject access outside workspace
            return error;
        }

        return { content };
    } catch (error) {
        return { error: 'File not found' };
    }
}
```

**Problem:** `fs.readFileSync` requires file to exist on local disk.

**2. Workspace Context** (`src/document-operations.ts:82-85`)

```typescript
export class DocumentSyncOperations implements DocumentOperations {
    constructor(
        private readonly documentSync: DocumentSync,
        private readonly sessionInfo: SessionInfo  // Contains workspace info
    ) {}
}
```

**Session Info:**
```typescript
interface SessionInfo {
    roomId: string;
    agentId: string;
    agentName: string;
    hostId: string;
    serverUrl: string;
    // Note: NO workspacePath - each participant has their own
}
```

**3. VSCode Extension Integration** (`packages/open-collaboration-vscode/src/commands.ts:228-232`)

```typescript
const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
if (!workspaceFolder || workspaceFolder.uri.scheme !== 'file') {
    vscode.window.showErrorMessage('No local workspace folder open');
    return;
}
```

**Requirement:** VSCode command explicitly checks for local file system workspace.

### What Would Be Needed for Remote Support

#### Option 1: File Streaming via OCT Protocol

**Add to Protocol:**
```typescript
// New message types
Messages.FileSystem.RequestFile
Messages.FileSystem.FileContent
Messages.FileSystem.ListDirectory
```

**Flow:**
```
Remote Agent → RequestFile("src/utils.ts")
         ↓ (via OCT Server)
    Host VSCode → Reads file → FileContent(content)
         ↓ (via OCT Server)
Remote Agent → Receives content → Uses in LLM context
```

**Challenges:**
- Latency (network round-trip for every file)
- Security (host must approve file access)
- Large files (binary files, node_modules, etc.)
- File watching (how to detect changes?)
- Complexity (new protocol messages, caching, etc.)

#### Option 2: Workspace Synchronization

**Approach:** Automatically sync workspace to remote agent

**Technologies:**
- rsync, git, or custom sync protocol
- Watch for file changes and sync
- Bidirectional sync (agent edits → host)

**Challenges:**
- Large workspace (gigabytes of node_modules, etc.)
- Continuous syncing overhead
- Sync conflicts
- Security (uploading entire workspace)
- Setup complexity

#### Option 3: Virtual File System (VFS)

**Approach:** Abstract filesystem access

**Implementation:**
```typescript
interface VirtualFileSystem {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    listDirectory(path: string): Promise<string[]>
}

// Implementations:
class LocalFileSystem implements VirtualFileSystem { /* Uses fs */ }
class RemoteFileSystem implements VirtualFileSystem { /* Uses OCT protocol */ }
```

**Benefits:**
- Clean abstraction
- Can swap implementations
- Testable

**Challenges:**
- Must update all filesystem access points
- Async complications (currently sync)
- Performance overhead
- Cache management

## Current Workarounds

### Workaround 1: Manual Workspace Sync

**For Scenario 2 (Participant starts agent):**

1. Guest clones repository
2. Guest keeps workspace in sync via git
3. Guest starts agent in local workspace copy
4. Works as long as files stay in sync

**Limitations:**
- Manual synchronization required
- Unsaved changes not synced
- Potential version mismatches

### Workaround 2: Host-Only Agent

**Best practice for current architecture:**

- Only the host starts the agent
- Host has full workspace access
- Agent works perfectly
- Other participants just use regular editor

**This is the recommended approach for now.**

### Workaround 3: Share Workspace via Network FS

**Using NFS, SSHFS, or similar:**

```
┌──────────────┐        ┌──────────────┐
│   Machine A  │        │   Machine B  │
│   (Host)     │        │   (Agent)    │
│              │        │              │
│ /workspace/  │◄──NFS──┤ /mnt/workspace/
│              │        │              │
└──────────────┘        └──────────────┘
```

**Agent on Machine B:**
```bash
cd /mnt/workspace  # Mounted from Machine A
oct-agent --room ...
```

**Challenges:**
- Network latency
- Requires infrastructure setup
- Potential permission issues
- Not suitable for cloud deployment

## Comparison: Local vs Remote

| Aspect | Local Agent | Remote Agent |
|--------|-------------|--------------|
| **Filesystem Access** | ✅ Direct | ❌ Requires streaming |
| **Latency** | ✅ Minimal | ❌ Network overhead |
| **Setup Complexity** | ✅ Simple | ❌ Complex |
| **Security** | ✅ No data upload | ⚠️ Workspace exposure |
| **Multi-user** | ❌ One per machine | ✅ Shared agent pool |
| **Cost** | ✅ Local compute | 💰 Cloud infrastructure |
| **Consistency** | ⚠️ Per-developer | ✅ Same for all |

## Recommendations

### For Current Implementation

**✅ DO:**
- Run agent on same machine as workspace
- Use VSCode Extension command to start agent
- Ensure `process.cwd()` is workspace root

**❌ DON'T:**
- Try to run agent remotely without workspace access
- Expect automatic file synchronization
- Share agent across machines without coordination

### For Future Enhancement

**If remote support is needed:**

1. **Start with VFS abstraction**
   - Cleanest architectural approach
   - Allows testing different implementations
   - Gradual migration

2. **Implement file streaming protocol**
   - Add OCT protocol messages for file operations
   - Start with simple read-only access
   - Add caching to reduce latency

3. **Consider security implications**
   - File access permissions
   - Privacy (what files can agent see?)
   - Audit logging

4. **Optimize for common cases**
   - Cache frequently accessed files
   - Batch file requests
   - Use workspace introspection to minimize requests

## Conclusion

The current local-agent architecture is a **deliberate design choice** that prioritizes:

- ✅ **Simplicity** - Direct filesystem access, no complex protocols
- ✅ **Performance** - No network latency for file operations
- ✅ **Security** - No workspace data leaves developer's machine
- ✅ **Reliability** - Fewer failure modes, simpler debugging

**Remote agent support** would require significant architectural changes and is **not planned for the initial release**.

**Recommendation:** Use the host-starts-agent pattern (Scenario 1) for best experience with current implementation.

## Related Documentation

- **ARCHITECTURE.md** - Complete architecture overview
- **ACP_CONCEPT.md** - ACP protocol and external agent integration
- **README.md** - Getting started and workspace requirements
- **CLAUDE_CODE_PLUGIN_CONCEPT.md** - Claude Code integration details
