// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { webcrypto } from 'node:crypto';
import { ConnectionProvider, SocketIoTransportProvider, initializeProtocol } from 'open-collaboration-protocol';
import type { ConnectionProviderOptions, Peer } from 'open-collaboration-protocol';
import { DocumentSync, DocumentChange, type DocumentInsert } from './document-sync.js';
import { DocumentSyncOperations } from './document-operations.js';
import { ACPBridge } from './acp-bridge.js';
import { processACPResponse } from './acp-trigger-handler.js';

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

    // Store ACP bridge for cleanup
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

    // Set the agent's peer ID in the awareness state so its cursor is visible
    documentSync.setAgentPeerId(identity.id);

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
        animationAbort: AbortController
        source: 'document' | 'chat'
        sendChatResponse?: (message: string) => Promise<void> // Only present for chat triggers
    }) => Promise<void>
}

/**
 * Sets up trigger detection for @agent mentions in documents
 * Returns a cleanup function to stop monitoring
 */
export function setupTriggerDetection(options: TriggerDetectionOptions): () => void {
    type State = {
        executing: boolean
        documentChanged: boolean
        animationAbort: AbortController | undefined
    }
    const state: State = {
        executing: false,
        documentChanged: false,
        animationAbort: undefined
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
            if (state.animationAbort) {
                state.animationAbort.abort();
                state.animationAbort = undefined;
            }
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
                        // Create an AbortController for the loading animation
                        state.animationAbort = new AbortController();
                        try {
                            state.executing = true;

                            await onTrigger({
                                docPath,
                                docContent,
                                prompt,
                                change,
                                animationAbort: state.animationAbort,
                                source: 'document',
                            });
                        } catch (error) {
                            // Abort the animation in case of error
                            state.animationAbort?.abort();
                            console.error('Error executing prompt:', error);
                        } finally {
                            state.executing = false;
                            state.documentChanged = false;
                            state.animationAbort = undefined;
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

    const chatMessageHandler = async (origin: string, message: string) => {
        console.error(`[DEBUG] chatMessageHandler called, message: "${message}"`);

        // Check if the message contains the trigger
        const triggerIndex = message.indexOf(trigger);
        if (triggerIndex === -1) {
            return;
        }

        // Extract the prompt after the trigger
        const prompt = message.substring(triggerIndex + trigger.length).trim();
        if (prompt.length === 0) {
            console.error('[DEBUG] Chat trigger found but no prompt provided');
            return;
        }

        // Check if already executing
        if (state.executing) {
            console.error('[DEBUG] Already executing, skipping chat trigger');
            // Send a chat response to inform the user
            await connection.chat.sendMessage('I am currently processing another request. Please wait.');
            return;
        }

        // Get active document context
        const docPath = documentSync.getActiveDocumentPath();
        const docContent = documentSync.getActiveDocumentContent();

        if (!docPath || !docContent) {
            console.error('[DEBUG] No active document for chat trigger');
            await connection.chat.sendMessage('No active document available. Please open a document first.');
            return;
        }

        console.error(`[DEBUG] Chat trigger found, prompt: "${prompt}", docPath: ${docPath}`);

        // Create an AbortController for the loading animation
        state.animationAbort = new AbortController();
        try {
            state.executing = true;

            await onTrigger({
                docPath,
                docContent,
                prompt,
                animationAbort: state.animationAbort,
                source: 'chat',
                sendChatResponse: (msg: string) => connection.chat.sendMessage(msg),
            });
        } catch (error) {
            // Abort the animation in case of error
            state.animationAbort?.abort();
            console.error('Error executing chat trigger:', error);
            await connection.chat.sendMessage(`Error processing your request: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            state.executing = false;
            state.documentChanged = false;
            state.animationAbort = undefined;
        }
    };

    connection.chat.onMessage(chatMessageHandler);
    console.error('[DEBUG] Chat message handler registered successfully');

    // Return cleanup function
    return () => {
        // Abort any running animation
        if (state.animationAbort) {
            state.animationAbort.abort();
        }
        // Note: DocumentSync doesn't provide removeListener methods,
        // so handlers will remain registered until the connection is closed
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
            onTrigger: async ({ docPath, docContent, prompt, change, animationAbort, source, sendChatResponse }) => {
                // Generate unique trigger ID
                const triggerId = `trig-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

                // Determine trigger line (1-indexed) - for chat triggers, use end of document
                const triggerLine = change ? change.position.line + 1 : docContent.split('\n').length;

                // Convert to ACP trigger message format
                const acpTrigger = {
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
                    response = await acpBridge.sendTrigger(acpTrigger);
                } catch (error: any) {
                    // Handle sessionId missing error specifically
                    if (error.message?.includes('sessionId is required')) {
                        // Abort the animation
                        animationAbort.abort();

                        const errorMessage = 'Error: ACP session not initialized. Please ensure the ACP agent started successfully.';

                        if (source === 'chat' && sendChatResponse) {
                            // Send error via chat
                            await sendChatResponse(errorMessage);
                        } else if (change) {
                            // Insert error message into document after the trigger line
                            await documentOps.applyEditsAnimated(docPath, [{
                                type: 'insert',
                                startLine: triggerLine + 1,
                                content: `// ${errorMessage}`,
                            }]);

                            // Remove the trigger line
                            const trigger = `@${identity.name}`;
                            documentOps.removeTriggerLine(docPath, trigger);

                            // Clear cursor
                            documentOps.updateCursor(docPath, 0);
                        }

                        // Re-throw to be caught by outer catch block for logging
                        throw error;
                    }
                    // Re-throw other errors
                    throw error;
                }

                // Abort the animation (the setupTriggerDetection will handle awaiting it)
                animationAbort.abort();

                // Get current content in case it changed during execution
                let currentContent = docContent;
                const currentDocContent = documentSync.getDocumentContent(docPath);
                if (currentDocContent !== undefined && currentDocContent !== docContent) {
                    currentContent = currentDocContent;
                }

                // Process the ACP response
                // Pass the trigger line number (1-indexed) so text can be inserted after it
                await processACPResponse(response, docPath, currentContent, documentOps, triggerId, triggerLine);

                // For document triggers, remove the trigger line and clear cursor
                if (source === 'document' && change) {
                    // Remove the trigger line LAST (after all edits are applied)
                    const trigger = `@${identity.name}`;
                    documentOps.removeTriggerLine(docPath, trigger);

                    // Clear the agent's cursor position after all work is done
                    documentOps.updateCursor(docPath, 0);
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
