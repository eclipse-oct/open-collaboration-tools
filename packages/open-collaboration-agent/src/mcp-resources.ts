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

/**
 * Register example MCP resources
 *
 * These are simple examples showing the resource pattern for MCP servers.
 * Replace with your own OCT-specific resources as needed.
 *
 * Example resource included:
 * - oct://server/info: Basic server information
 *
 * To add OCT functionality, consider resources like:
 * - oct://session/info: OCT session information
 * - oct://documents/{path}: Document content
 * - oct://triggers/current: Current trigger information
 * - oct://triggers/pending: List of pending triggers
 */
export function registerMCPResources(server: Server): void {
    // List available resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
            {
                uri: 'oct://server/info',
                name: 'Server Information',
                description: 'Basic server information (example resource)',
                mimeType: 'application/json',
            },
        ],
    }));

    // Read resource content
    server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
        const { uri } = request.params;

        try {
            const url = new URL(uri);

            if (url.protocol !== 'oct:') {
                throw new Error(`Unsupported protocol: ${url.protocol}`);
            }

            if (url.pathname === '//server/info') {
                const info = {
                    name: 'OCT MCP Server',
                    version: '0.1.0',
                    type: 'skeleton-example',
                    description: 'Minimal MCP server skeleton for OCT extensions',
                    note: 'This is a skeleton implementation. For full agent functionality, use oct-agent with ACP.',
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

            throw new Error(`Unknown resource: ${uri}`);
        } catch (error) {
            throw new Error(`Failed to read resource: ${error}`);
        }
    });
}
