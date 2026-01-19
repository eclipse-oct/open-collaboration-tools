// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { program } from 'commander';
import { startCLIAgent } from './agent.js';
import pck from '../package.json' with { type: 'json' };

import 'dotenv/config';

program
    .version(pck.version)
    .option('-s, --server <string>', 'URL of the Open Collaboration Server to connect to', 'https://api.open-collab.tools/')
    .option('--acp-agent <command>', 'Command to run ACP agent (default: npx @zed-industries/claude-code-acp). Allows using other ACP adapters.', 'npx @zed-industries/claude-code-acp')
    .requiredOption('-r, --room <string>', 'Room ID to join')
    .action(options => startCLIAgent(options).catch(console.error));

program.parse();
