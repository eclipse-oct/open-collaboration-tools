// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { webcrypto } from 'node:crypto';
import {
    ConnectionProvider,
    SocketIoTransportProvider,
    initializeProtocol,
    type ProtocolBroadcastConnection,
    type Peer,
} from 'open-collaboration-protocol';
import { DocumentSync, type DocumentChange } from './document-sync.js';
import { DocumentSyncOperations, type SessionInfo } from './document-operations.js';
import { registerMCPTools, type ToolContext } from './mcp-tools.js';
import { registerMCPResources, type ResourceContext } from './mcp-resources.js';
import { animateLoadingIndicator } from './agent-util.js';
import {
    createSamplingRequest,
    parseSamplingResponse,
    convertToLineEdits,
    type SamplingResponse,
} from './sampling-parser.js';

/**
 * Trigger event information
 */
interface TriggerEvent {
    id: string;
    docPath: string;
    docContent: string;
    prompt: string;
    offset: number;
    timestamp: number;
}

/**
 * MCP Server state
 */
interface ServerState {
    connection?: ProtocolBroadcastConnection;
    documentSync?: DocumentSync;
    documentOps?: DocumentSyncOperations;
    sessionInfo?: SessionInfo;
    serverUrl: string;
    pendingConnection?: Promise<void>;
    mcpServer?: Server;
    triggerCleanup?: () => void;
    pendingTriggers: TriggerEvent[];
    currentTrigger?: TriggerEvent;
    triggerWaiters?: Array<(trigger: TriggerEvent) => void>;
    samplingSupported?: boolean | null; // null = not yet tested, true/false = tested result
}

/**
 * Check if an error indicates that sampling is not supported by the MCP client
 */
function isSamplingNotSupportedError(error: any): boolean {
    // Check for common "not supported" error patterns
    return (
        error?.code === -32601 || // Method not found
        error?.code === -32600 || // Invalid request
        error?.message?.toLowerCase().includes('not supported') ||
        error?.message?.toLowerCase().includes('sampling') ||
        error?.message?.toLowerCase().includes('unknown method') ||
        error?.message?.toLowerCase().includes('method not found')
    );
}

/**
 * Attempt to process a trigger using MCP sampling
 * Returns true if sampling succeeded, false if not supported, throws on other errors
 */
async function attemptSamplingForTrigger(
    server: Server,
    trigger: TriggerEvent,
    documentOps: DocumentSyncOperations
): Promise<boolean> {
    try {
        console.error('[MCP] Attempting sampling approach for trigger');

        // Create sampling request
        const samplingRequest = createSamplingRequest(
            trigger.docPath,
            trigger.docContent,
            trigger.prompt,
            trigger.offset
        );

        // Send sampling request to MCP client
        // Note: We use a generic result schema since the MCP SDK doesn't have a specific schema for sampling
        const response = await server.request(
            {
                method: 'sampling/createMessage',
                params: samplingRequest,
            } as any,
            {} as any // resultSchema - using any since sampling is not formally typed in the SDK yet
        ) as unknown as SamplingResponse;

        console.error('[MCP] Sampling request succeeded');

        // Parse the response to extract edits
        const parsedEdits = parseSamplingResponse(response, trigger.docContent);

        if (parsedEdits.length === 0) {
            console.error('[MCP] Warning: No edits parsed from sampling response');
            return true; // Sampling worked, but no edits
        }

        // Convert to line edits
        const triggerLineNumber = trigger.docContent.substring(0, trigger.offset).split('\n').length;
        const lineEdits = convertToLineEdits(parsedEdits, triggerLineNumber);

        // Apply the edits
        console.error(`[MCP] Applying ${lineEdits.length} edits from sampling response`);
        for (const edit of lineEdits) {
            documentOps.applyEdit(trigger.docPath, edit);
        }

        console.error('[MCP] Successfully applied edits from sampling');
        return true;
    } catch (error) {
        // Check if this is a "not supported" error
        if (isSamplingNotSupportedError(error)) {
            console.error('[MCP] Sampling not supported by client');
            return false;
        }

        // Some other error occurred
        console.error(`[MCP] Sampling failed with error: ${error}`);
        throw error;
    }
}

/**
 * Process trigger via fallback path (notification + blocking wait)
 */
function processTriggerViaFallback(
    serverState: ServerState,
    trigger: TriggerEvent
): void {
    console.error('[MCP] Using fallback approach (notification + blocking wait)');

    // Queue the trigger
    serverState.pendingTriggers.push(trigger);
    serverState.currentTrigger = trigger;

    // Notify any waiting oct_wait_for_trigger calls
    if (serverState.triggerWaiters && serverState.triggerWaiters.length > 0) {
        console.error(`[MCP] Notifying ${serverState.triggerWaiters.length} waiting calls`);
        const waiter = serverState.triggerWaiters.shift();
        if (waiter) {
            waiter(trigger);
        }
    } else {
        console.log(serverState.triggerWaiters?.length ?? 'no waiters');
        console.error('[MCP] No waiting calls, sending notification directly');
    }

    // Send MCP resource update notification
    if (serverState.mcpServer) {
        serverState.mcpServer.notification({
            method: 'notifications/resources/updated',
            params: {
                uri: 'oct://triggers/current',
            },
        }).catch(error => {
            console.error(`[MCP] Failed to send notification: ${error}`);
        });
    }
}

/**
 * Setup trigger detection for MCP mode
 * Similar to setupTriggerDetection in agent.ts, but queues triggers for MCP client to handle
 */
function setupMCPTriggerDetection(
    documentSync: DocumentSync,
    documentOps: DocumentSyncOperations,
    agentName: string,
    serverState: ServerState
): () => void {
    type State = {
        executing: boolean;
        documentChanged: boolean;
        animationAbort: AbortController | undefined;
    };
    const state: State = {
        executing: false,
        documentChanged: false,
        animationAbort: undefined,
    };

    const trigger = `@${agentName}`;

    const activeChangeHandler = (documentPath: string) => {
        console.error(`[MCP] Active document: ${documentPath}`);
    };

    const documentChangeHandler = async (docPath: string, docContent: string, changes: DocumentChange[]) => {
        console.error(`[MCP] documentChangeHandler called for ${docPath}, changes: ${changes.length}`);
        if (state.executing) {
            console.error('[MCP] Already executing, marking document as changed');
            state.documentChanged = true;
            // Abort current animation to start a new one
            if (state.animationAbort) {
                state.animationAbort.abort();
                state.animationAbort = undefined;
            }
            return;
        }

        console.error(`[MCP] Processing ${changes.length} changes`);
        for (const change of changes) {
            console.error(`[MCP] Change type: ${change.type}, ${change.type === 'insert' ? `text: "${change.text}"` : ''}`);
            if (change.type === 'insert' && change.text === '\n') {
                const docLines = docContent.split('\n');
                const completedLine = docLines[change.position.line];

                console.error(`[MCP] Newline inserted at line ${change.position.line}, checking line: "${completedLine}"`);

                const triggerIndex = completedLine?.indexOf(trigger);
                if (triggerIndex !== undefined && triggerIndex !== -1) {
                    const promptText = completedLine.substring(triggerIndex + trigger.length).trim();
                    console.error(`[MCP] Found trigger at index ${triggerIndex}, prompt: "${promptText}"`);
                    if (promptText.length > 0) {
                        console.error(`[MCP] Processing trigger with hybrid approach`);

                        // Mark as executing
                        state.executing = true;
                        state.animationAbort = new AbortController();

                        // Start loading animation right after the trigger
                        const animationOffset = change.offset - 1; // Position before the newline
                        const animationPromise = animateLoadingIndicator(docPath, animationOffset, documentSync, state.animationAbort.signal);

                        // Create trigger event
                        const triggerEvent: TriggerEvent = {
                            id: `trigger-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            docPath,
                            docContent,
                            prompt: promptText,
                            offset: change.offset,
                            timestamp: Date.now(),
                        };

                        // Store animation abort controller with the trigger
                        (triggerEvent as any).animationAbort = state.animationAbort;
                        (triggerEvent as any).animationPromise = animationPromise;

                        console.error(`[MCP] Trigger created: ${triggerEvent.id}`);
                        console.error(`[MCP] Loading animation started`);

                        // HYBRID APPROACH: Try sampling first, fall back to notification
                        (async () => {
                            try {
                                // Check if we should skip sampling attempt based on cache
                                if (serverState.samplingSupported === false) {
                                    console.error('[MCP] Skipping sampling (previously detected as unsupported)');
                                    processTriggerViaFallback(serverState, triggerEvent);
                                    return;
                                }

                                // Attempt sampling
                                if (!serverState.mcpServer || !serverState.documentOps) {
                                    console.error('[MCP] Server or documentOps not available, using fallback');
                                    processTriggerViaFallback(serverState, triggerEvent);
                                    return;
                                }

                                const samplingSucceeded = await attemptSamplingForTrigger(
                                    serverState.mcpServer,
                                    triggerEvent,
                                    serverState.documentOps
                                );

                                if (samplingSucceeded) {
                                    // Sampling worked!
                                    console.error('[MCP] Using sampling approach (succeeded)');
                                    serverState.samplingSupported = true;

                                    // Stop animation
                                    if (state.animationAbort) {
                                        state.animationAbort.abort();
                                    }

                                    // Wait for animation to complete
                                    try {
                                        await animationPromise;
                                    } catch (error) {
                                        // Expected - animation was aborted
                                    }

                                    // Remove trigger line
                                    if (serverState.documentOps && serverState.sessionInfo) {
                                        const triggerPattern = `@${serverState.sessionInfo.agentName}`;
                                        serverState.documentOps.removeTriggerLine(triggerEvent.docPath, triggerPattern);
                                    }

                                    console.error('[MCP] Sampling approach completed successfully');
                                    state.executing = false;
                                } else {
                                    // Sampling not supported, use fallback
                                    console.error('[MCP] Sampling not supported, using fallback');
                                    serverState.samplingSupported = false;
                                    processTriggerViaFallback(serverState, triggerEvent);
                                }
                            } catch (error) {
                                // Unexpected error during sampling
                                console.error(`[MCP] Unexpected error in hybrid approach: ${error}`);
                                // Fall back to notification approach
                                processTriggerViaFallback(serverState, triggerEvent);
                            }
                        })();

                        break;
                    }
                }
            }
        }
    };

    console.error(`[MCP] Registering document change handlers for trigger: ${trigger}`);
    try {
        documentSync.onActiveChange(activeChangeHandler);
        documentSync.onDocumentChange(documentChangeHandler);
        console.error('[MCP] Document change handlers registered successfully');
    } catch (error) {
        console.error(`[MCP] Error registering handlers: ${error}`);
        throw error;
    }

    return () => {
        // Cleanup - abort any running animation
        if (state.animationAbort) {
            state.animationAbort.abort();
            state.animationAbort = undefined;
        }
        console.error('[MCP] Cleaning up trigger detection');
    };
}

/**
 * Start the MCP server
 */
export async function startMCPServer(): Promise<void> {
    // Initialize OCT protocol
    initializeProtocol({ cryptoModule: webcrypto });

    // Get server URL from environment
    const serverUrl = process.env.OCT_SERVER_URL || 'https://api.open-collab.tools/';

    // Create MCP server
    const server = new Server(
        {
            name: 'oct-collaboration',
            version: '0.1.0',
        },
        {
            capabilities: {
                tools: {},
                resources: {},
                sampling: {},
            },
        }
    );

    // Create server state
    const state: ServerState = {
        serverUrl,
        mcpServer: server,
        pendingTriggers: [],
    };

    // Tool context for handlers
    const toolContext: ToolContext = {
        getState: () => state,
        connect: async (roomId: string, customServerUrl?: string) => {
            return connectToRoom(state, roomId, customServerUrl);
        },
        disconnect: async () => {
            return disconnectFromRoom(state);
        },
    };

    // Resource context for handlers
    const resourceContext: ResourceContext = {
        getState: () => state,
    };

    // Register tools and resources
    registerMCPTools(server, toolContext);
    registerMCPResources(server, resourceContext);

    // Start server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('OCT MCP Server started');
}

/**
 * Connect to an OCT room
 */
async function connectToRoom(
    state: ServerState,
    roomId: string,
    customServerUrl?: string
): Promise<{ success: boolean; message: string; sessionInfo?: SessionInfo; loginUrl?: string }> {
    // Disconnect if already connected
    if (state.connection) {
        await disconnectFromRoom(state);
    }

    try {
        const serverUrl = customServerUrl || state.serverUrl;
        let capturedLoginUrl: string | undefined;
        let loginUrlResolved = false;

        // Create connection provider
        const connectionProvider = new ConnectionProvider({
            url: serverUrl,
            fetch: globalThis.fetch,
            transports: [SocketIoTransportProvider],
            authenticationHandler: async (token, authMetadata) => {
                capturedLoginUrl = authMetadata.loginPageUrl;
                loginUrlResolved = true;
                // Login URL is captured and returned in the response
                // It will be displayed by the MCP tool handler
                return true;
            },
        });

        // Start login process (this will trigger authenticationHandler immediately)
        console.error('⚙️ Starting login process...');
        const loginPromise = connectionProvider.login({
            reporter: (info) => {
                if (info.code === 'PerformingLogin') {
                    console.error('⚙️ Performing login...');
                } else if (info.code === 'AwaitingServerResponse') {
                    console.error('⚠️ Waiting for browser authentication...');
                }
            },
        });

        // Wait a bit for the login URL to be captured
        // The authenticationHandler is called very quickly, usually within 100ms
        const maxWaitForUrl = 5000; // 5 seconds
        const startTime = Date.now();
        while (!loginUrlResolved && Date.now() - startTime < maxWaitForUrl) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // If we have the login URL, return it immediately so the user can authenticate
        if (capturedLoginUrl && !state.connection) {
            console.error(`🔐 Login URL available: ${capturedLoginUrl}`);
            console.error('⚠️ Waiting for browser authentication to complete...');

            // Continue the connection process in the background
            // We return the URL now, but keep waiting for authentication
            state.pendingConnection = (async () => {
                try {
                    await loginPromise;
                    console.error('✅ Login successful');

                    // Join room
                    console.error(`⚙️ Joining room ${roomId}...`);
                    const joinResponse = await connectionProvider.joinRoom({
                        roomId,
                        reporter: (info) => {
                            if (info.code === 'AwaitingServerResponse') {
                                console.error('⚙️ Waiting for room join confirmation...');
                            }
                        },
                    });
                    console.error('✅ Joined the room');

                    // Connect to room
                    const connection = await connectionProvider.connect(joinResponse.roomToken);
                    state.connection = connection;

                    // Create document sync
                    const documentSync = new DocumentSync(connection);
                    state.documentSync = documentSync;

                    // Wait for peer info
                    const identity = await new Promise<Peer>((resolve) => {
                        connection.peer.onInfo((_, peer) => resolve(peer));
                    });
                    console.error(`✅ Received peer info: ${identity.name} (${identity.id})`);

                    // Set agent peer ID for cursor visibility
                    documentSync.setAgentPeerId(identity.id);

                    // Wait for host ID from DocumentSync (it handles the onInit event)
                    const hostId = await documentSync.waitForHostId();
                    console.error(`✅ Received host ID: ${hostId}`);

                    // Create session info
                    const sessionInfo: SessionInfo = {
                        roomId,
                        agentId: identity.id,
                        agentName: identity.name,
                        hostId,
                        serverUrl,
                    };
                    state.sessionInfo = sessionInfo;

                    // Create document operations
                    state.documentOps = new DocumentSyncOperations(documentSync, sessionInfo);

                    // Register handler for fileSystem/change broadcasts (no-op to prevent errors)
                    connection.fs.onChange(() => {
                        // File system changes are not relevant for the agent
                    });

                    // Setup trigger detection for MCP mode
                    console.error('[MCP] Setting up trigger detection...');
                    state.triggerCleanup = setupMCPTriggerDetection(
                        documentSync,
                        state.documentOps,
                        identity.name,
                        state
                    );
                    console.error('[MCP] Trigger detection setup complete');

                    // Register disconnect handler
                    connection.onDisconnect(() => {
                        console.error('⚠️ Connection to server lost');
                        disconnectFromRoom(state);
                    });

                    // Register room close handler
                    connection.room.onClose(async () => {
                        console.error('⚠️ Collaboration session closed by host');
                        await disconnectFromRoom(state);
                    });

                    console.error(`✅ Connected to room ${roomId} as ${identity.name}`);
                    state.pendingConnection = undefined;
                } catch (error) {
                    console.error(`❌ Connection failed: ${error}`);
                    state.pendingConnection = undefined;
                }
            })();

            // Return immediately with the login URL
            return {
                success: true,
                message: `Authentication required. Please open the login URL in your browser. The connection will complete automatically once you authenticate.`,
                loginUrl: capturedLoginUrl,
            };
        }

        // If we didn't get a login URL, wait for the login to complete
        await loginPromise;
        console.error('✅ Login successful');

        // Join room
        console.error(`⚙️ Joining room ${roomId}...`);
        const joinResponse = await connectionProvider.joinRoom({
            roomId,
            reporter: (info) => {
                if (info.code === 'AwaitingServerResponse') {
                    console.error('⚙️ Waiting for room join confirmation...');
                }
            },
        });
        console.error('✅ Joined the room');

        // Connect to room
        const connection = await connectionProvider.connect(joinResponse.roomToken);
        state.connection = connection;

        // Create document sync
        const documentSync = new DocumentSync(connection);
        state.documentSync = documentSync;

        // Wait for peer info
        const identity = await new Promise<Peer>((resolve) => {
            connection.peer.onInfo((_, peer) => resolve(peer));
        });
        console.error(`✅ Received peer info: ${identity.name} (${identity.id})`);

        // Set agent peer ID for cursor visibility
        documentSync.setAgentPeerId(identity.id);

        // Wait for host ID from DocumentSync (it handles the onInit event)
        const hostId = await documentSync.waitForHostId();
        console.error(`✅ Received host ID: ${hostId}`);

        // Create session info
        const sessionInfo: SessionInfo = {
            roomId,
            agentId: identity.id,
            agentName: identity.name,
            hostId,
            serverUrl,
        };
        state.sessionInfo = sessionInfo;

        // Create document operations
        state.documentOps = new DocumentSyncOperations(documentSync, sessionInfo);

        // Register handler for fileSystem/change broadcasts (no-op to prevent errors)
        connection.fs.onChange(() => {
            // File system changes are not relevant for the agent
        });

        // Setup trigger detection for MCP mode
        console.error('[MCP] Setting up trigger detection...');
        state.triggerCleanup = setupMCPTriggerDetection(
            documentSync,
            state.documentOps,
            identity.name,
            state
        );
        console.error('[MCP] Trigger detection setup complete');

        // Register disconnect handler
        connection.onDisconnect(() => {
            console.error('⚠️ Connection to server lost');
            disconnectFromRoom(state);
        });

        // Register room close handler
        connection.room.onClose(async () => {
            console.error('⚠️ Collaboration session closed by host');
            await disconnectFromRoom(state);
        });

        return {
            success: true,
            message: `Connected to room ${roomId} as ${identity.name}`,
            sessionInfo,
            loginUrl: capturedLoginUrl,
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to connect: ${error}`,
        };
    }
}

/**
 * Disconnect from the current OCT room
 */
async function disconnectFromRoom(
    state: ServerState
): Promise<{ success: boolean; message: string }> {
    if (!state.connection) {
        return {
            success: false,
            message: 'Not connected to any room',
        };
    }

    try {
        // Cleanup trigger detection
        if (state.triggerCleanup) {
            state.triggerCleanup();
            state.triggerCleanup = undefined;
        }

        await state.connection.room.leave();
        state.documentSync?.dispose();
        state.connection = undefined;
        state.documentSync = undefined;
        state.documentOps = undefined;
        state.sessionInfo = undefined;

        return {
            success: true,
            message: 'Disconnected from room',
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to disconnect: ${error}`,
        };
    }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    startMCPServer().catch(console.error);
}
