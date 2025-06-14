// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { program } from 'commander';
import { startCLIAgent } from './agent.js';
import pck from '../package.json' with { type: 'json' };

// API keys for LLM providers are loaded from .env file
import 'dotenv/config';

program
    .version(pck.version)
    .option('-s, --server <string>', 'URL of the Open Collaboration Server to connect to', 'https://api.open-collab.tools/')
    .option('-m, --model <string>', 'LLM model to use (e.g. claude-3-5-sonnet-latest, gpt-4o)', 'claude-3-5-sonnet-latest')
    .requiredOption('-r, --room <string>', 'Room ID to join')
    .action(options => startCLIAgent(options).catch(console.error));

program.parse();
