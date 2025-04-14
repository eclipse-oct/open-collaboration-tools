// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import 'reflect-metadata';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { program } from 'commander';
import serverModule from './inversify-module.js';
import { Container } from 'inversify';
import { initializeProtocol } from 'open-collaboration-protocol';
import { CollaborationServer } from './collaboration-server.js';
import { ConfigurationFile } from './utils/configuration.js';

initializeProtocol({
    cryptoModule: crypto.webcrypto
});

// This is a replacement for `__dirname`
function getDirname(): string {
    return url.fileURLToPath(new URL('.', import.meta.url));
}

function getVersion(): string {
    const ownPackagePath = path.resolve(getDirname(), '..', 'package.json');
    const packString = fs.readFileSync(ownPackagePath, { encoding: 'utf-8' });
    const pack = JSON.parse(packString);
    return pack.version;
}

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

program
    .version(getVersion())
    .option('-p, --port <number>', 'Port to listen on', parseInt, 8100)
    .option('-h, --hostname <string>', 'Hostname to bind to', 'localhost')
    .option('-c, --config <string>', 'Path to the configuration file')
    .action(startServer);

// Deprecated start command for backwards compatibility
program.command('start')
    .option('-p, --port <number>', 'Port to listen on', parseInt, 8100)
    .option('-h, --hostname <string>', 'Hostname to bind to', 'localhost')
    .option('-l, --log-level <string>', 'Log level', 'info')
    .option('-c, --config <string>', 'Path to the configuration file')
    .action(options => {
        console.warn("The 'start' command is deprecated. Start the server without any CLI command instead.");
        startServer(options);
    });

program.parse();
