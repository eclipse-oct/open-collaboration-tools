// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerMCPTools } from './mcp-tools.js';
import { registerMCPResources } from './mcp-resources.js';

/**
 * Start the MCP server
 *
 * This is a minimal skeleton showing how to create an MCP server for OCT.
 * It demonstrates the basic MCP protocol patterns without OCT integration.
 *
 * Extend this with your own tools and resources as needed:
 * - Add OCT protocol connection management
 * - Add document synchronization
 * - Add trigger detection
 * - Add custom tools and resources
 *
 * The main oct-agent uses ACP (Agent Client Protocol) for full functionality.
 * This MCP skeleton is provided for specialized use cases where MCP is beneficial.
 */
export async function startMCPServer(): Promise<void> {
    // Create MCP server with basic capabilities
    const server = new Server(
        {
            name: 'oct-mcp-skeleton',
            version: '0.1.0',
        },
        {
            capabilities: {
                tools: {},
                resources: {},
            },
        }
    );

    // Register example tools and resources
    // Replace these with your own OCT-specific implementations
    registerMCPTools(server);
    registerMCPResources(server);

    // Start server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('OCT MCP Server (skeleton) started');
    console.error('This is a minimal example. Extend with your own tools/resources.');
    console.error('For full agent functionality, use oct-agent with ACP instead.');
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    startMCPServer().catch(console.error);
}
