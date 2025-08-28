# Chat Functionality Concept for Open Collaboration Protocol

## Overview

This document outlines a comprehensive concept for adding chat functionality to the Open Collaboration Protocol. The chat feature would enable real-time text communication between participants in a collaboration session, running in parallel to the code editing experience.

## Current System Analysis

The **open-collaboration-protocol** already has a well-designed message infrastructure with:

1. **Three message types**: `BroadcastType`, `RequestType`, and `NotificationType`
2. **Organized namespaces**: `Room`, `Peer`, `Editor`, `Sync`, and `FileSystem`
3. **Encryption & compression**: Built-in support via message metadata
4. **Awareness system**: Already tracking peer cursor positions and active documents

## Design Philosophy

The chat feature should:
- **Integrate seamlessly** with the existing protocol structure
- **Follow established patterns** (BroadcastType for group messages, NotificationType for direct messages)
- **Be decoupled from editor integration** (separate package, not tied to Monaco)
- **Leverage existing encryption** (messages encrypted end-to-end automatically)
- **Support both broadcast and direct messaging** (group chat + direct messages to specific peers)
- **Support rich features** (replies, reactions, file sharing)
- **Be non-intrusive** to the code collaboration experience
- **Work in real-time** like other collaboration features
- **Enable agent interaction** (send prompts directly to agent as a peer)

## Proposed Protocol Enhancements

### 1. New Message Namespace: `Messages.Chat`

Add to `/packages/open-collaboration-protocol/src/messages.ts`:

```typescript
export namespace Messages {
    // ... existing namespaces ...

    export namespace Chat {
        // Send a chat message to all participants
        export const Message = new BroadcastType<[types.ChatMessage]>('chat/message');

        // Send a direct message to a specific peer
        export const DirectMessage = new NotificationType<[types.ChatMessage]>('chat/directMessage');

        // Edit a previously sent message
        export const Edit = new BroadcastType<[types.ChatMessageEdit]>('chat/edit');

        // Delete a message
        export const Delete = new BroadcastType<[types.ChatMessageDelete]>('chat/delete');

        // React to a message (emoji reactions)
        export const Reaction = new BroadcastType<[types.ChatReaction]>('chat/reaction');

        // Mark messages as read (for read receipts)
        export const ReadReceipt = new NotificationType<[types.ChatReadReceipt]>('chat/readReceipt');

        // Typing indicator
        export const Typing = new NotificationType<[types.ChatTypingIndicator]>('chat/typing');

        // Request chat history (for late joiners)
        export const HistoryRequest = new RequestType<[types.ChatHistoryRequest], types.ChatHistory>('chat/historyRequest');
    }
}
```

### 2. New Type Definitions

Add to `/packages/open-collaboration-protocol/src/types.ts`:

```typescript
// Base chat message
export interface ChatMessage {
    id: Id;                          // Unique message ID (UUID)
    author: Id;                      // Peer ID of the sender
    recipient?: Id;                  // Optional: Peer ID of recipient (for direct messages)
    timestamp: number;               // Unix timestamp (ms)
    content: ChatMessageContent;
    replyTo?: Id;                    // Optional: ID of message being replied to
    metadata?: ChatMessageMetadata;  // Extensible metadata
}

// Message content types
export type ChatMessageContent =
    | TextChatContent
    | CodeSnippetChatContent
    | FileLinkChatContent
    | SystemChatContent;

export interface TextChatContent {
    type: 'text';
    text: string;
    format?: 'plain' | 'markdown';  // Support markdown formatting
}

export interface CodeSnippetChatContent {
    type: 'code';
    code: string;
    language?: string;               // Language for syntax highlighting
    path?: Path;                     // Optional: source file path
    range?: Range;                   // Optional: specific lines shared
}

export interface FileLinkChatContent {
    type: 'file-link';
    path: Path;
    range?: Range;                   // Optional: link to specific lines
    description?: string;
}

export interface SystemChatContent {
    type: 'system';
    event: ChatSystemEvent;
    params?: Record<string, string>;
}

export type ChatSystemEvent =
    | 'peer-joined'
    | 'peer-left'
    | 'permissions-changed'
    | 'file-shared'
    | 'session-started'
    | 'session-ended';

export interface ChatMessageMetadata {
    edited?: boolean;
    editedAt?: number;
    reactions?: ChatMessageReaction[];
    [key: string]: unknown;          // Extensible for future features
}

// Message operations
export interface ChatMessageEdit {
    messageId: Id;
    newContent: ChatMessageContent;
    timestamp: number;
}

export interface ChatMessageDelete {
    messageId: Id;
    timestamp: number;
}

export interface ChatReaction {
    messageId: Id;
    reaction: string;                // Emoji string (e.g., "👍", "❤️")
    author: Id;                      // Peer who reacted
    action: 'add' | 'remove';
}

export interface ChatMessageReaction {
    reaction: string;
    authors: Id[];                   // List of peers who added this reaction
}

// Read receipts and typing indicators
export interface ChatReadReceipt {
    messageId: Id;
    reader: Id;
    timestamp: number;
}

export interface ChatTypingIndicator {
    author: Id;
    typing: boolean;
}

// Chat history (for syncing late joiners)
export interface ChatHistoryRequest {
    since?: number;                  // Unix timestamp - get messages after this time
    limit?: number;                  // Max messages to return
}

export interface ChatHistory {
    messages: ChatMessage[];
    hasMore: boolean;
}
```

### 3. Connection Handler Interface

Add to `/packages/open-collaboration-protocol/src/connection.ts`:

```typescript
export interface ChatHandler {
    // Receive group messages (broadcasts)
    onMessage(handler: Handler<[types.ChatMessage]>): void;
    message(content: types.ChatMessageContent, replyTo?: types.Id): Promise<void>;

    // Receive direct messages (peer-to-peer)
    onDirectMessage(handler: Handler<[types.ChatMessage]>): void;
    directMessage(target: MessageTarget, content: types.ChatMessageContent, replyTo?: types.Id): Promise<void>;

    // Edit/delete
    onEdit(handler: Handler<[types.ChatMessageEdit]>): void;
    edit(messageId: types.Id, newContent: types.ChatMessageContent): Promise<void>;

    onDelete(handler: Handler<[types.ChatMessageDelete]>): void;
    delete(messageId: types.Id): Promise<void>;

    // Reactions
    onReaction(handler: Handler<[types.ChatReaction]>): void;
    react(messageId: types.Id, reaction: string, action: 'add' | 'remove'): Promise<void>;

    // Read receipts
    onReadReceipt(handler: Handler<[types.ChatReadReceipt]>): void;
    sendReadReceipt(target: MessageTarget, messageId: types.Id): Promise<void>;

    // Typing indicators
    onTyping(handler: Handler<[types.ChatTypingIndicator]>): void;
    setTyping(target: MessageTarget, typing: boolean): Promise<void>;

    // History
    onHistoryRequest(handler: Handler<[types.ChatHistoryRequest], types.ChatHistory>): void;
    requestHistory(target: MessageTarget, request: types.ChatHistoryRequest): Promise<types.ChatHistory>;
}

export interface ProtocolBroadcastConnection extends BroadcastConnection {
    // ... existing handlers ...
    chat: ChatHandler;
}
```

### 4. Implementation in Connection Class

Add to `ProtocolBroadcastConnectionImpl` class:

```typescript
chat: ChatHandler = {
    onMessage: handler => this.onBroadcast(Messages.Chat.Message, handler),
    message: async (content, replyTo) => {
        const message: types.ChatMessage = {
            id: crypto.randomUUID(),
            author: this.peerId,  // Current peer ID
            timestamp: Date.now(),
            content,
            replyTo
        };
        await this.sendBroadcast(Messages.Chat.Message, message);
    },

    onDirectMessage: handler => this.onNotification(Messages.Chat.DirectMessage, handler),
    directMessage: async (target, content, replyTo) => {
        const message: types.ChatMessage = {
            id: crypto.randomUUID(),
            author: this.peerId,
            recipient: target.peerId,  // Target peer ID
            timestamp: Date.now(),
            content,
            replyTo
        };
        await this.sendNotification(Messages.Chat.DirectMessage, target, message);
    },

    onEdit: handler => this.onBroadcast(Messages.Chat.Edit, handler),
    edit: async (messageId, newContent) => {
        const edit: types.ChatMessageEdit = {
            messageId,
            newContent,
            timestamp: Date.now()
        };
        await this.sendBroadcast(Messages.Chat.Edit, edit);
    },

    onDelete: handler => this.onBroadcast(Messages.Chat.Delete, handler),
    delete: async (messageId) => {
        await this.sendBroadcast(Messages.Chat.Delete, {
            messageId,
            timestamp: Date.now()
        });
    },

    onReaction: handler => this.onBroadcast(Messages.Chat.Reaction, handler),
    react: async (messageId, reaction, action) => {
        await this.sendBroadcast(Messages.Chat.Reaction, {
            messageId,
            reaction,
            author: this.peerId,
            action
        });
    },

    onReadReceipt: handler => this.onNotification(Messages.Chat.ReadReceipt, handler),
    sendReadReceipt: async (target, messageId) => {
        await this.sendNotification(Messages.Chat.ReadReceipt, target, {
            messageId,
            reader: this.peerId,
            timestamp: Date.now()
        });
    },

    onTyping: handler => this.onNotification(Messages.Chat.Typing, handler),
    setTyping: async (target, typing) => {
        await this.sendNotification(Messages.Chat.Typing, target, {
            author: this.peerId,
            typing
        });
    },

    onHistoryRequest: handler => this.onRequest(Messages.Chat.HistoryRequest, handler),
    requestHistory: (target, request) =>
        this.sendRequest(Messages.Chat.HistoryRequest, target, request)
};
```

## Key Design Decisions

### 1. Message Broadcasting vs. Targeted Messages ✅ DECIDED
- **Group chat messages use `BroadcastType`** - all participants see all messages (like a group chat)
- **Direct messages use `NotificationType`** - targeted to specific peers (1-on-1 conversations, agent prompts)
- **Read receipts & typing indicators use `NotificationType`** - targeted to specific peers to reduce noise
- **History requests use `RequestType`** - request/response pattern for syncing

This dual approach enables:
- **Group discussions** - Everyone sees the conversation (default chat)
- **Private conversations** - Direct messages between two peers (e.g., whispers)
- **Agent prompting** - Send a prompt directly to the agent peer without broadcasting to all participants

### 2. Message Types (Text, Code, File Links, System) ✅ DECIDED
- **Text**: Standard chat messages with optional markdown
- **Code snippets**: Share code with syntax highlighting and source references
- **File links**: Deep links to specific files/lines (click to open in editor)
- **System messages**: Generated from existing protocol events (joins, leaves, etc.)

**System Message Integration:**
The protocol already has `Messages.Room.Joined` and `Messages.Room.Left` broadcast events that announce when peers join or leave the collaboration session. The chat system should:
- Listen to these existing `Room.Joined` and `Room.Left` events
- Transform them into `SystemChatContent` messages for display in the chat UI
- This ensures consistency with the existing peer management system
- No duplication of peer tracking logic

Example implementation:
```typescript
// In chat client or UI layer
connection.room.onJoined((_, peer) => {
    // Create a system message for the chat UI
    const systemMessage: ChatMessage = {
        id: crypto.randomUUID(),
        author: 'system',
        timestamp: Date.now(),
        content: {
            type: 'system',
            event: 'peer-joined',
            params: { peerName: peer.name, peerId: peer.id }
        }
    };
    // Add to local chat history for display
    chatStore.addMessage(systemMessage);
});

connection.room.onLeft((_, peer) => {
    const systemMessage: ChatMessage = {
        id: crypto.randomUUID(),
        author: 'system',
        timestamp: Date.now(),
        content: {
            type: 'system',
            event: 'peer-left',
            params: { peerName: peer.name, peerId: peer.id }
        }
    };
    chatStore.addMessage(systemMessage);
});
```

### 3. Thread Support (Reply-To)
- Messages can reference `replyTo` field to create conversation threads
- UIs can render nested replies or "in-reply-to" indicators

### 4. Reactions
- Emoji reactions (like Slack/Discord) for lightweight feedback
- Stored as aggregated counts per emoji (not individual user lists in broadcast)

### 5. Message History & Late Joiners ✅ DECIDED
- **Host stores message history** - centralized storage at one location
- New peers can request history via `HistoryRequest`
- Peers sync their local history from the host
- Allows catching up on conversation context
- Simplest approach: single source of truth

### 6. Encryption & Privacy
- All chat messages automatically encrypted using existing protocol encryption
- Each message encrypted separately (forward secrecy)
- No server-side storage - messages live only in active session

### 7. Edit & Delete
- Messages can be edited or deleted after sending
- Edit/delete broadcasts include timestamp for conflict resolution
- Soft delete (message marked as deleted, not removed from history)

## Integration with Agent

The chat functionality would integrate with the existing agent in several ways:

### 0. Agent Identification ✅ DECIDED

**Current Implementation:**
The agent is already visible as a regular peer in the collaboration session. It joins like any other participant and receives a `Peer` identity with:
- `id`: Unique peer ID
- `name`: Agent's display name (e.g., "my-agent", "code-assistant")
- `host`: false (agent is a guest peer)
- `email`: Optional
- `metadata`: Contains encryption and compression settings

**Agent Discovery:**
The protocol does NOT currently have a `peerType` field in the `Peer` interface. To identify which peer is the agent, we have two options:

1. **Name-based identification (Simplest - Phase 1)**
   - Agent uses a recognizable naming pattern (e.g., "agent-*", "AI Agent", etc.)
   - Chat clients can identify agents by checking if `peer.name` contains "agent" or matches a pattern
   - UI can display "(AI Agent)" suffix next to the name
   - Example: "my-agent (AI Agent)"

2. **Extend PeerMetaData (Better - Future)**
   - Add optional `role?: 'agent' | 'user'` field to `PeerMetaData`
   - Agents would set `role: 'agent'` when joining
   - Chat clients can reliably identify agents via this field
   - Requires protocol changes

**Recommended Approach:**
Start with name-based identification (Option 1) for Phase 1 implementation. This requires no protocol changes and works with the existing system. Consider adding `role` to `PeerMetaData` in a future protocol version for more robust agent identification.

```typescript
// Phase 1: Name-based agent detection
function isAgentPeer(peer: Peer): boolean {
    return peer.name.toLowerCase().includes('agent') ||
           peer.name.startsWith('@');
}

// Display in UI
function formatPeerName(peer: Peer): string {
    return isAgentPeer(peer) ? `${peer.name} (AI Agent)` : peer.name;
}
```

### 1. Agent Participation in Chat
The agent could:
- **Respond to direct questions** in chat (e.g., "@agent explain this function")
- **Announce its actions** (e.g., "I've finished updating the calculateTotal function")
- **Ask for clarification** if prompts are ambiguous
- **Share code snippets** from its changes

Example in `agent.ts`:
```typescript
// Agent sends a message when starting work
await connection.chat.message({
    type: 'text',
    text: `Working on your request: "${prompt}"...`,
    format: 'plain'
});

// After applying changes
await connection.chat.message({
    type: 'code',
    code: changedCode,
    language: 'typescript',
    path: documentPath,
    range: { start: { line: startLine, character: 0 }, end: { line: endLine, character: 0 } }
});
```

### 2. Chat-Based Triggering ✅ DECIDED

**Implementation Approach: Direct Messages (Primary)**
Users send a direct message to the agent peer. This is the initial implementation approach.

**Future Consideration: @-Mentions in Group Chat**
Support for @-mentions in group chat can be added later for transparency when the whole team should see the agent's work.

**Phase 1 Implementation: Direct Messages Only**
Users send a direct message to the agent peer:
```typescript
// In the agent
documentSync.connection.chat.onDirectMessage(async (origin, message) => {
    if (message.recipient === this.agentPeerId && message.content.type === 'text') {
        const prompt = message.content.text;

        // Send acknowledgment
        await connection.chat.directMessage(
            { peerId: message.author },
            { type: 'text', text: `Working on: "${prompt}"` }
        );

        // Execute agent with prompt
        await executeAgentTask(prompt);

        // Send completion notification
        await connection.chat.directMessage(
            { peerId: message.author },
            { type: 'text', text: 'Task completed!' }
        );
    }
});
```

**Future: @-Mentions in Group Chat (Phase 2+)**
Users can @-mention the agent in group chat for transparent collaboration:
```typescript
// Future implementation - Phase 2
documentSync.connection.chat.onMessage(async (origin, message) => {
    if (message.content.type === 'text' &&
        (message.content.text.startsWith(`@${identity.name} `) ||
         message.content.text.includes(`@${identity.name}`))) {
        const prompt = message.content.text.replace(`@${identity.name}`, '').trim();

        // Respond in group chat
        await connection.chat.message({
            type: 'text',
            text: `Working on: "${prompt}"`,
            replyTo: message.id  // Reply to the original message
        });

        // Execute agent
        await executeAgentTask(prompt);
    }
});
```

**Rationale:** Start with direct messages for simplicity and focused communication. Add @-mentions later when transparency to the whole team is desired.

### 3. Conversational Context
The agent could use chat history as additional context:
- Understand multi-turn conversations
- Reference previous messages
- Build on earlier discussion

## Implementation Phases

### Phase 1: Core Protocol ✅ (Proposed above)
- Add type definitions to `types.ts`
- Add message definitions to `messages.ts`
- Add handler interface to `connection.ts`
- Implement chat handler in connection class

### Phase 2: Client Support (Future)
- Add chat UI components to VS Code/Theia extension
- Store local message history
- Implement read receipts and typing indicators
- Add notification preferences

### Phase 3: Agent Integration (Future)
- Agent listens to chat messages
- Agent responds with status updates
- Support for chat-based triggering
- Conversational interactions

### Phase 4: Advanced Features (Future)
- Persistent message history (optional server-side storage)
- File/image attachments
- Voice/video integration
- Chat commands (e.g., `/share-screen`)

## Benefits of This Approach

✅ **Follows existing patterns** - Uses established `BroadcastType`/`RequestType`/`NotificationType` patterns
✅ **Minimal protocol changes** - Only adds new message namespace, doesn't modify core
✅ **Encrypted by default** - Leverages existing encryption infrastructure
✅ **Extensible** - Content types and metadata allow future enhancements
✅ **Real-time** - Built on same transport as document sync (SocketIO/WebSocket)
✅ **Language-agnostic** - Works with any client implementing the protocol
✅ **Backwards compatible** - Existing clients ignore new message types
✅ **Rich feature set** - Supports modern chat features (threads, reactions, typing indicators)

## Alternative Considerations

### Option A: Separate Chat Service
- Run chat as a separate service (e.g., Matrix, XMPP)
- **Pros**: Mature protocols, rich clients
- **Cons**: More complexity, separate authentication, not integrated with collaboration

### Option B: Piggyback on Yjs Awareness
- Store chat messages in Yjs awareness state
- **Pros**: Simpler implementation, automatic sync
- **Cons**: Awareness is for ephemeral state, not persistent messages; messages would be lost on disconnect

### Option C: Use Document-Based Chat
- Create a special `.chat` document that users edit
- **Pros**: Reuses document sync infrastructure
- **Cons**: Awkward UX, no structured data, hard to implement features like reactions/threads

**Recommendation: Go with the proposed protocol extension** - it's the cleanest architectural fit.

## Package Architecture

### New Package: `open-collaboration-chat`

Similar to how `open-collaboration-monaco` provides Monaco-specific integration, we should create a new `open-collaboration-chat` package that provides:

```
packages/open-collaboration-chat/
├── src/
│   ├── index.ts                    # Main exports
│   ├── chat-client.ts              # Core chat client (UI-agnostic)
│   ├── message-store.ts            # Local message history storage
│   ├── types.ts                    # Chat-specific types
│   └── utils/
│       ├── message-renderer.ts     # Helpers for rendering messages
│       └── agent-detection.ts      # Detect if agent is in session
└── package.json
```

**Key responsibilities:**
- Provide a high-level chat client API that wraps the protocol's `ChatHandler`
- Manage local message history and state
- Provide hooks/events for UI frameworks to consume
- Handle message delivery, retries, and error states
- **UI-agnostic** - works with any framework (React, Vue, Angular, vanilla JS)

### Integration Pattern

```typescript
// Example usage in a web application
import { CollaborationClient } from 'open-collaboration-protocol';
import { ChatClient } from 'open-collaboration-chat';

// Connect to collaboration session
const client = new CollaborationClient(transportUrl);
await client.connect();

// Create chat client using the protocol connection
const chat = new ChatClient(client.connection);

// Listen for group messages
chat.onGroupMessage((message) => {
    console.log(`${message.author}: ${message.content}`);
    updateChatUI(message);
});

// Listen for direct messages (including from agent)
chat.onDirectMessage((message) => {
    if (isAgentPeer(message.author)) {
        showAgentResponse(message);
    } else {
        showPrivateMessage(message);
    }
});

// Send a group message
await chat.sendMessage({ type: 'text', text: 'Hello everyone!' });

// Send a direct message to the agent
const agentPeerId = chat.findPeerByType('agent');
if (agentPeerId) {
    await chat.sendDirectMessage(agentPeerId, {
        type: 'text',
        text: 'Refactor the calculateTotal function'
    });
}
```

### File Locations for Implementation

#### Protocol Changes (open-collaboration-protocol package)
- `/packages/open-collaboration-protocol/src/types.ts` - Add chat type definitions
- `/packages/open-collaboration-protocol/src/messages.ts` - Add `Messages.Chat` namespace
- `/packages/open-collaboration-protocol/src/connection.ts` - Add `ChatHandler` interface and implementation

#### New Package (open-collaboration-chat)
- `/packages/open-collaboration-chat/src/chat-client.ts` - Main chat client implementation
- `/packages/open-collaboration-chat/src/message-store.ts` - Message history management
- `/packages/open-collaboration-chat/src/types.ts` - Chat-specific types (UI models, events)

#### Agent Changes (open-collaboration-agent package)
- `/packages/open-collaboration-agent/src/agent.ts` - Add direct message listener for prompts
- Create new file: `/packages/open-collaboration-agent/src/chat-handler.ts` - Agent's chat behavior

## Next Steps

Choose one of these directions:

1. **Implement Phase 1** - Add the protocol types and message handlers to the protocol package
2. **Create a proof-of-concept** - Implement a simple CLI chat client to test the protocol
3. **Integrate with the agent** - Add chat awareness to the existing agent
4. **Design the UI** - Create mockups for how chat would appear in VS Code/Theia

## Developer Integration Scenarios

The chat functionality is designed to be flexible and work in various integration scenarios:

### Scenario 1: Web Application with Monaco Editor

```typescript
// app.ts - Web application
import { CollaborationClient } from 'open-collaboration-protocol';
import { CollaborationEditor } from 'open-collaboration-monaco';
import { ChatClient } from 'open-collaboration-chat';

// Setup Monaco editor
const editor = monaco.editor.create(document.getElementById('editor'), {
    value: 'console.log("Hello");',
    language: 'javascript'
});

// Connect to collaboration session
const client = new CollaborationClient('ws://localhost:3000');
await client.connect();

// Setup collaborative editing
const collabEditor = new CollaborationEditor(editor, client.connection);

// Setup chat (completely separate from editor)
const chat = new ChatClient(client.connection);

// Render chat UI in separate panel
const chatContainer = document.getElementById('chat-panel');
chat.onGroupMessage((message) => {
    renderMessage(chatContainer, message);
});

// User sends message via chat UI
document.getElementById('send-btn').addEventListener('click', () => {
    const text = document.getElementById('chat-input').value;
    chat.sendMessage({ type: 'text', text });
});
```

### Scenario 2: VS Code Extension

```typescript
// extension.ts - VS Code extension
import * as vscode from 'vscode';
import { CollaborationClient } from 'open-collaboration-protocol';
import { ChatClient } from 'open-collaboration-chat';

export function activate(context: vscode.ExtensionContext) {
    // Connect to collaboration
    const client = new CollaborationClient(sessionUrl);
    await client.connect();

    // Create chat client
    const chat = new ChatClient(client.connection);

    // Create chat view in sidebar
    const chatViewProvider = new ChatViewProvider(chat, context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('collaborationChat', chatViewProvider)
    );

    // Register command to send message to agent
    context.subscriptions.push(
        vscode.commands.registerCommand('collaboration.askAgent', async () => {
            const prompt = await vscode.window.showInputBox({
                prompt: 'Enter your request for the agent'
            });

            if (prompt) {
                const agentPeer = chat.findPeerByType('agent');
                if (agentPeer) {
                    await chat.sendDirectMessage(agentPeer, {
                        type: 'text',
                        text: prompt
                    });
                }
            }
        })
    );
}
```

### Scenario 3: Theia IDE Integration

```typescript
// chat-contribution.ts - Theia contribution
import { injectable } from 'inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { CollaborationService } from './collaboration-service';
import { ChatClient } from 'open-collaboration-chat';

@injectable()
export class ChatViewContribution extends AbstractViewContribution<ChatWidget> {
    constructor(
        @inject(CollaborationService) private collaborationService: CollaborationService
    ) {
        super({
            widgetId: ChatWidget.ID,
            widgetName: 'Collaboration Chat',
            defaultWidgetOptions: { area: 'right' }
        });
    }

    async initializeChat() {
        const connection = await this.collaborationService.getConnection();
        this.chatClient = new ChatClient(connection);

        // Listen for messages
        this.chatClient.onGroupMessage((message) => {
            this.widget.addMessage(message);
        });

        this.chatClient.onDirectMessage((message) => {
            this.widget.addDirectMessage(message);
        });
    }
}
```

### Scenario 4: Standalone Chat Application

```typescript
// Pure chat application (no editor)
import { CollaborationClient } from 'open-collaboration-protocol';
import { ChatClient } from 'open-collaboration-chat';

// Join collaboration room for chat only
const client = new CollaborationClient('ws://localhost:3000');
await client.connect({ room: 'team-chat-123' });

const chat = new ChatClient(client.connection);

// Build chat interface
chat.onGroupMessage((msg) => console.log(`[Group] ${msg.author}: ${msg.content}`));
chat.onDirectMessage((msg) => console.log(`[DM] ${msg.author}: ${msg.content}`));

// CLI-style chat
process.stdin.on('data', async (data) => {
    const input = data.toString().trim();

    if (input.startsWith('/dm ')) {
        // Direct message: /dm <peerId> <message>
        const [_, peerId, ...msgParts] = input.split(' ');
        await chat.sendDirectMessage(peerId, {
            type: 'text',
            text: msgParts.join(' ')
        });
    } else {
        // Group message
        await chat.sendMessage({ type: 'text', text: input });
    }
});
```

### Scenario 5: Agent with Chat Interface

```typescript
// agent-main.ts - Agent that participates in chat
import { Agent } from 'open-collaboration-agent';
import { ChatClient } from 'open-collaboration-chat';

// Start agent
const agent = new Agent({
    peerId: 'agent-001',
    peerType: 'agent',  // Mark as agent peer
    // ... other config
});

await agent.connect();

// Setup chat for the agent
const chat = new ChatClient(agent.connection);

// Listen for direct messages (prompts from users)
chat.onDirectMessage(async (message) => {
    if (message.content.type === 'text') {
        console.log(`Received prompt: ${message.content.text}`);

        // Acknowledge receipt
        await chat.sendDirectMessage(message.author, {
            type: 'text',
            text: `Starting work on: "${message.content.text}"`
        });

        // Execute the task
        try {
            await agent.executeTask(message.content.text);

            // Send completion message
            await chat.sendDirectMessage(message.author, {
                type: 'text',
                text: 'Task completed successfully!'
            });
        } catch (error) {
            // Send error message
            await chat.sendDirectMessage(message.author, {
                type: 'text',
                text: `Error: ${error.message}`
            });
        }
    }
});

// Optionally listen to group chat for @mentions
chat.onGroupMessage(async (message) => {
    if (message.content.type === 'text' &&
        (message.content.text.startsWith('@agent') || message.content.text.includes('@agent-001'))) {

        // Extract prompt
        const prompt = message.content.text.replace(/@agent(-\d+)?/g, '').trim();

        // Reply in group chat
        await chat.sendMessage({
            type: 'text',
            text: `Working on it! "${prompt}"`,
            replyTo: message.id
        });

        await agent.executeTask(prompt);
    }
});
```

### Key Architectural Benefits

1. **Separation of Concerns**: Chat is decoupled from editor integration
2. **Flexible Deployment**: Chat can be used with or without an editor
3. **Multiple UIs**: Same chat backend works with web, VS Code, Theia, CLI, etc.
4. **Agent Flexibility**: Agent can participate in chat regardless of where it's hosted
5. **Peer-to-Peer**: Direct messages enable private conversations and targeted agent prompts
6. **Protocol-Level**: All encryption, authentication, and transport handled by protocol layer

## Design Decisions Summary

This section summarizes all finalized design decisions for the chat implementation:

### ✅ Confirmed Decisions

1. **Agent Triggering (Decision #1)**
   - **Phase 1:** Direct messages only
   - **Future:** Add @-mentions in group chat for transparency
   - **Rationale:** Simplicity first, add complexity when needed

2. **Message History Storage (Decision #2)**
   - **Host stores message history** as single source of truth
   - Peers request history from host when joining
   - Peers maintain local cache for display
   - **Rationale:** Simplest approach, single source of truth, consistent with host-owned rooms

3. **System Messages (Decision #3)**
   - **Reuse existing protocol events:** `Messages.Room.Joined` and `Messages.Room.Left`
   - Transform these events into `SystemChatContent` at the chat client layer
   - No duplication of peer management logic
   - **Rationale:** Leverage existing infrastructure, ensure consistency

4. **Agent Identification (Decision #4)**
   - **Phase 1:** Name-based identification (check if peer name contains "agent")
   - Display as "agent-name (AI Agent)" in UI
   - **Future:** Consider adding `role` field to `PeerMetaData`
   - **Rationale:** No protocol changes needed for Phase 1, simple to implement

### Implementation Priority

1. **Phase 1: Core Protocol** - Add chat types, messages, and handlers to the protocol
2. **Phase 2: open-collaboration-chat Package** - Build UI-agnostic chat client
3. **Phase 3: Agent Integration** - Add direct message listener to agent
4. **Phase 4: Proof-of-Concept** - Build CLI chat client to validate design

## Notes

- This concept was created on 2025-10-10 during analysis of the existing Open Collaboration Tools codebase
- Updated 2025-10-13 with design decisions and clarifications about agent identification, system messages, and triggering approaches
- See `CODE_ANALYSIS.md` for detailed information about the current agent implementation
- The protocol already supports encryption, compression, and real-time synchronization - chat would leverage all of these
