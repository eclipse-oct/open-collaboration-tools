// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DocumentSyncOperations, LineEdit } from './document-operations.js';
import { AgentNotification, AgentRequest, AgentResponse, ClientRequest, ContentBlock, InitializeRequest, InitializeResponse, NewSessionRequest, NewSessionResponse, PermissionOption, PromptResponse, ReadTextFileRequest, RequestId, RequestPermissionRequest, SessionNotification, SessionUpdate, ToolCall, ToolCallUpdate, WriteTextFileRequest } from '@agentclientprotocol/sdk';

/**
 * Configuration for the tool whitelist
 */
export interface ToolWhitelistConfig {
    allowedKinds: string[];
    allowedToolNames: string[];
}

/**
 * Agent configuration loaded from oct-agent.config.json
 */
export interface AgentConfig {
    toolWhitelist: ToolWhitelistConfig;
}

/**
 * Default configuration used when no config file is found
 */
const DEFAULT_AGENT_CONFIG: AgentConfig = {
    toolWhitelist: {
        allowedKinds: ['read', 'edit'],
        allowedToolNames: ['mcp__acp__Read', 'mcp__acp__Edit', 'mcp__acp__Write']
    }
};

/**
 * Load agent configuration from file or return defaults
 */
function loadAgentConfig(configPath?: string): AgentConfig {
    const searchPath = configPath || path.join(process.cwd(), 'oct-agent.config.json');
    try {
        const content = fs.readFileSync(searchPath, 'utf8');
        const parsed = JSON.parse(content);
        console.log(`[ACP] Loaded config from ${searchPath}`);
        return {
            toolWhitelist: {
                allowedKinds: parsed.toolWhitelist?.allowedKinds ?? DEFAULT_AGENT_CONFIG.toolWhitelist.allowedKinds,
                allowedToolNames: parsed.toolWhitelist?.allowedToolNames ?? DEFAULT_AGENT_CONFIG.toolWhitelist.allowedToolNames
            }
        };
    } catch {
        console.log(`[ACP] No config file found at ${searchPath}, using defaults`);
        return DEFAULT_AGENT_CONFIG;
    }
}

/**
 * Extract tool name from a tool call (supports multiple agent formats)
 */
function extractToolName(toolCall: ToolCallUpdate): string | undefined {
    // Claude-Code-ACP format: _meta.claudeCode.toolName
    const claudeToolName = (toolCall._meta as any)?.claudeCode?.toolName;
    if (claudeToolName) return claudeToolName;
    // Additional agent formats can be added here
    return undefined;
}

/**
 * Extract tool kind from the title (e.g. "Write /path/to/file" -> "edit")
 * This is used as a fallback when kind is not set
 */
function extractKindFromTitle(title?: string): string | undefined {
    if (!title) return undefined;
    const firstWord = title.split(' ')[0]?.toLowerCase();
    // Map common title prefixes to ACP kinds
    const titleToKind: Record<string, string> = {
        'write': 'edit',
        'read': 'read',
        'edit': 'edit',
        'delete': 'delete',
        'move': 'move',
        'rename': 'move',
        'search': 'search',
        'execute': 'execute',
        'run': 'execute',
        'bash': 'execute',
    };
    return titleToKind[firstWord];
}

/**
 * Check if a tool call is allowed based on the configuration
 */
function isAllowedToolCall(toolCall: ToolCallUpdate, config: AgentConfig): boolean {
    // 1. Check kind (ACP standard field)
    if (toolCall.kind && config.toolWhitelist.allowedKinds.includes(toolCall.kind)) {
        return true;
    }
    // 2. Check tool name from _meta (agent-specific)
    const toolName = extractToolName(toolCall);
    if (toolName && config.toolWhitelist.allowedToolNames.includes(toolName)) {
        return true;
    }
    // 3. Fallback: extract kind from title (e.g. "Write /path" -> "edit")
    const kindFromTitle = extractKindFromTitle(toolCall.title ?? undefined);
    if (kindFromTitle && config.toolWhitelist.allowedKinds.includes(kindFromTitle)) {
        return true;
    }
    return false;
}

/**
 * ACP Bridge for connecting external agents via Agent Client Protocol
 *
 * This implementation communicates directly with ACP agents using JSON-RPC over stdio,
 * without using the full ACP SDK to keep the implementation simple and maintainable.
 */
export class ACPBridge {
    private childProcess?: ChildProcess;
    private isConnected = false;
    private sessionId?: string;
    private pendingPrompts = new Map<string, {
        resolve: (response: any) => void;
        reject: (error: Error) => void;
        accumulatedText?: string; // Accumulate text chunks for this request
        currentDocPath?: string; // Track the document path for this request
    }>();
    private messageBuffer = '';
    private requestIdCounter = 0;
    private pendingToolCalls = new Map<string, {
        toolCall: any;
        docPath: string;
    }>();
    private config: AgentConfig;

    constructor(
        private readonly acpAgentCommand: string,
        private documentOps?: DocumentSyncOperations,
        configPath?: string
    ) {
        this.config = loadAgentConfig(configPath);
    }

    /**
     * Start the ACP bridge by spawning the agent process and establishing connection
     */
    async start(): Promise<void> {
        if (this.isConnected) {
            throw new Error('ACP bridge is already started');
        }

        console.log(`🚀 Starting ACP agent: ${this.acpAgentCommand}`);

        // Parse the command (handle 'npx @zed-industries/claude-code-acp' format)
        const parts = this.acpAgentCommand.split(/\s+/);
        const command = parts[0];
        const args = parts.slice(1);

        // Spawn the child process
        this.childProcess = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
        });

        // Handle process errors
        this.childProcess.on('error', (error) => {
            console.error('❌ ACP agent process error:', error);
            this.isConnected = false;
        });

        // Handle process exit
        this.childProcess.on('exit', (code, signal) => {
            console.error(`⚠️ ACP agent process exited with code ${code}, signal ${signal}`);
            this.isConnected = false;
            if (code !== 0 && code !== null) {
                // Reject all pending prompts
                for (const { reject } of this.pendingPrompts.values()) {
                    reject(new Error(`ACP agent process exited with code ${code}`));
                }
                this.pendingPrompts.clear();
            }
        });

        // Handle stderr (for logging)
        this.childProcess.stderr?.on('data', (data) => {
            const message = data.toString();
            // Only log non-empty messages to avoid noise
            if (message.trim()) {
                console.error(`[ACP Agent] ${message.trim()}`);
            }
        });

        // Handle stdout - parse JSON-RPC messages
        this.childProcess.stdout?.on('data', (data: Buffer) => {
            const rawData = data.toString();
            console.error(`[ACP] Raw stdout data received (${rawData.length} bytes): ${rawData.substring(0, 200)}`);
            this.messageBuffer += rawData;
            this.processMessageBuffer();
        });

        // Wait a short moment for the agent process to be ready
        // Some agents need time to initialize before accepting requests
        await new Promise(resolve => setTimeout(resolve, 500));

        // Initialize ACP connection
        await this.initializeACP();

        this.isConnected = true;
        console.log('✅ ACP bridge connected');
    }

    /**
     * Initialize ACP connection: initialize and create session
     */
    private async initializeACP(): Promise<void> {
        // Send initialize request
        const initRequestId = this.getNextRequestId();
        const initResponse = await this.sendRequest<InitializeRequest>({
            jsonrpc: '2.0',
            id: String(initRequestId),
            method: 'initialize',
            params: {
                protocolVersion: 1, // ACP protocol version (must be a number)
                clientInfo: {
                    name: 'oct-agent',
                    version: '0.3.0',
                },
                clientCapabilities: {
                    fs: {
                        readTextFile: true,
                        writeTextFile: true,
                    },
                },
            },
        });

        if ('error' in initResponse) {
            throw new Error(`Failed to initialize: ${initResponse.error.message || 'Unknown error'}`);
        }
        const result = initResponse.result as InitializeResponse;
        console.error(`[ACP] Initialized with protocol version: ${result?.protocolVersion || 'unknown'}`);
        console.info("Init Response: ", initResponse);

        // Try to create a session, but handle the case where session/new method doesn't exist
        try {
            const sessionRequestId = this.getNextRequestId();

            // Build session params - use local workspace
            const sessionParams: NewSessionRequest = {
                mcpServers: [],
                cwd: process.cwd()
            };

            console.error(`[ACP] Creating session with local workspace: ${process.cwd()}`);

            const sessionResponse = await this.sendRequest<NewSessionRequest>({
                jsonrpc: '2.0',
                id: String(sessionRequestId),
                method: 'session/new',
                params: sessionParams,
            });

            if ('error' in sessionResponse) {
                throw new Error(`Failed to create session: ${sessionResponse.error.message || 'Unknown error'}`);
            }

            console.error(`[ACP] Session created: `, JSON.stringify(sessionResponse, null, 2));
            const result = sessionResponse.result as NewSessionResponse;
            this.sessionId = result?.sessionId;
            if (this.sessionId) {
                console.error(`[ACP] Created session: ${this.sessionId}`);
            } else {
                console.error(`[ACP] Session creation returned no session ID, continuing without explicit session`);
            }
        } catch (error: any) {
            // If session/new method doesn't exist, that's okay - some ACP agents
            // may not require explicit session creation
            if (error.message?.includes('Method not found') || error.message?.includes('session/new')) {
                console.error(`[ACP] session/new method not available, continuing without explicit session`);
            } else {
                // Re-throw other errors
                throw error;
            }
        }
    }

    /**
     * Get next request ID
     */
    private getNextRequestId(): number {
        return ++this.requestIdCounter;
    }

    /**
     * Send a JSON-RPC request and wait for response
     */
    private sendRequest<T>(request: ClientRequest & { params: T; jsonrpc?: string }): Promise<AgentResponse> {
        return new Promise((resolve, reject) => {
            const requestId = request.id;
            const timeout = setTimeout(() => {
                this.pendingPrompts.delete(String(requestId));
                reject(new Error(`Request ${requestId} timed out`));
            }, 30000); // 30 second timeout

            // Store response handler BEFORE sending request
            this.pendingPrompts.set(String(requestId), {
                resolve: (response: AgentResponse) => {
                    clearTimeout(timeout);
                    resolve(response);
                },
                reject: (error: Error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });

            // Send request
            this.sendMessage(request);
        });
    }

    /**
     * Process incoming message buffer, parsing newline-delimited JSON messages
     */
    private processMessageBuffer(): void {
        const lines = this.messageBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        this.messageBuffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const message = JSON.parse(line);
                console.error(`[ACP] Received: ${line.trim()}`);

                // Route based on message type
                if (message.id !== undefined && message.method === undefined) {
                    // Response to our request
                    this.handleResponse(message);
                } else {
                    // Request/notification from agent
                    this.handleAgentRequest(message);
                }
            } catch (error) {
                console.error(`[ACP] Failed to parse message: ${line}`, error);
            }
        }
    }

    /**
     * Handle responses to requests sent by the bridge
     */
    private handleResponse(message: AgentResponse): void {
        // This is a response (has id but no method)
        const requestId = String(message.id);
        const pending = this.pendingPrompts.get(requestId);
        if (pending) {
            this.pendingPrompts.delete(requestId);
            if ('error' in message) {
                pending.reject(new Error(message.error.message || 'ACP request failed'));
            } else if ('result' in message) {
                // Combine accumulated text with the result
                const result = message.result as PromptResponse;
                const accumulatedText = pending.accumulatedText || '';

                // Format response for processACPResponse
                // If we have accumulated text, format as agent/response
                if (accumulatedText) {
                    if (accumulatedText.trim()) {
                        void this.documentOps?.getConnection().chat.sendMessage(accumulatedText);
                    }
                    pending.resolve({
                        type: 'agent/response',
                        content: accumulatedText,
                        stopReason: result.stopReason,
                    });
                } else if (result.stopReason) {
                    // If we have a stopReason but no text, still format as response
                    // (empty response is valid)
                    pending.resolve({
                        type: 'agent/response',
                        content: '',
                        stopReason: result.stopReason,
                    });
                } else {
                    // Fallback: return the result as-is
                    pending.resolve(result);
                }
            }
        }
    }

    private isAgentRequest(message: AgentRequest | AgentNotification): message is AgentRequest {
        return 'id' in message && 'method' in message && 'params' in message;
    }

    private isAgentNotification(message: AgentRequest | AgentNotification): message is AgentNotification {
        return 'method' in message && 'params' in message && !('id' in message);
    }

    /**
     * Handle permission requests from the agent
     * This is a CLIENT method - the agent requests permission from the client
     */
    private handlePermissionRequest(messageId: RequestId, params: RequestPermissionRequest): void {
        console.info(`[ACP] Handling permission request: ${messageId}`);
        const toolCallId = params.toolCall.toolCallId;
        const options = params.options || [];

        // Helper: Send ACP-conformant permission response
        const sendPermissionResponse = (optionId: string) => {
            this.sendMessage({
                jsonrpc: '2.0',
                id: messageId,
                result: {
                    outcome: {
                        outcome: 'selected',
                        optionId
                    }
                },
            });
        };

        // Find allow and deny options from the provided options
        const allowOption = options.find((opt: PermissionOption) =>
            opt.optionId === 'allow_once' ||
            opt.optionId === 'allow'
        ) || options[0];
        const denyOption = options.find((opt: PermissionOption) =>
            opt.optionId === 'deny' ||
            opt.optionId === 'reject_once'
        ) || options[options.length - 1];

        // Get the full tool call data (from pendingToolCalls if available, otherwise from params)
        // pendingToolCalls contains the complete data from tool_call_update (with title, kind, etc.)
        const pendingToolCall = this.pendingToolCalls.get(toolCallId);
        const toolCallForCheck = pendingToolCall?.toolCall ?? params.toolCall;

        // Security check: Only allow whitelisted tool calls
        if (!isAllowedToolCall(toolCallForCheck, this.config)) {
            const toolName = extractToolName(toolCallForCheck) || 'unknown';
            const toolKind = toolCallForCheck.kind || extractKindFromTitle(toolCallForCheck.title) || 'unknown';
            const toolTitle = toolCallForCheck.title || 'no title';
            console.error(`[ACP] Denying tool call ${toolCallId}: kind="${toolKind}", name="${toolName}", title="${toolTitle}" not in whitelist`);
            sendPermissionResponse(denyOption?.optionId || 'deny');
            return;
        }

        if (pendingToolCall) {
            // Known tool call - approve (actual write happens via fs/write_text_file)
            const selectedOptionId = allowOption?.optionId || 'allow_once';
            console.error(`[ACP] Approving known tool call ${toolCallId} with option ${selectedOptionId}`);
            sendPermissionResponse(selectedOptionId);
            this.pendingToolCalls.delete(toolCallId);
        } else {
            // Unknown tool call (permission request came before tool_call_update)
            // Try to find docPath and approve if possible
            console.error(`[ACP] Tool call ${toolCallId} not in pendingToolCalls, attempting fallback`);

            // Get docPath from pending prompts or active document
            let currentDocPath: string | undefined;
            const pendingEntries = Array.from(this.pendingPrompts.entries());
            if (pendingEntries.length > 0) {
                const [, pending] = pendingEntries[pendingEntries.length - 1];
                currentDocPath = pending.currentDocPath;
            }
            if (!currentDocPath && this.documentOps) {
                currentDocPath = this.documentOps.getActiveDocumentPath();
            }

            if (currentDocPath && this.documentOps) {
                // Approve (actual write happens via fs/write_text_file)
                const selectedOptionId = allowOption?.optionId || 'allow_once';
                console.error(`[ACP] Approving unknown tool call ${toolCallId} with fallback docPath ${currentDocPath}`);
                sendPermissionResponse(selectedOptionId);
            } else {
                // Cannot determine where to apply - deny
                console.error(`[ACP] Denying tool call ${toolCallId}: no docPath available`);
                sendPermissionResponse(denyOption?.optionId || 'deny');
            }
        }
    }

    /**
     * Handle tool call updates - convert to edits in current document
     */
    private handleToolCallUpdate(update: ToolCall | ToolCallUpdate): void {
        console.info(`[ACP] Handling tool call update: ${update}`);
        const toolCallId = update.toolCallId;
        // Get the current document path from the most recent pending prompt
        const pendingEntries = Array.from(this.pendingPrompts.entries());
        console.info(`[ACP] Pending entries: ${pendingEntries}`);
        let currentDocPath: string | undefined;
        if (pendingEntries.length > 0) {
            const [, pending] = pendingEntries[pendingEntries.length - 1];
            currentDocPath = pending.currentDocPath;
        }
        // Fallback to active document if available
        if (!currentDocPath && this.documentOps) {
            currentDocPath = this.documentOps.getActiveDocumentPath();
        }
        if (currentDocPath) {
            // Store the tool call for when permission is granted
            this.pendingToolCalls.set(toolCallId, {
                toolCall: update,
                docPath: currentDocPath,
            });
            console.error(`[ACP] Stored tool_call ${toolCallId} for document ${currentDocPath}`);
        } else {
            console.error(`⚠️ Received tool_call but no document path available`);
        }
    }

    /**
     * Handle agent message chunk updates - accumulate text
     */
    private handleAgentMessageChunk(content: ContentBlock): void {
        console.info(`[ACP] Handling agent message chunk: ${content}`);
        if (content.type === 'text' && typeof content.text === 'string') {
            // Keep the chat UI in writing mode while chunks are still streaming.
            void this.documentOps?.getConnection().chat.isWriting();
            console.info(`[ACP] Received text chunk (${content.text.length} chars)`);
            // Find the most recent pending prompt (for the current request)
            const pendingEntries = Array.from(this.pendingPrompts.entries());
            if (pendingEntries.length > 0) {
                const [requestId, pending] = pendingEntries[pendingEntries.length - 1];
                if (pending) {
                    // Accumulate the text chunk
                    if (!pending.accumulatedText) {
                        pending.accumulatedText = '';
                    }
                    pending.accumulatedText += content.text;
                    console.error(`[ACP] Accumulated text chunk for request ${requestId}, total length: ${pending.accumulatedText.length}`);
                }
            } else {
                console.error(`⚠️ Received agent_message_chunk but no pending prompt found`);
            }
        }
    }

    /**
     * Handle session update notifications from the agent
     */
    private handleSessionUpdate(params: SessionNotification): void {
        const update: SessionUpdate = params.update;
        const notificationSessionId = params.sessionId;

        // If we receive a sessionId in the notification but don't have one stored, store it
        if (notificationSessionId && !this.sessionId) {
            console.error(`[ACP] Received sessionId from notification: ${notificationSessionId}, storing it`);
            this.sessionId = notificationSessionId;
        }

        // Verify session ID matches (if we have one set)
        if (this.sessionId && notificationSessionId && notificationSessionId !== this.sessionId) {
            console.error(`⚠️ Received session/update for different session: ${notificationSessionId} (expected ${this.sessionId})`);
            return;
        }

        // Route to appropriate handler based on update type
        if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
            this.handleToolCallUpdate(update);
        } else if (update.sessionUpdate === 'agent_message_chunk' && update.content) {
            this.handleAgentMessageChunk(update.content);
        }
    }

    /**
     * Handle requests and notifications from the agent
     */
    private handleAgentRequest(message: AgentRequest | AgentNotification): void {
        if (this.isAgentRequest(message)) {
            // Route to appropriate handler based on method
            if (message.method === 'fs/read_text_file' || message.method === 'fs/write_text_file') {
                // Handle asynchronously but don't block
                this.handleFileSystemRequest(message).catch((error) => {
                    console.error(`[ACP] Error handling file system request: ${error}`);
                    this.sendMessage({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: {
                            code: -32603,
                            message: `Internal error: ${error.message || 'Unknown error'}`,
                        },
                    });
                });
            } else if (message.method === 'session/request_permission') {
                this.handlePermissionRequest(message.id, message.params as RequestPermissionRequest);
            }
        } else if (this.isAgentNotification(message)) {
            if (message.method === 'session/update') {
                this.handleSessionUpdate(message.params as SessionNotification);
            }
        }
    }

    private getAbsoluteFilePath(message: AgentRequest): string | undefined {
        const params = message.params as WriteTextFileRequest | ReadTextFileRequest;
        const filePath = params.path;

        if (!filePath) {
            this.sendMessage({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: -32602,
                    message: 'Missing required parameter: path',
                },
            });
            return;
        }

        // Normalize path relative to cwd
        const normalizedPath = path.normalize(filePath);
        const absolutePath = path.isAbsolute(normalizedPath)
            ? normalizedPath
            : path.resolve(process.cwd(), normalizedPath);

        // Security check: ensure path is within workspace
        const workspaceRoot = path.normalize(process.cwd());
        if (!absolutePath.startsWith(workspaceRoot)) {
            this.sendMessage({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: -32602,
                    message: `File path ${filePath} is not within workspace`,
                },
            });
            return;
        }

        return absolutePath;
    }

    /**
     * Handle File System requests from agent
     * Read from local filesystem, write to OCT session for synchronization
     */
    private async handleFileSystemRequest(message: AgentRequest): Promise<void> {
        console.info(`[ACP] Handling file system request: ${message.method}`);
        if (!this.documentOps) {
            this.sendMessage({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: -32603,
                    message: 'DocumentOps not available',
                },
            });
            return;
        }


        if (message.method === 'fs/read_text_file') {
            // Read file - try OCT document first, fallback to local filesystem
            try {
                const absolutePath = this.getAbsoluteFilePath(message);
                if (!absolutePath) {
                    return;
                }

                // Convert to OCT document path (includes workspace name)
                const workspaceName = path.basename(process.cwd());
                const octPath = path.join(workspaceName, path.relative(process.cwd(), absolutePath));

                // Try OCT document first, fallback to local filesystem
                let content = this.documentOps?.getDocument(octPath);
                if (content === undefined) {
                    content = fs.readFileSync(absolutePath, 'utf8');
                    console.error(`[ACP] Read file from filesystem (not in OCT): ${absolutePath}`);
                } else {
                    console.error(`[ACP] Read file from OCT document: ${octPath}`);
                }

                // Handle optional line and limit parameters
                let resultContent = content;
                const params = message.params as ReadTextFileRequest;
                const lines = content.split('\n');
                const startLine = Math.max(0, (params.line ?? 0) - 1); // Convert to 0-based
                const limit = params.limit ?? lines.length;
                const endLine = Math.min(startLine + limit, lines.length);
                resultContent = lines.slice(startLine, endLine).join('\n');
                console.info(`[ACP] Sending file system response: ${resultContent}`);
                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: resultContent,
                    },
                });
            } catch (error: any) {
                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32603,
                        message: `File not found or not readable: ${error.message || 'Unknown error'}`,
                    },
                });
            }
        } else if (message.method === 'fs/write_text_file') {
            // Write file to OCT document for synchronization
            const absolutePath = this.getAbsoluteFilePath(message);
            if (!absolutePath) {
                return;
            }
            console.info(`[ACP] Writing file to OCT document: ${absolutePath}`);
            const newContent = (message.params as WriteTextFileRequest).content;
            console.info(`[ACP] New content: ${newContent}`);
            if (newContent === undefined) {
                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32602,
                        message: 'Missing required parameter: content',
                    },
                });
                return;
            }

            // Use relative path from workspace root as OCT document path
            // OCT uses workspace name as prefix, so we need to include it
            const workspaceName = path.basename(process.cwd());
            const octPath = path.join(workspaceName, path.relative(process.cwd(), absolutePath));
            console.info(`[ACP] OCT path: ${octPath}`);
            // Get current content (try OCT first, fallback to local filesystem)
            let currentContent = this.documentOps.getDocument(octPath);
            console.info(`[ACP] Current content: ${currentContent}`);
            if (currentContent === undefined) {
                // Try reading from local filesystem
                console.info(`[ACP] No content in OCT, reading from local filesystem: ${absolutePath}`);
                try {
                    currentContent = fs.readFileSync(absolutePath, 'utf8');
                } catch (error: any) {
                    console.info(`[ACP] Error reading from local filesystem: ${error.message}`);
                    currentContent = ''; // New file
                }
            }

            // Compute minimal edits by finding common prefix/suffix
            const lineEdits = this.computeMinimalEdits(currentContent, newContent);

            if (lineEdits.length === 0) {
                console.info(`[ACP] No changes detected, skipping write`);
                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: null,
                });
                return;
            }

            console.info(`[ACP] Applying ${lineEdits.length} minimal edits (lines ${lineEdits[0]?.startLine}-${lineEdits[0]?.endLine})`);

            try {
                // Write to OCT session - this synchronizes with all participants
                await this.documentOps.applyEditsAnimated(octPath, lineEdits);

                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: null,
                });
                console.error(`[ACP] Wrote file via FS API to OCT session: ${octPath}`);
            } catch (error: any) {
                console.info(`[ACP] Error writing file: ${error.message}`);
                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32603,
                        message: `Failed to write file: ${error.message || 'Unknown error'}`,
                    },
                });
            }
        }
    }

    /**
     * Compute minimal line edits by finding common prefix and suffix
     */
    private computeMinimalEdits(currentContent: string, newContent: string): LineEdit[] {
        // Finde gemeinsames Prefix (gleiche Zeilen am Anfang)
        const currentLines = currentContent.split('\n');
        const newLines = newContent.split('\n');

        let prefixLength = 0;
        while (prefixLength < currentLines.length &&
            prefixLength < newLines.length &&
            currentLines[prefixLength] === newLines[prefixLength]) {
            prefixLength++;
        }

        // Finde gemeinsames Suffix (gleiche Zeilen am Ende)
        let suffixLength = 0;
        while (suffixLength < (currentLines.length - prefixLength) &&
            suffixLength < (newLines.length - prefixLength) &&
            currentLines[currentLines.length - 1 - suffixLength] ===
            newLines[newLines.length - 1 - suffixLength]) {
            suffixLength++;
        }

        // Berechne den zu ersetzenden Bereich
        const startLine = prefixLength + 1; // 1-indexed
        const endLine = currentLines.length - suffixLength;
        const replacementLines = newLines.slice(prefixLength, newLines.length - suffixLength);

        if (startLine > endLine && replacementLines.length === 0) {
            return []; // Keine Änderungen
        }

        return [{
            type: 'replace',
            startLine,
            endLine: Math.max(startLine, endLine),
            content: replacementLines.join('\n'),
        }];
    }

    /**
     * Send a JSON-RPC message to the agent
     */
    private sendMessage(message: any): void {
        if (!this.childProcess?.stdin) {
            throw new Error('ACP bridge is not connected');
        }

        const json = JSON.stringify(message) + '\n';
        console.error(`[ACP] Sending: ${json.trim()}`);
        this.childProcess.stdin.write(json, 'utf8');
    }

    /**
     * Stop the ACP bridge and terminate the agent process
     */
    async stop(): Promise<void> {
        if (!this.isConnected) {
            return;
        }

        console.log('🛑 Stopping ACP bridge...');

        // Reject all pending prompts
        for (const { reject } of this.pendingPrompts.values()) {
            reject(new Error('ACP bridge stopped'));
        }
        this.pendingPrompts.clear();

        // Terminate child process
        if (this.childProcess) {
            this.childProcess.kill();
            this.childProcess = undefined;
        }

        this.isConnected = false;
        console.log('✅ ACP bridge stopped');
    }

    /**
     * Normalize whitespace for text matching (handles different newline counts)
     */
    /**
     * Get MIME type for a file based on its extension
     */
    private getMimeType(filepath: string): string {
        const ext = path.extname(filepath).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.ts': 'text/typescript',
            '.tsx': 'text/typescript',
            '.js': 'text/javascript',
            '.jsx': 'text/javascript',
            '.json': 'application/json',
            '.md': 'text/markdown',
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.css': 'text/css',
            '.xml': 'text/xml',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
            '.py': 'text/x-python',
            '.java': 'text/x-java',
            '.c': 'text/x-c',
            '.cpp': 'text/x-c++',
            '.h': 'text/x-c',
            '.hpp': 'text/x-c++',
            '.go': 'text/x-go',
            '.rs': 'text/x-rust',
            '.sh': 'text/x-shellscript',
            '.bash': 'text/x-shellscript',
        };
        return mimeTypes[ext] || 'text/plain';
    }

    /**
     * Send a prompt to the ACP agent using standard ACP protocol
     *
     * The prompt includes:
     * - A text content block with the user's prompt
     * - A resource_link content block identifying the currently active file
     *
     * Example output:
     * ```json
     * {
     *   "jsonrpc": "2.0",
     *   "id": 1,
     *   "method": "session/prompt",
     *   "params": {
     *     "sessionId": "session-123",
     *     "prompt": [
     *       {
     *         "type": "text",
     *         "text": "Fix the bug in this function"
     *       },
     *       {
     *         "type": "resource_link",
     *         "uri": "file:///path/to/file.ts",
     *         "name": "file.ts",
     *         "mimeType": "text/typescript",
     *         "size": 1024
     *       }
     *     ]
     *   }
     * }
     * ```
     *
     * @returns Promise that resolves with the agent's response
     */
    async sendTrigger(trigger: {
        id: string;
        source: {
            type: 'document';
            path: string;
            line: number;
        };
        content: {
            prompt: string;
            context?: string;
        };
    }): Promise<AgentResponse> {
        if (!this.isConnected) {
            throw new Error('ACP bridge is not connected');
        }

        const requestId = this.getNextRequestId();

        return new Promise((resolve, reject) => {
            // Store the promise handlers using request ID, including the document path
            // trigger.source.path is already an OCT path with workspace name prefix
            this.pendingPrompts.set(String(requestId), {
                resolve,
                reject,
                currentDocPath: trigger.source.path, // OCT document path for tool call correlation
            });

            // Build params - sessionId is optional if the agent doesn't require it
            const promptContent: any[] = [
                {
                    type: 'text',
                    text: trigger.content.prompt,
                },
            ];

            // Add resource_link for the current document
            try {
                // Convert OCT path to absolute file path
                // OCT paths include workspace name as prefix, so resolve from parent directory
                const absolutePath = path.resolve(path.dirname(process.cwd()), trigger.source.path);
                const filename = path.basename(absolutePath);
                const mimeType = this.getMimeType(absolutePath);

                // Get file size (optional)
                let fileSize: number | undefined;
                try {
                    const stats = fs.statSync(absolutePath);
                    fileSize = stats.size;
                } catch {
                    // File size is optional, continue without it
                }

                // Add resource_link to prompt
                const resourceLink: any = {
                    type: 'resource_link',
                    uri: `file://${absolutePath}`,
                    name: filename,
                    mimeType: mimeType,
                };

                // Add size if available
                if (fileSize !== undefined) {
                    resourceLink.size = fileSize;
                }

                promptContent.push(resourceLink);
                console.error(`[ACP] Added resource_link for ${filename} (${mimeType})`);
            } catch (error: any) {
                console.error(`[ACP] Failed to create resource_link: ${error.message}`);
                // Continue without resource_link if there's an error
            }

            const params: any = {
                prompt: promptContent,
            };

            // Only include sessionId if we have one
            if (this.sessionId) {
                params.sessionId = this.sessionId;
                console.error(`[ACP] Sending prompt with sessionId: ${this.sessionId}`);
            } else {
                throw new Error('Cannot send session/prompt: sessionId is required but not set. Ensure session was created successfully.');
            }

            console.error(`[ACP] Sending prompt with params: ${JSON.stringify(params, null, 2)}`);

            // Send prompt request using standard ACP protocol
            this.sendMessage({
                jsonrpc: '2.0',
                id: requestId,
                method: 'session/prompt',
                params,
            });
        });
    }

    /**
     * Check if the bridge is connected
     */
    get connected(): boolean {
        return this.isConnected;
    }
}
/**
 * Hello World function
 * @returns A friendly greeting message
 */
export function helloWorld(): string {
    return 'Hello, World!';
}
