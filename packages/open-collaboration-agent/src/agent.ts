// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { webcrypto } from 'node:crypto';
import { ConnectionProvider, SocketIoTransportProvider, initializeProtocol } from 'open-collaboration-protocol';
import type { ConnectionProviderOptions, Peer } from 'open-collaboration-protocol';
import { DocumentSync, DocumentChange } from './document-sync.js';
import { executePromptStreamed } from './prompt.js';
import { animateLoadingIndicator, applyChangesStreamed } from './agent-util.js';

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

    runAgent(documentSync, identity, options);
}

export function runAgent(documentSync: DocumentSync, identity: Peer, options: AgentOptions): void {
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

    documentSync.onActiveChange((documentPath: string) => {
        console.log(`Active document: ${documentPath}`);
    });

    const trigger = `@${identity.name}`;
    documentSync.onDocumentChange(async (docPath: string, docContent: string, changes: DocumentChange[]) => {
        if (state.executing) {
            // Don't start another execution while the previous one is running
            state.documentChanged = true;
            if (state.animationAbort) {
                state.animationAbort.abort();
                state.animationAbort = undefined;
            }
            return;
        }
        for (const change of changes) {
            if (change.type === 'insert' && change.text.endsWith('\n')) {
                // Extract the line that was just completed
                const docLines = docContent.split('\n');
                const completedLine = docLines[change.position.line];

                const triggerIndex = completedLine?.indexOf(trigger);
                if (triggerIndex !== undefined && triggerIndex !== -1) {
                    // The trigger string was found in the completed line
                    const prompt = completedLine.substring(triggerIndex + trigger.length).trim();
                    if (prompt.length > 0) {
                        console.log(`Received prompt: "${prompt}"`);
                        // Create an AbortController for the loading animation
                        state.animationAbort = new AbortController();
                        try {
                            state.executing = true;

                            // Start the loading animation right after the trigger
                            const animationOffset = change.offset - (completedLine.length - triggerIndex - trigger.length);
                            const animation = animateLoadingIndicator(docPath, animationOffset, documentSync, state.animationAbort.signal);

                            // const changes = await executePrompt({
                            //     document: docContent,
                            //     prompt,
                            //     promptOffset: change.offset,
                            //     model: options.model
                            // });

                            const streamedChanges = executePromptStreamed({
                                document: docContent,
                                prompt,
                                promptOffset: change.offset,
                                model: options.model
                            });
                            let currentContent = docContent;
                            let currentLines = docLines;
                            if (state.documentChanged) {
                                currentContent = documentSync.getActiveDocumentContent() ?? docContent;
                                currentLines = currentContent.split('\n');
                            }
                            await applyChangesStreamed(docPath, currentContent, currentLines, documentSync, completedLine, streamedChanges);

                            // Abort the animation
                            state.animationAbort?.abort();
                            await animation;

                            // if (changes.length > 0) {
                            //     // Apply the changes to the document
                            //     console.log(`Applying ${changes.length} changes to ${docPath}`);
                            //     let currentContent = docContent;
                            //     let currentLines = docLines;
                            //     if (state.documentChanged) {
                            //         currentContent = documentSync.getActiveDocumentContent() ?? docContent;
                            //         currentLines = currentContent.split('\n');
                            //     }
                            //     applyChanges(docPath, currentContent, currentLines, changes, documentSync);
                            // }
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
    });
}
