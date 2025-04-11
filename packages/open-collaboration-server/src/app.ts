// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import 'reflect-metadata';
import * as crypto from 'node:crypto';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import serverModule from './container.js';
import { Container } from 'inversify';
import { initializeProtocol } from 'open-collaboration-protocol';
import { CollaborationServer } from './collaboration-server.js';
import { LogLevelSymbol, checkLogLevel } from './utils/logging.js';

initializeProtocol({
    cryptoModule: crypto.webcrypto
});

const container = new Container();
container.load(serverModule);
const server = container.get(CollaborationServer);

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const command = yargs(hideBin(process.argv)).command<{
    port: number,
    hostname: string,
    logLevel: string
}>({
    command: 'start',
    describe: 'Start the server',
    builder: {
        'port': {
            type: 'number',
            default: 8100
        },
        'hostname': {
            type: 'string',
            default: 'localhost'
        },
        'logLevel': {
            type: 'string',
            default: 'info'
        }
    },
    handler: async args => {
        const logLevel = checkLogLevel(args.logLevel);
        container.rebind(LogLevelSymbol).toConstantValue(logLevel);
        server.startServer(args);
    }
});
command.parse();
