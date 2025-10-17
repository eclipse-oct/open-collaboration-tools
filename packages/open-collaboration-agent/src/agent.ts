// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { webcrypto } from 'node:crypto';
import { ConnectionProvider, SocketIoTransportProvider, initializeProtocol } from 'open-collaboration-protocol';
import type { ConnectionProviderOptions, Peer } from 'open-collaboration-protocol';
import { DocumentSync, DocumentChange } from './document-sync.js';
import { executeLLM } from './prompt.js';
import { animateLoadingIndicator } from './agent-util.js';
import { DocumentSyncOperations } from './document-operations.js';

export interface AgentOptions {
    server: string
    room: string
    model: string
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

    // Register signal handlers for graceful shutdown
    const cleanup = async () => {
        try {
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

    runAgent(documentSync, identity, options);
}

export interface TriggerDetectionOptions {
    agentName: string
    model: string
    documentSync: DocumentSync
    documentOps: DocumentSyncOperations
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

    const { agentName, model, documentSync, documentOps } = options;
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

                            // Start the loading animation right after the trigger
                            const animationOffset = change.offset - 1; // Position before the newline
                            const animation = animateLoadingIndicator(docPath, animationOffset, documentSync, state.animationAbort.signal);

                            // Use direct LLM execution (no tool calls)
                            const lineEdits = await executeLLM({
                                document: docContent,
                                prompt,
                                promptOffset: change.offset,
                                model
                            });

                            // Abort the animation
                            state.animationAbort?.abort();
                            await animation;

                            // Get current content in case it changed during execution
                            let currentContent = docContent;
                            if (state.documentChanged) {
                                currentContent = documentSync.getActiveDocumentContent() ?? docContent;
                            }

                            // Apply line edits FIRST (they're based on the document with the trigger line)
                            if (lineEdits.length > 0) {
                                console.error(`Applying ${lineEdits.length} line edits to ${docPath}`);
                                // Set initial cursor position at the start of the first edit
                                const firstEdit = lineEdits[0];
                                const initialOffset = firstEdit.startLine > 0
                                    ? currentContent.split('\n').slice(0, firstEdit.startLine - 1).reduce((acc, line) => acc + line.length + 1, 0)
                                    : 0;
                                documentOps.updateCursor(docPath, initialOffset);

                                await documentOps.applyEditsAnimated(docPath, lineEdits);
                            }

                            // Remove the trigger line LAST (after all edits are applied)
                            documentOps.removeTriggerLine(docPath, trigger);

                            // Clear the agent's cursor position after all work is done
                            documentOps.updateCursor(docPath, 0);
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

export function runAgent(documentSync: DocumentSync, identity: Peer, options: AgentOptions): void {
    // Create document operations wrapper
    const documentOps = new DocumentSyncOperations(documentSync, {
        roomId: options.room,
        agentId: identity.id,
        agentName: identity.name,
        hostId: '', // Will be set when connection is established
        serverUrl: options.server
    });

    // Setup trigger detection
    setupTriggerDetection({
        agentName: identity.name,
        model: options.model,
        documentSync,
        documentOps
    });
}
