// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import 'reflect-metadata';
import * as crypto from 'node:crypto';
import { program } from 'commander';
import serverModule from './inversify-module.js';
import { Container } from 'inversify';
import { initializeProtocol } from 'open-collaboration-protocol';
import { CollaborationServer } from './collaboration-server.js';
import { ConfigurationFile } from './utils/configuration.js';
import pck from '../package.json' with { type: 'json' };

initializeProtocol({
    cryptoModule: crypto.webcrypto
});

function startServer(options: { port: number, hostname: string, config: string }) {
    const container = new Container();
    container.bind(ConfigurationFile).toConstantValue(options.config);
    container.load(serverModule);
    const server = container.get(CollaborationServer);
    server.startServer(options);
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

function myParseInt(value, dummyPrevious) {
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new commander.InvalidArgumentError('Not a number.');
  }
  return parsedValue;
}

program
    .version(pck.version)
    .option('-p, --port <number>', 'Port to listen on', myParseInt, 8100)
    .option('-h, --hostname <string>', 'Hostname to bind to', 'localhost')
    .option('-c, --config <string>', 'Path to the configuration file')
    .action(startServer);

// Deprecated start command for backwards compatibility
program.command('start')
    .option('-p, --port <number>', 'Port to listen on', myParseInt, 8100)
    .option('-h, --hostname <string>', 'Hostname to bind to', 'localhost')
    .option('-l, --log-level <string>', 'Log level', 'info')
    .option('-c, --config <string>', 'Path to the configuration file')
    .action(options => {
        console.warn("The 'start' command is deprecated. Start the server without any CLI command instead.");
        startServer(options);
    });

program.parse();
