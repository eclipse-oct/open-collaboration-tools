// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { StdioCommunicationHandler } from './communication-handler';
import { ConnectionProvider, SocketIoTransportProvider }from 'open-collaboration-protocol';
import { MessageHandler } from './message-handler';
import { program } from 'commander';

program
    .option('--server-address <server-address>', 'The address of the server to connect to')
    .option('--auth-token <auth-token>', 'The authentication token to use if available');

program.parse();

const args = program.opts();

const communicationHandler = new StdioCommunicationHandler();

const connectionProvider = new ConnectionProvider({
    fetch: fetch,
    opener: async (url) => {
        communicationHandler.sendMessage({ kind: 'notification', content: { method: 'onOpenUrl', params: [url]}});
    },
    transports: [SocketIoTransportProvider],
    url: args.serverAddress  ?? '',
    userToken: args.authToken
});

new MessageHandler(connectionProvider, communicationHandler);
