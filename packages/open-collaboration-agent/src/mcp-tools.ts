// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DocumentSyncOperations, SessionInfo, LineEdit } from './document-operations.js';
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
 * Server state interface for tools
 */
export interface ToolContext {
    getState: () => {
        connection?: ProtocolBroadcastConnection;
        documentSync?: DocumentSync;
        documentOps?: DocumentSyncOperations;
        sessionInfo?: SessionInfo;
        serverUrl: string;
        pendingConnection?: Promise<void>;
        pendingTriggers?: TriggerEvent[];
        currentTrigger?: TriggerEvent;
        triggerWaiters?: Array<(trigger: TriggerEvent) => void>;
    };
    connect: (roomId: string, customServerUrl?: string) => Promise<{
        success: boolean;
        message: string;
        sessionInfo?: SessionInfo;
        loginUrl?: string;
    }>;
    disconnect: () => Promise<{ success: boolean; message: string }>;
}

/**
 * Register all MCP tools
 */
export function registerMCPTools(server: Server, context: ToolContext): void {
    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'oct_connect',
                description:
                    'Connect to an Open Collaboration Tools room. Requires roomId and optionally a custom server URL.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        roomId: {
                            type: 'string',
                            description: 'The room ID to join',
                        },
                        serverUrl: {
                            type: 'string',
                            description:
                                'Optional custom server URL (defaults to https://api.open-collab.tools/)',
                        },
                    },
                    required: ['roomId'],
                },
            },
            {
                name: 'oct_disconnect',
                description: 'Disconnect from the current OCT session',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'oct_get_connection_status',
                description:
                    'Get the current connection status and session information',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'oct_get_document',
                description: 'Get the full content of a document with line numbers (1-indexed)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Document path',
                        },
                    },
                    required: ['path'],
                },
            },
            {
                name: 'oct_get_document_range',
                description: 'Get a specific range of lines from a document (1-indexed, inclusive)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Document path',
                        },
                        startLine: {
                            type: 'number',
                            description: 'Starting line number (1-indexed)',
                        },
                        endLine: {
                            type: 'number',
                            description: 'Ending line number (1-indexed, inclusive)',
                        },
                    },
                    required: ['path', 'startLine', 'endLine'],
                },
            },
            {
                name: 'oct_apply_edit',
                description: 'Apply a line-based edit to a document',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Document path',
                        },
                        edit: {
                            type: 'object',
                            description: 'Line edit operation',
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['replace', 'insert', 'delete'],
                                    description: 'Edit type',
                                },
                                startLine: {
                                    type: 'number',
                                    description: 'Starting line number (1-indexed)',
                                },
                                endLine: {
                                    type: 'number',
                                    description:
                                        'Ending line number (1-indexed, required for replace/delete)',
                                },
                                content: {
                                    type: 'string',
                                    description: 'Content (required for replace/insert)',
                                },
                            },
                            required: ['type', 'startLine'],
                        },
                    },
                    required: ['path', 'edit'],
                },
            },
            {
                name: 'oct_remove_trigger_line',
                description: 'Remove a line containing the agent trigger pattern',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Document path',
                        },
                    },
                    required: ['path'],
                },
            },
            {
                name: 'oct_get_session_info',
                description: 'Get session information (room ID, agent name, etc.)',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'oct_trigger_start_processing',
                description: 'Stop the loading animation for a trigger and mark it as being processed',
                inputSchema: {
                    type: 'object',
                    properties: {
                        triggerId: {
                            type: 'string',
                            description: 'The ID of the trigger to start processing',
                        },
                    },
                    required: ['triggerId'],
                },
            },
            {
                name: 'oct_trigger_complete',
                description: 'Mark a trigger as completed and remove it from pending triggers',
                inputSchema: {
                    type: 'object',
                    properties: {
                        triggerId: {
                            type: 'string',
                            description: 'The ID of the trigger to complete',
                        },
                    },
                    required: ['triggerId'],
                },
            },
            {
                name: 'oct_wait_for_trigger',
                description: 'Block until the next @agent trigger arrives, then return trigger data. Used by monitoring agents to wait for triggers efficiently.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
        ],
    }));

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
        const { name, arguments: args } = request.params;

        try {
            switch (name) {
                case 'oct_connect': {
                    const { roomId, serverUrl } = args as {
                        roomId: string;
                        serverUrl?: string;
                    };
                    const result = await context.connect(roomId, serverUrl);

                    // Format response with special handling for login URL
                    let responseText: string;
                    if (result.loginUrl) {
                        responseText = `🔐 AUTHENTICATION REQUIRED

Please open the following URL in your browser to log in:

${result.loginUrl}

The connection will complete automatically once you authenticate.

---

${JSON.stringify(result, null, 2)}`;
                    } else {
                        responseText = JSON.stringify(result, null, 2);
                    }

                    return {
                        content: [
                            {
                                type: 'text',
                                text: responseText,
                            },
                        ],
                    };
                }

                case 'oct_disconnect': {
                    const result = await context.disconnect();
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2),
                            },
                        ],
                    };
                }

                case 'oct_get_connection_status': {
                    const state = context.getState();

                    // Wait for pending connection if it exists
                    if (state.pendingConnection) {
                        try {
                            await state.pendingConnection;
                        } catch (error) {
                            // Connection failed, but we still return status
                            console.error('Pending connection failed:', error);
                        }
                    }

                    const isConnected = !!state.connection;
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    {
                                        connected: isConnected,
                                        sessionInfo: state.sessionInfo,
                                    },
                                    null,
                                    2
                                ),
                            },
                        ],
                    };
                }

                case 'oct_get_document': {
                    const state = context.getState();
                    if (!state.documentOps) {
                        throw new Error('Not connected to an OCT session');
                    }

                    const { path } = args as { path: string };
                    const content = state.documentOps.getDocument(path);

                    if (!content) {
                        throw new Error(`Document not found: ${path}`);
                    }

                    // Add line numbers
                    const numberedContent = content
                        .split('\n')
                        .map((line, idx) => `${idx + 1}: ${line}`)
                        .join('\n');

                    return {
                        content: [
                            {
                                type: 'text',
                                text: numberedContent,
                            },
                        ],
                    };
                }

                case 'oct_get_document_range': {
                    const state = context.getState();
                    if (!state.documentOps) {
                        throw new Error('Not connected to an OCT session');
                    }

                    const { path, startLine, endLine } = args as {
                        path: string;
                        startLine: number;
                        endLine: number;
                    };

                    const lines = state.documentOps.getDocumentRange(
                        path,
                        startLine,
                        endLine
                    );

                    if (!lines) {
                        throw new Error(`Document not found: ${path}`);
                    }

                    // Add line numbers
                    const numberedLines = lines
                        .map((line, idx) => `${startLine + idx}: ${line}`)
                        .join('\n');

                    return {
                        content: [
                            {
                                type: 'text',
                                text: numberedLines,
                            },
                        ],
                    };
                }

                case 'oct_apply_edit': {
                    const state = context.getState();
                    if (!state.documentOps) {
                        throw new Error('Not connected to an OCT session');
                    }

                    const { path, edit } = args as { path: string; edit: LineEdit };
                    state.documentOps.applyEdit(path, edit);

                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    { success: true, message: 'Edit applied' },
                                    null,
                                    2
                                ),
                            },
                        ],
                    };
                }

                case 'oct_remove_trigger_line': {
                    const state = context.getState();
                    if (!state.documentOps || !state.sessionInfo) {
                        throw new Error('Not connected to an OCT session');
                    }

                    const { path } = args as { path: string };
                    const trigger = `@${state.sessionInfo.agentName}`;
                    state.documentOps.removeTriggerLine(path, trigger);

                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    { success: true, message: 'Trigger line removed' },
                                    null,
                                    2
                                ),
                            },
                        ],
                    };
                }

                case 'oct_get_session_info': {
                    const state = context.getState();
                    if (!state.sessionInfo) {
                        throw new Error('Not connected to an OCT session');
                    }

                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(state.sessionInfo, null, 2),
                            },
                        ],
                    };
                }

                case 'oct_trigger_start_processing': {
                    const state = context.getState();
                    const { triggerId } = args as { triggerId: string };

                    // Find the trigger
                    const trigger = state.pendingTriggers?.find(t => t.id === triggerId);
                    if (!trigger) {
                        throw new Error(`Trigger not found: ${triggerId}`);
                    }

                    // Stop the animation
                    const animationAbort = (trigger as any).animationAbort as AbortController | undefined;
                    if (animationAbort) {
                        animationAbort.abort();
                        console.error(`[MCP] Stopped loading animation for trigger ${triggerId}`);
                    }

                    // Wait for animation to complete
                    const animationPromise = (trigger as any).animationPromise as Promise<void> | undefined;
                    if (animationPromise) {
                        try {
                            await animationPromise;
                        } catch (error) {
                            // Animation was aborted, which is expected
                        }
                    }

                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    { success: true, message: 'Animation stopped, trigger is being processed' },
                                    null,
                                    2
                                ),
                            },
                        ],
                    };
                }

                case 'oct_trigger_complete': {
                    const state = context.getState();
                    const { triggerId } = args as { triggerId: string };

                    // Find and remove the trigger
                    const triggerIndex = state.pendingTriggers?.findIndex(t => t.id === triggerId);
                    if (triggerIndex === undefined || triggerIndex === -1) {
                        throw new Error(`Trigger not found: ${triggerId}`);
                    }

                    const trigger = state.pendingTriggers![triggerIndex];

                    // Stop the animation if still running
                    const animationAbort = (trigger as any).animationAbort as AbortController | undefined;
                    if (animationAbort) {
                        animationAbort.abort();
                    }

                    // Wait for animation to complete
                    const animationPromise = (trigger as any).animationPromise as Promise<void> | undefined;
                    if (animationPromise) {
                        try {
                            await animationPromise;
                        } catch (error) {
                            // Animation was aborted, which is expected
                        }
                    }

                    // Remove from pending triggers
                    state.pendingTriggers!.splice(triggerIndex, 1);

                    // Clear current trigger if it's this one
                    if (state.currentTrigger?.id === triggerId) {
                        state.currentTrigger = state.pendingTriggers![state.pendingTriggers!.length - 1];
                    }

                    console.error(`[MCP] Trigger ${triggerId} completed and removed from queue`);

                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    { success: true, message: 'Trigger completed' },
                                    null,
                                    2
                                ),
                            },
                        ],
                    };
                }

                case 'oct_wait_for_trigger': {
                    const state = context.getState();

                    // Check if not connected
                    if (!state.connection) {
                        throw new Error('Not connected to an OCT session');
                    }

                    console.error('[MCP] oct_wait_for_trigger called - blocking until trigger arrives');

                    // Check if there's already a pending trigger
                    if (state.currentTrigger) {
                        console.error(`[MCP] Trigger already available: ${state.currentTrigger.id}`);
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(state.currentTrigger, null, 2),
                                },
                            ],
                        };
                    }

                    // Wait for the next trigger
                    const trigger = await new Promise<TriggerEvent>((resolve) => {
                        // Initialize triggerWaiters array if needed
                        if (!state.triggerWaiters) {
                            state.triggerWaiters = [];
                        }

                        // Add this waiter to the queue
                        state.triggerWaiters.push(resolve);
                        console.error(`[MCP] Waiting for trigger... (${state.triggerWaiters.length} waiters)`);
                    });

                    console.error(`[MCP] Trigger received: ${trigger.id}`);

                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(trigger, null, 2),
                            },
                        ],
                    };
                }

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { error: String(error) },
                            null,
                            2
                        ),
                    },
                ],
                isError: true,
            };
        }
    });
}
