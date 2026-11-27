// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as crypto from 'node:crypto';
import { ConnectionProvider, initializeProtocol, SocketIoTransportProvider } from 'open-collaboration-protocol';
import { MessageHandler } from './message-handler.js';
import { InvalidArgumentError, program } from 'commander';
import {createMessageConnection, StreamMessageReader, StreamMessageWriter} from 'vscode-jsonrpc/node.js';
import { Authentication } from './messages.js';

initializeProtocol({
    cryptoModule: crypto.webcrypto
});

program
    .option('--server-address <server-address>', 'The address of the server to connect to')
    .option('--auth-token <auth-token>', 'The authentication token to use if available')
    .option('--edit-timeout <milliseconds>', 'How long to wait for the client to answer a document/applyEdit before reading its buffer anew. 0 waits forever.', parseMilliseconds);

function parseMilliseconds(value: string): number {
    if (!/^\d+$/.test(value.trim())) {
        throw new InvalidArgumentError('Expected a non-negative integer number of milliseconds.');
    }
    return Number(value);
}

program.parse();

const args = program.opts();

const communicationHandler = createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout));
communicationHandler.listen();

const connectionProvider = new ConnectionProvider({
    fetch: fetch,
    authenticationHandler: async (token, metadata) => {
        communicationHandler.sendNotification(Authentication, token, metadata);
        return true;
    },
    transports: [SocketIoTransportProvider],
    url: args.serverAddress  ?? '',
    userToken: args.authToken
});

new MessageHandler(connectionProvider, communicationHandler, { editTimeout: args.editTimeout });
