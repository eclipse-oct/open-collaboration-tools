// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { Authentication, CreateRoomRequest, fromEncodedOCPMessage, JoinRoomRequest, JoinSessionRequest, OCPRequest, OnInitNotification, OpenDocument, toEncodedOCPMessage, UpdateDocumentContent, UpdateTextSelection } from 'open-collaboration-service-process';
import { Deferred } from 'open-collaboration-protocol';
import { createMessageConnection, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';

const SERVER_ADDRESS = 'http://localhost:8100';
class Client {
    process: ChildProcessWithoutNullStreams;

    lastRequestId = 0;

    communicationHandler: MessageConnection;

    constructor() {
        this.process = spawn('node',
            [`${__dirname}/../lib/process.js`, '--server-address', SERVER_ADDRESS],
            {
                env: { ...process.env, 'OCT_JWT_PRIVATE_KEY': 'some_test_key'}
            });

        this.communicationHandler = createMessageConnection(
            new StreamMessageReader(this.process.stdout),
            new StreamMessageWriter(this.process.stdin));
        this.communicationHandler.listen();
    }
}

describe('Service Process', () => {
    let server: ChildProcessWithoutNullStreams;
    let host: Client;
    let guest: Client;
    beforeAll(async () => {
        // Start the collaboration server
        process.env.OCT_JWT_PRIVATE_KEY = 'some_test_key';
        server = spawn('node', [`${__dirname}/../../open-collaboration-server/bin/server`], {env: { ...process.env, 'OCT_ACTIVATE_SIMPLE_LOGIN': 'true' }});
        await new Promise<void>((resolve) => {
            server.stdout.on('data', (data) => {
                if (data.toString().includes('listening on localhost:8100')) {
                    resolve();
                    console.log('server started');
                } else {
                    console.log('Server: ', data.toString());
                }
            });
            server.stderr.on('data', (data) => {
                console.error('Server Error: ', data.toString());
            });
        });
    });
    afterAll(() => {
        server.kill();
    });

    beforeEach(() => {
        host = new Client();
        guest = new Client();
    });
    afterEach(() => {
        host.process?.kill();
        guest.process?.kill();
    });
    test('test service processes without login', async () => {
        // Setup host message handlers
        const updateArived = new Deferred();
        const selectionArived = new Deferred();
        let hostId: string = '';

        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => {
            return true;
        });
        host.communicationHandler.onNotification(UpdateDocumentContent, () => {
            updateArived.resolve();
        });
        host.communicationHandler.onNotification(UpdateTextSelection, () => {
            selectionArived.resolve();
        });

        host.communicationHandler.onRequest(OCPRequest, ((rawMessage) => {
            const message = typeof rawMessage === 'string' ? fromEncodedOCPMessage(rawMessage) : rawMessage;
            if(message.method === 'fileSystem/stat') {
                return {method: 'fileSystem/stat', params: [{
                    type: 2,
                    mtime: 2132123,
                    ctime: 124112,
                    size: 1231,
                }]};
            }
            return 'error';
        }));

        // Setup guest message handlers
        const initDeferred = new Deferred();
        guest.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'guest');
        });
        guest.communicationHandler.onNotification(OnInitNotification, (initData) => {
            hostId = initData.host.id;
            initDeferred.resolve();
        });

        // room creation
        const {roomId} = await host.communicationHandler.sendRequest(CreateRoomRequest, {name: 'test', folders: ['testFolder']});
        expect(roomId).toBeDefined();

        const {roomId: guestRoomId} = await guest.communicationHandler.sendRequest(JoinRoomRequest, roomId);
        expect(guestRoomId).toEqual(roomId);

        // await until guest is initialized
        await initDeferred.promise;

        expect(hostId).toBeTruthy();

        const folderStat = await guest.communicationHandler.sendRequest(OCPRequest, toEncodedOCPMessage({ method: 'fileSystem/stat', params: ['testFolder'], target: hostId }));
        expect(folderStat).toBeDefined();

        host.communicationHandler.sendNotification(OpenDocument, 'text', 'testFolder/test.txt', 'HELLO WORLD!');
        guest.communicationHandler.sendNotification(OpenDocument, 'text', 'testFolder/test.txt', 'HELLO WORLD!');

        guest.communicationHandler.sendNotification(UpdateTextSelection, 'testFolder/test.txt', [{ start: 0, end: 0, isReversed: false }]);

        await selectionArived.promise;

        guest.communicationHandler.sendNotification(UpdateDocumentContent, 'testFolder/test.txt', [{ startOffset: 5, text: ' NEW' }]);

        await updateArived.promise;

    }, 2000000);
});

async function makeSimpleLoginRequest(token: string, username: string) {
    await fetch(`${SERVER_ADDRESS}/api/login/simple/`, {
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
        body: JSON.stringify({ token, user: username }),
    });
}
