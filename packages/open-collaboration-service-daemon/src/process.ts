// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { StdioCommunicationHandler } from './communication-handler';
// import { ProtocolBroadcastConnection, Deferred, DisposableCollection } from 'open-collaboration-protocol';
// import * as vscode from 'vscode';
// import * as Y from 'yjs';
// import * as awarenessProtocol from 'y-protocols/awareness';
import { ConnectionProvider, SocketIoTransportProvider }from 'open-collaboration-protocol';
import { parseArgs } from 'util';
import { MessageHandler } from './message-handler';

const args = parseArgs({options: {
    'server-address': {type: 'string'},
    'auth-token': {type: 'string'},
}});

const communicationHandler = new StdioCommunicationHandler();

const connectionProvider = new ConnectionProvider({
    fetch: fetch,
    opener: async (url) => {
        communicationHandler.sendMessage({kind: 'open-url', url});
    },
    transports: [SocketIoTransportProvider],
    url: args.values['server-address'] ?? '',
    userToken: args.values['auth-token']
});

new MessageHandler(connectionProvider, communicationHandler);
