// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { DocumentSyncOperations, SessionInfo } from './document-operations.js';
import type { DocumentSync } from './document-sync.js';
import type { ProtocolBroadcastConnection } from 'open-collaboration-protocol';

/**
 * Trigger event information
 */
export interface TriggerEvent {
    id: string;
    docPath: string;
    docContent: string;
    prompt: string;
    offset: number;
    timestamp: number;
}

/**
 * Server state interface for resources
 */
export interface ResourceContext {
    getState: () => {
        connection?: ProtocolBroadcastConnection;
        documentSync?: DocumentSync;
        documentOps?: DocumentSyncOperations;
        sessionInfo?: SessionInfo;
        serverUrl: string;
        pendingTriggers?: TriggerEvent[];
        currentTrigger?: TriggerEvent;
    };
}

/**
 * Register all MCP resources
 */
export function registerMCPResources(server: Server, context: ResourceContext): void {
    // List available resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        const state = context.getState();
        const resources: Array<{
            uri: string;
            name: string;
            description?: string;
            mimeType?: string;
        }> = [];

        // Session info resource (always available)
        resources.push({
            uri: 'oct://session/info',
            name: 'Session Information',
            description: 'Current OCT session information and connection status',
            mimeType: 'application/json',
        });

        // Document resources (only if connected)
        if (state.documentOps) {
            const activePath = state.documentOps.getActiveDocumentPath();
            if (activePath) {
                resources.push({
                    uri: `oct://documents/${activePath}`,
                    name: `Document: ${activePath}`,
                    description: 'Currently active document content',
                    mimeType: 'text/plain',
                });
            }
        }

        // Trigger resources (if any triggers are pending)
        if (state.currentTrigger) {
            resources.push({
                uri: 'oct://triggers/current',
                name: 'Current Trigger',
                description: 'Most recent @agent trigger detected in the collaboration session',
                mimeType: 'application/json',
            });
        }

        if (state.pendingTriggers && state.pendingTriggers.length > 0) {
            resources.push({
                uri: 'oct://triggers/pending',
                name: 'Pending Triggers',
                description: 'All pending @agent triggers waiting to be processed',
                mimeType: 'application/json',
            });
        }

        return { resources };
    });

    // Read resource content
    server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
        const { uri } = request.params;

        try {
            // Parse resource URI
            const url = new URL(uri);

            if (url.protocol !== 'oct:') {
                throw new Error(`Unsupported protocol: ${url.protocol}`);
            }

            // Handle session info resource
            if (url.pathname === '//session/info') {
                const state = context.getState();
                const isConnected = !!state.connection;

                const info = {
                    connected: isConnected,
                    sessionInfo: state.sessionInfo || null,
                    serverUrl: state.serverUrl,
                };

                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify(info, null, 2),
                        },
                    ],
                };
            }

            // Handle document resources
            if (url.pathname.startsWith('//documents/')) {
                const state = context.getState();
                if (!state.documentOps) {
                    throw new Error('Not connected to an OCT session');
                }

                const documentPath = url.pathname.slice('//documents/'.length);
                const content = state.documentOps.getDocument(documentPath);

                if (!content) {
                    throw new Error(`Document not found: ${documentPath}`);
                }

                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'text/plain',
                            text: content,
                        },
                    ],
                };
            }

            // Handle current trigger resource
            if (url.pathname === '//triggers/current') {
                const state = context.getState();
                if (!state.currentTrigger) {
                    throw new Error('No current trigger available');
                }

                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify(state.currentTrigger, null, 2),
                        },
                    ],
                };
            }

            // Handle pending triggers resource
            if (url.pathname === '//triggers/pending') {
                const state = context.getState();
                if (!state.pendingTriggers || state.pendingTriggers.length === 0) {
                    throw new Error('No pending triggers');
                }

                return {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text: JSON.stringify(state.pendingTriggers, null, 2),
                        },
                    ],
                };
            }

            throw new Error(`Unknown resource: ${uri}`);
        } catch (error) {
            throw new Error(`Failed to read resource: ${error}`);
        }
    });
}
