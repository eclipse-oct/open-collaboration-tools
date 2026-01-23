// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Register example MCP tools
 *
 * These are simple examples showing the tool pattern for MCP servers.
 * Replace with your own OCT-specific tools as needed.
 *
 * Example tools included:
 * - oct_echo: Echoes back a message (demonstrates basic tool with parameters)
 * - oct_get_version: Returns server version (demonstrates parameterless tool)
 *
 * To add OCT functionality, consider tools like:
 * - oct_connect: Connect to an OCT room
 * - oct_get_document: Read document content
 * - oct_apply_edit: Apply edits to documents
 * - oct_get_session_info: Get session metadata
 */
export function registerMCPTools(server: Server): void {
    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'oct_echo',
                description: 'Echo back a message (example tool)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: {
                            type: 'string',
                            description: 'Message to echo',
                        },
                    },
                    required: ['message'],
                },
            },
            {
                name: 'oct_get_version',
                description: 'Get server version (example tool)',
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
                case 'oct_echo': {
                    const { message } = args as { message: string };
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Echo: ${message}`,
                            },
                        ],
                    };
                }

                case 'oct_get_version': {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'OCT MCP Server v0.1.0 (skeleton)',
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
                        text: `Error: ${error}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
