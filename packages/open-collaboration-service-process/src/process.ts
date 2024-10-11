// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ConnectionProvider, SocketIoTransportProvider }from 'open-collaboration-protocol';
import { MessageHandler } from './message-handler';
import { program } from 'commander';
import {createMessageConnection, StreamMessageReader, StreamMessageWriter} from 'vscode-jsonrpc/node';
import { Authentication } from './messages';

program
    .option('--server-address <server-address>', 'The address of the server to connect to')
    .option('--auth-token <auth-token>', 'The authentication token to use if available');

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
    },
    transports: [SocketIoTransportProvider],
    url: args.serverAddress  ?? '',
    userToken: args.authToken
});

new MessageHandler(connectionProvider, communicationHandler);
