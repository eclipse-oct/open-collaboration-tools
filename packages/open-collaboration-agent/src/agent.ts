// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { webcrypto } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ConnectionProvider, SocketIoTransportProvider, initializeProtocol } from 'open-collaboration-protocol';
import type { ConnectionProviderOptions, Peer } from 'open-collaboration-protocol';
import { DocumentSync, DocumentChange, type DocumentInsert } from './document-sync.js';
import { DocumentSyncOperations } from './document-operations.js';
import { ACPBridge } from './acp-bridge.js';

export interface AgentOptions {
    server: string
    room: string
    acpAgent?: string
    config?: string
}

export async function startCLIAgent(options: AgentOptions): Promise<void> {
    initializeProtocol({ cryptoModule: webcrypto });

    const cpOptions: ConnectionProviderOptions = {
        url: options.server,
        fetch: globalThis.fetch,
        transports: [SocketIoTransportProvider],
        authenticationHandler: async (token, authMetadata) => {
            console.log('Please open the following URL in your browser to log in:');
            console.log(authMetadata.loginPageUrl);
            return true;
        }
    };

    // Log in to the server
    const connectionProvider = new ConnectionProvider(cpOptions);
    await connectionProvider.login({
        reporter: (info) => {
            if (info.code === 'PerformingLogin') {
                console.log('⚙️ Starting login process...');
            } else if (info.code === 'AwaitingServerResponse') {
                console.log('⚙️ Waiting for server response...');
            }
        }
    });
    console.log('✅ Login successful');

    // Join the room
    console.log(`⚙️ Joining room ${options.room}...`);
    const joinResponse = await connectionProvider.joinRoom({
        roomId: options.room,
        reporter: (info) => {
            if (info.code === 'AwaitingServerResponse') {
                console.log('⚙️ Waiting for room join confirmation...');
            }
        }
    });
    console.log('✅ Joined the room');

    // Connect to the room using the room token
    const connection = await connectionProvider.connect(joinResponse.roomToken);

    // Store ACP bridge for cleanup. Declared with `let` because `cleanup` (below)
    // closes over this binding and the bridge is created later in the function.
    // eslint-disable-next-line prefer-const
    let acpBridge: ACPBridge | undefined;

    // Register signal handlers for graceful shutdown
    const cleanup = async () => {
        try {
            // Stop ACP bridge if running
            if (acpBridge) {
                await acpBridge.stop();
            }
            const exitTimeout = setTimeout(() => {
                console.log('⚠️ Shutdown timeout reached, forcing exit');
                process.exit(0);
            }, 2000);
            await connection.room.leave();
            clearTimeout(exitTimeout);
            console.log('Agent stopped');
        } catch (error) {
            console.error(error);
        } finally {
            process.exit(0);
        }
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Register handler for room close event
    connection.room.onClose(async () => {
        console.log('Collaboration session closed by host');
        process.exit(0);
    });

    // Register handler for connection disconnect
    connection.onDisconnect(() => {
        console.log('⚠️ Connection to server lost');
        process.exit(0);
    });

    const documentSync = new DocumentSync(connection);

    // Wait for peer info to be received
    const identity = await new Promise<Peer>((resolve) => {
        connection.peer.onInfo((_, peer) => resolve(peer));
    });
    console.log(`✅ Received peer info: ${identity.name} (${identity.id})`);

    // Run ACP agent (connects to external agent via ACP bridge)
    acpBridge = await runACPAgent(documentSync, identity, options);
}

export interface TriggerDetectionOptions {
    agentName: string
    documentSync: DocumentSync
    documentOps: DocumentSyncOperations
    onTrigger: (params: {
        docPath: string
        docContent: string
        prompt: string
        change?: DocumentInsert // Only present for document triggers (newline detection)
        source: 'document' | 'chat'
        sendChatResponse?: (message: string) => Promise<void> // Only present for chat triggers
    }) => Promise<void>
}

function levenshteinDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

/**
 * Searches the workspace for files matching a user-provided path.
 * Uses suffix matching (e.g. "src/agent.ts" matches "packages/foo/src/agent.ts"),
 * exact filename matching, and falls back to fuzzy matching via Levenshtein distance
 * to catch typos (e.g. "text.txt" finds "test.txt").
 */
function findMatchingFiles(rootDir: string, userPath: string, maxResults = 5): string[] {
    const exactResults: string[] = [];
    const fuzzyResults: Array<{ relativePath: string; distance: number }> = [];
    const normalizedSearch = userPath.replace(/\\/g, '/');
    const searchFileName = path.basename(userPath).toLowerCase();
    const maxDistance = Math.max(2, Math.ceil(searchFileName.length / 3));

    function walk(dir: string, depth: number) {
        if (depth > 10) return;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath, depth + 1);
                } else {
                    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
                    if (relativePath.endsWith(normalizedSearch) || entry.name.toLowerCase() === searchFileName) {
                        exactResults.push(relativePath);
                    } else {
                        const distance = levenshteinDistance(entry.name.toLowerCase(), searchFileName);
                        if (distance <= maxDistance) {
                            fuzzyResults.push({ relativePath, distance });
                        }
                    }
                }
            }
        } catch {
            // Ignore permission errors
        }
    }

    walk(rootDir, 0);

    if (exactResults.length > 0) {
        exactResults.sort((a, b) => {
            const aSuffix = a.endsWith(normalizedSearch);
            const bSuffix = b.endsWith(normalizedSearch);
            if (aSuffix && !bSuffix) return -1;
            if (!aSuffix && bSuffix) return 1;
            return a.length - b.length;
        });
        return exactResults.slice(0, maxResults);
    }

    fuzzyResults.sort((a, b) => a.distance - b.distance || a.relativePath.length - b.relativePath.length);
    return fuzzyResults.slice(0, maxResults).map(r => r.relativePath);
}

/**
 * Sets up trigger detection for @agent mentions in documents
 * Returns a cleanup function to stop monitoring
 */
export function setupTriggerDetection(options: TriggerDetectionOptions): () => void {
    type State = {
        executing: boolean
        documentChanged: boolean
        awaitingDocPath: boolean
        pendingPrompt: string | undefined
    }
    const state: State = {
        executing: false,
        documentChanged: false,
        awaitingDocPath: false,
        pendingPrompt: undefined
    };

    const { agentName, documentSync, onTrigger } = options;
    const trigger = `@${agentName}`;

    const activeChangeHandler = (documentPath: string) => {
        console.log(`Active document: ${documentPath}`);
    };

    const documentChangeHandler = async (docPath: string, docContent: string, changes: DocumentChange[]) => {
        console.error(`[DEBUG] documentChangeHandler called for ${docPath}, changes: ${changes.length}`);
        if (state.executing) {
            // Don't start another execution while the previous one is running
            console.error('[DEBUG] Already executing, skipping');
            state.documentChanged = true;
            return;
        }

        console.error(`[DEBUG] Processing ${changes.length} changes`);
        for (const change of changes) {
            console.error(`[DEBUG] Change type: ${change.type}, ${change.type === 'insert' ? `text: "${change.text}"` : ''}`);
            if (change.type === 'insert' && change.text === '\n') {
                // A newline was inserted - check if the line before it contains the trigger
                const docLines = docContent.split('\n');
                // The line that was just completed is the one at change.position.line
                // (before the newline was inserted)
                const completedLine = docLines[change.position.line];

                console.error(`[DEBUG] Newline inserted at line ${change.position.line}, checking line: "${completedLine}"`);

                const triggerIndex = completedLine?.indexOf(trigger);
                if (triggerIndex !== undefined && triggerIndex !== -1) {
                    // The trigger string was found in the completed line
                    const prompt = completedLine.substring(triggerIndex + trigger.length).trim();
                    console.error(`[DEBUG] Found trigger at index ${triggerIndex}, prompt: "${prompt}"`);
                    if (prompt.length > 0) {
                        console.error(`Received prompt: "${prompt}"`);
                        try {
                            state.executing = true;

                            await onTrigger({
                                docPath,
                                docContent,
                                prompt,
                                change,
                                source: 'document',
                            });
                        } catch (error) {
                            console.error('Error executing prompt:', error);
                        } finally {
                            state.executing = false;
                            state.documentChanged = false;
                        }
                        break;
                    }
                }
            }
        }
    };

    console.error(`[DEBUG] Registering document change handlers for trigger: ${trigger}`);
    try {
        documentSync.onActiveChange(activeChangeHandler);
        documentSync.onDocumentChange(documentChangeHandler);
        console.error('[DEBUG] Document change handlers registered successfully');
    } catch (error) {
        console.error(`[DEBUG] Error registering handlers: ${error}`);
        throw error;
    }

    // Register chat message handler for @agent triggers in chat
    const { documentOps } = options;
    const connection = documentOps.getConnection();

    const executeChatTrigger = async (docPath: string, docContent: string, prompt: string) => {
        try {
            state.executing = true;
            await onTrigger({
                docPath,
                docContent,
                prompt,
                source: 'chat',
                sendChatResponse: (msg: string) => connection.chat.sendMessage(msg),
            });
        } catch (error) {
            console.error('Error executing chat trigger:', error);
            await connection.chat.sendMessage(`Error processing your request: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            state.executing = false;
            state.documentChanged = false;
        }
    };

    const isFileAtPath = (filePath: string): boolean => {
        try {
            return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
        } catch {
            return false;
        }
    };

    const openDocumentAndExecute = async (octPath: string, pendingPrompt: string): Promise<boolean> => {
        const hostId = documentOps.getSessionInfo().hostId;
        const docContent = await documentSync.openAndWaitForContent(hostId, octPath);
        if (!docContent) {
            await connection.chat.sendMessage('The document could not be loaded. Please try a different file path.');
            return false;
        }

        state.awaitingDocPath = false;
        state.pendingPrompt = undefined;
        await executeChatTrigger(octPath, docContent, pendingPrompt);
        return true;
    };

    const handleDocPathResponse = async (userPath: string) => {
        const pendingPrompt = state.pendingPrompt!;
        const workspaceRoot = process.cwd();
        const workspaceName = path.basename(workspaceRoot);
        const absolutePath = path.resolve(workspaceRoot, userPath);

        if (!absolutePath.startsWith(workspaceRoot)) {
            await connection.chat.sendMessage('The provided path is outside the workspace. Please provide a path within the project.');
            return;
        }

        if (isFileAtPath(absolutePath)) {
            const octPath = path.join(workspaceName, path.relative(workspaceRoot, absolutePath));
            await openDocumentAndExecute(octPath, pendingPrompt);
            return;
        }

        const matches = findMatchingFiles(workspaceRoot, userPath);

        if (matches.length === 1) {
            const octPath = path.join(workspaceName, matches[0]);
            await connection.chat.sendMessage(`I found "${matches[0]}". Opening it now...`);
            await openDocumentAndExecute(octPath, pendingPrompt);
        } else if (matches.length > 1) {
            const suggestions = matches.map(m => `  - ${m}`).join('\n');
            await connection.chat.sendMessage(
                `I couldn't find "${userPath}" at that exact path. Did you mean one of these?\n${suggestions}\nPlease provide the correct file path.`
            );
        } else {
            await connection.chat.sendMessage(
                `I couldn't find "${userPath}" in the workspace. You could create a new file at this path, or provide a different file path.`
            );
        }
    };

    const chatMessageHandler = async (origin: string, message: string) => {
        console.error(`[DEBUG] chatMessageHandler called, message: "${message}"`);

        if (state.awaitingDocPath && state.pendingPrompt) {
            if (message.includes(trigger)) {
                state.awaitingDocPath = false;
                state.pendingPrompt = undefined;
            } else {
                try {
                    await handleDocPathResponse(message.trim());
                } catch (error) {
                    console.error('Error handling document path response:', error);
                    await connection.chat.sendMessage(
                        'Something went wrong while looking up the file. Please try again with a different path.'
                    );
                }
                return;
            }
        }

        const triggerIndex = message.indexOf(trigger);
        if (triggerIndex === -1) {
            return;
        }

        const prompt = message.substring(triggerIndex + trigger.length).trim();
        if (prompt.length === 0) {
            console.error('[DEBUG] Chat trigger found but no prompt provided');
            return;
        }

        if (state.executing) {
            console.error('[DEBUG] Already executing, skipping chat trigger');
            await connection.chat.sendMessage('I am currently processing another request. Please wait.');
            return;
        }

        const activeDoc = await documentSync.waitForActiveDocument(undefined, origin);

        if (!activeDoc) {
            console.error('[DEBUG] No active document for chat trigger after waiting');
            await connection.chat.sendMessage(
                'No active document is currently open. Please provide the file path you\'d like me to work on.'
            );
            state.awaitingDocPath = true;
            state.pendingPrompt = prompt;
            return;
        }

        console.error(`[DEBUG] Chat trigger found, prompt: "${prompt}", docPath: ${activeDoc.path}`);
        await executeChatTrigger(activeDoc.path, activeDoc.content, prompt);
    };

    connection.chat.onMessage(chatMessageHandler);
    console.error('[DEBUG] Chat message handler registered successfully');

    return () => {
        state.awaitingDocPath = false;
        state.pendingPrompt = undefined;
    };
}

/**
 * Run agent - connects to external agent via ACP bridge
 * @returns The ACP bridge instance for cleanup
 */
export async function runACPAgent(documentSync: DocumentSync, identity: Peer, options: AgentOptions): Promise<ACPBridge> {
    // Wait for host ID from DocumentSync
    const hostId = await documentSync.waitForHostId();
    console.log(`✅ Received host ID: ${hostId}`);

    // Create document operations wrapper
    const documentOps = new DocumentSyncOperations(documentSync, {
        roomId: options.room,
        agentId: identity.id,
        agentName: identity.name,
        hostId,
        serverUrl: options.server
    });

    // Create and start ACP bridge
    // Default spawns npx @zed-industries/claude-code-acp; override with --acp-agent for other ACP adapters
    const acpAgentCommand = options.acpAgent || 'npx @zed-industries/claude-code-acp';
    const acpBridge = new ACPBridge(acpAgentCommand, documentOps, options.config);

    try {
        await acpBridge.start();

        // Setup trigger detection with ACP handler
        // Reuse the same trigger detection logic, but with ACP-specific processing
        setupTriggerDetection({
            agentName: identity.name,
            documentSync,
            documentOps,
            onTrigger: async ({ docPath, docContent, prompt, change, source, sendChatResponse }) => {
                // Generate unique trigger ID
                const triggerId = `trig-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

                // Determine trigger line (1-indexed) - for chat triggers, use end of document
                const triggerLine = change ? change.position.line + 1 : docContent.split('\n').length;

                // Convert to ACP trigger message format
                const acpTriggerMessage = {
                    id: triggerId,
                    source: {
                        type: 'document' as const,
                        path: docPath,
                        line: triggerLine,
                    },
                    content: {
                        prompt,
                        context: docContent, // Include full document context
                    },
                };

                // Send trigger to ACP agent
                console.error(`[ACP] Sending trigger ${triggerId} to ACP agent (source: ${source})`);
                let response;
                try {
                    response = await acpBridge.sendTrigger(acpTriggerMessage);
                } catch (error: any) {
                    // Handle sessionId missing error specifically
                    if (error.message?.includes('sessionId is required')) {
                        const errorMessage = 'Error: ACP session not initialized. Please ensure the ACP agent started successfully.';
                        console.error(`[ACP] ${errorMessage}`);
                        if (sendChatResponse) {
                            await sendChatResponse(errorMessage);
                        } else {
                            await documentOps.getConnection().chat.sendMessage(errorMessage);
                        }

                        // Re-throw to be caught by outer catch block for logging
                        throw error;
                    }
                    // Re-throw other errors
                    throw error;
                }

                // Log agent text response for observability. Chat delivery is already
                // handled inside ACPBridge.handleResponse (which forwards accumulated
                // text to the chat connection during the prompt cycle).
                // The bridge resolves with a custom { type, content } shape on top of
                // the typed AgentResponse, so we read the fields defensively.
                const wrappedResponse = response as { type?: string; content?: unknown };
                if (wrappedResponse?.type === 'agent/response' &&
                    typeof wrappedResponse.content === 'string' &&
                    wrappedResponse.content.trim()) {
                    console.log(`[ACP Agent Response] ${wrappedResponse.content}`);
                }

                // For document triggers, remove the trigger line
                if (source === 'document' && change) {
                    // Remove the trigger line LAST (after all edits are applied)
                    const trigger = `@${identity.name}`;
                    documentOps.removeTriggerLine(docPath, trigger);
                }

                // For chat triggers, send a response
                if (source === 'chat' && sendChatResponse) {
                    await sendChatResponse('Done! I have applied the changes to the active document.');
                }
            },
        });

        console.log('✅ ACP agent mode initialized');
        return acpBridge;
    } catch (error) {
        console.error('❌ Failed to start ACP bridge:', error);
        throw error;
    }
}
