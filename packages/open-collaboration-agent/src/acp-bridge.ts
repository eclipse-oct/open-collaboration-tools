// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DocumentSyncOperations, LineEdit } from './document-operations.js';
import { AgentResponse, ClientRequest, InitializeRequest, InitializeResponse, NewSessionRequest, NewSessionResponse } from '@agentclientprotocol/sdk';

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

    constructor(
        private readonly acpAgentCommand: string,
        private documentOps?: DocumentSyncOperations
    ) { }

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
            const sessionParams: any = {
                mcpServers: [],
                cwd: process.cwd(),
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
                resolve: (response: any) => {
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
    private handleResponse(message: any): void {
        // This is a response (has id but no method)
        const requestId = String(message.id);
        const pending = this.pendingPrompts.get(requestId);
        if (pending) {
            this.pendingPrompts.delete(requestId);
            if (message.error) {
                pending.reject(new Error(message.error.message || 'ACP request failed'));
            } else {
                // Combine accumulated text with the result
                const result = message.result || {};
                const accumulatedText = pending.accumulatedText || '';

                // Format response for processACPResponse
                // If we have accumulated text, format as agent/response
                if (accumulatedText) {
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

    /**
     * Handle permission requests from the agent
     * This is a CLIENT method - the agent requests permission from the client
     */
    private handlePermissionRequest(message: any): void {
        const params = message.params;
        if (params && params.toolCall) {
            // Extract toolCallId - it might be in toolCall.toolCallId or toolCall.id
            const toolCallId = params.toolCall.toolCallId || params.toolCall.id;
            const pendingToolCall = this.pendingToolCalls.get(toolCallId);
            if (pendingToolCall) {
                // Auto-approve permission requests
                // Find the "allow" option from the provided options
                const options = params.options || [];
                const allowOption = options.find((opt: any) =>
                    opt.id === 'allow_once' ||
                    opt.id === 'allow' ||
                    opt.optionId === 'allow_once' ||
                    opt.optionId === 'allow'
                ) || options[0]; // Fallback to first option if no allow found

                const selectedOptionId = allowOption?.id || allowOption?.optionId || 'allow_once';

                console.error(`[ACP] Auto-approving tool call ${toolCallId} with option ${selectedOptionId}`);

                // Respond with JSON-RPC response (not a method call)
                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        optionId: selectedOptionId,
                    },
                });

                // Apply the tool call edit immediately
                this.applyToolCallEdit(pendingToolCall.toolCall, pendingToolCall.docPath);
                this.pendingToolCalls.delete(toolCallId);
            } else {
                console.error(`⚠️ Received permission request for unknown tool call ${toolCallId}`);
                // Still respond to avoid hanging the agent
                const options = params.options || [];
                const denyOption = options.find((opt: any) =>
                    opt.id === 'deny' ||
                    opt.id === 'reject_once' ||
                    opt.optionId === 'deny' ||
                    opt.optionId === 'reject_once'
                ) || options[options.length - 1]; // Fallback to last option (usually deny)

                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        optionId: denyOption?.id || denyOption?.optionId || 'deny',
                    },
                });
            }
        }
    }

    /**
     * Handle tool call updates - convert to edits in current document
     */
    private handleToolCallUpdate(update: any): void {
        const toolCallId = update.toolCallId;
        // Get the current document path from the most recent pending prompt
        const pendingEntries = Array.from(this.pendingPrompts.entries());
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
    private handleAgentMessageChunk(update: any): void {
        const content = update.content;
        if (content.type === 'text' && typeof content.text === 'string') {
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
     * Handle agent notification (agent/action or agent/response)
     */
    private handleAgentNotification(params: any): void {
        // Try to find pending prompt by session ID or other correlation
        const firstPending = Array.from(this.pendingPrompts.values())[0];
        if (firstPending) {
            // Remove it from map (we'll need better correlation)
            this.pendingPrompts.delete(Array.from(this.pendingPrompts.keys())[0]);
            firstPending.resolve(params);
        } else {
            console.error(`⚠️ Received ${params.type} but no pending prompt found`);
        }
    }

    /**
     * Handle session update notifications from the agent
     */
    private handleSessionUpdate(message: any): void {
        const params = message.params;
        if (params && params.update) {
            const update = params.update;
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
            if (update.sessionUpdate === 'tool_call' && update.kind === 'edit' && update.content) {
                this.handleToolCallUpdate(update);
            } else if (update.sessionUpdate === 'agent_message_chunk' && update.content) {
                this.handleAgentMessageChunk(update);
            } else if (params.type === 'agent/action' || params.type === 'agent/response') {
                this.handleAgentNotification(params);
            }
        }
    }

    /**
     * Handle requests and notifications from the agent
     */
    private handleAgentRequest(message: any): void {
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
            this.handlePermissionRequest(message);
        } else if (message.method === 'session/update') {
            this.handleSessionUpdate(message);
        }
    }

    /**
     * Handle File System requests from agent
     * Read from local filesystem, write to OCT session for synchronization
     */
    private async handleFileSystemRequest(message: any): Promise<void> {
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

        const params = message.params || {};
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

        if (message.method === 'fs/read_text_file') {
            // Read file from local filesystem
            try {
                let content = fs.readFileSync(absolutePath, 'utf8');

                // Remove cursor markers (|, /, etc.) from awareness system
                // These markers are used for cursor position tracking but should not be sent to the agent
                content = content.replace(/[|/]/g, '');

                // Handle optional line and limit parameters
                let resultContent = content;
                if (params.line !== undefined || params.limit !== undefined) {
                    const lines = content.split('\n');
                    const startLine = params.line !== undefined ? Math.max(0, params.line - 1) : 0; // Convert to 0-based
                    const limit = params.limit !== undefined ? params.limit : lines.length;
                    const endLine = Math.min(startLine + limit, lines.length);
                    resultContent = lines.slice(startLine, endLine).join('\n');
                }

                this.sendMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: resultContent,
                    },
                });
                console.error(`[ACP] Read file via FS API: ${filePath}`);
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
            const newContent = params.content;
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
            const octPath = path.relative(workspaceRoot, absolutePath);

            // Get current content (try OCT first, fallback to local filesystem)
            let currentContent = this.documentOps.getDocument(octPath);
            if (currentContent === undefined) {
                // Try reading from local filesystem
                try {
                    currentContent = fs.readFileSync(absolutePath, 'utf8');
                } catch {
                    currentContent = ''; // New file
                }
            }

            // Replace entire document content
            // We need to create a replace edit that replaces everything
            const lineEdits: LineEdit[] = [{
                type: 'replace',
                startLine: 1,
                endLine: currentContent.split('\n').length || 1,
                content: newContent,
            }];

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
    private normalizeWhitespace(text: string): string {
        // Normalize multiple consecutive newlines to single newline
        return text.replace(/\n{2,}/g, '\n').trim();
    }

    /**
     * Find text in document with fuzzy matching (handles whitespace differences)
     */
    private findTextInDocument(document: string, searchText: string): { startIndex: number; endIndex: number } | null {
        // First try exact match
        let startIndex = document.indexOf(searchText);
        if (startIndex !== -1) {
            return { startIndex, endIndex: startIndex + searchText.length };
        }

        // Try normalized whitespace match
        const normalizedDoc = this.normalizeWhitespace(document);
        const normalizedSearch = this.normalizeWhitespace(searchText);
        const normalizedIndex = normalizedDoc.indexOf(normalizedSearch);
        if (normalizedIndex !== -1) {
            // Map back to original document - approximate position
            // This is a heuristic: find the closest match in original text
            const docLines = document.split('\n');
            const searchLines = searchText.split('\n');

            // Try to find by matching first line and subsequent lines
            if (searchLines.length > 0) {
                const firstLine = searchLines[0].trim();

                for (let i = 0; i < docLines.length; i++) {
                    if (docLines[i].trim() === firstLine) {
                        // Found start, check if subsequent lines match
                        let match = true;
                        for (let j = 0; j < searchLines.length && i + j < docLines.length; j++) {
                            if (docLines[i + j].trim() !== searchLines[j].trim()) {
                                match = false;
                                break;
                            }
                        }
                        if (match) {
                            // Calculate offsets
                            const beforeStart = docLines.slice(0, i).join('\n');
                            const startOffset = beforeStart.length + (beforeStart.length > 0 ? 1 : 0);
                            const matchedText = docLines.slice(i, i + searchLines.length).join('\n');
                            const endOffset = startOffset + matchedText.length;
                            return { startIndex: startOffset, endIndex: endOffset };
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Apply a tool call edit to the current document
     */
    private async applyToolCallEdit(toolCall: any, docPath: string): Promise<void> {
        if (!this.documentOps) {
            console.error(`⚠️ Cannot apply tool call edit: documentOps not available`);
            return;
        }

        const content = toolCall.content || [];
        const lineEdits: LineEdit[] = [];

        for (const item of content) {
            // Handle diff edits
            if (item.type === 'diff') {
                const requestedPath = item.path || 'unknown';
                const oldText = item.oldText ?? '';

                console.error(`[ACP] Tool call requested edit to ${requestedPath}, applying to OCT document ${docPath}`);

                // Convert diff to line edit
                const newText = item.newText ?? '';
                const currentContent = this.documentOps.getDocument(docPath) || '';

                if (oldText === null || oldText === '') {
                    // Insert: append to end of document
                    const lines = currentContent.split('\n');
                    const insertLine = lines.length + 1;
                    const newLines = newText.split('\n');

                    // Normal insert
                    for (let i = 0; i < newLines.length; i++) {
                        lineEdits.push({
                            type: 'insert',
                            startLine: insertLine + i,
                            content: newLines[i],
                        });
                    }
                    console.error(`[ACP] Created insert edit: ${newLines.length} lines at line ${insertLine}`)
                } else if (newText === '') {
                    // Delete: find and delete the old text
                    const oldTextForDelete = item.oldText ?? '';
                    const oldLines = oldTextForDelete.split('\n');
                    const match = this.findTextInDocument(currentContent, oldTextForDelete);
                    if (match) {
                        // Calculate line numbers from character offset
                        const beforeText = currentContent.substring(0, match.startIndex);
                        const startLine = beforeText.split('\n').length;
                        const endLine = startLine + oldLines.length - 1;
                        lineEdits.push({
                            type: 'delete',
                            startLine,
                            endLine,
                        });
                        console.error(`[ACP] Created delete edit: lines ${startLine}-${endLine}`);
                    } else {
                        console.error(`[ACP] ⚠️ Could not find oldText in document for deletion. OldText length: ${oldTextForDelete.length}, first 100 chars: ${oldTextForDelete.substring(0, 100)}`);
                        console.error(`[ACP] Document length: ${currentContent.length}, first 200 chars: ${currentContent.substring(0, 200)}`);
                    }
                } else {
                    // Replace: find oldText and replace with newText
                    const oldTextForReplace = item.oldText ?? '';
                    const oldLines = oldTextForReplace.split('\n');
                    const match = this.findTextInDocument(currentContent, oldTextForReplace);
                    if (match) {
                        const beforeText = currentContent.substring(0, match.startIndex);
                        const startLine = beforeText.split('\n').length;
                        const endLine = startLine + oldLines.length - 1;
                        lineEdits.push({
                            type: 'replace',
                            startLine,
                            endLine,
                            content: newText,
                        });
                        console.error(`[ACP] Created replace edit: lines ${startLine}-${endLine} (${oldTextForReplace.length} -> ${newText.length} chars)`);
                    } else {
                        console.error(`[ACP] ⚠️ Could not find oldText in document for replacement. OldText length: ${oldTextForReplace.length}`);
                        console.error(`[ACP] OldText preview (first 150 chars): ${oldTextForReplace.substring(0, 150).replace(/\n/g, '\\n')}`);
                        console.error(`[ACP] Document preview (first 200 chars): ${currentContent.substring(0, 200).replace(/\n/g, '\\n')}`);

                        // Fallback: try to apply as insert at end if replace fails
                        if (newText.trim()) {
                            console.error(`[ACP] Fallback: Attempting to insert newText at end of document`);
                            const lines = currentContent.split('\n');
                            const insertLine = lines.length + 1;
                            const newLines = newText.split('\n');
                            for (let i = 0; i < newLines.length; i++) {
                                lineEdits.push({
                                    type: 'insert',
                                    startLine: insertLine + i,
                                    content: newLines[i],
                                });
                            }
                        }
                    }
                }
            }
        }

        if (lineEdits.length > 0) {
            console.error(`[ACP] Applying ${lineEdits.length} line edits from tool call to ${docPath}`);
            const currentContent = this.documentOps.getDocument(docPath) || '';
            if (lineEdits[0]) {
                const firstEdit = lineEdits[0];
                const initialOffset = firstEdit.startLine > 0
                    ? currentContent.split('\n').slice(0, firstEdit.startLine - 1).reduce((acc, line) => acc + line.length + 1, 0)
                    : 0;
                this.documentOps.updateCursor(docPath, initialOffset);
            }
            await this.documentOps.applyEditsAnimated(docPath, lineEdits);
        } else {
            console.error(`[ACP] No edits to apply from tool call (content items: ${content.length})`);
        }
    }

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
    }): Promise<any> {
        if (!this.isConnected) {
            throw new Error('ACP bridge is not connected');
        }

        const requestId = this.getNextRequestId();

        return new Promise((resolve, reject) => {
            // Store the promise handlers using request ID, including the document path
            this.pendingPrompts.set(String(requestId), {
                resolve,
                reject,
                currentDocPath: trigger.source.path, // Store document path for tool call correlation
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
                const absolutePath = path.resolve(process.cwd(), trigger.source.path);
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
