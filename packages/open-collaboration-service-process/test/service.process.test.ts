// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { Authentication, BinaryData, CreateRoomRequest, fromBinaryMessage, JoinRoomRequest, JoinSessionRequest, OnInitNotification, OpenDocument, toBinaryMessage, UpdateDocumentContent, UpdateTextSelection } from 'open-collaboration-service-process';
import { Deferred, FileData } from 'open-collaboration-protocol';
import { createMessageConnection, Message, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';

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
            new StreamMessageWriter(this.process.stdin), undefined, {messageStrategy: {
                handleMessage(message, next) {
                    // conversion of binary data to javascript objects
                    if (Message.isNotification(message) || Message.isRequest(message)) {
                        if (Array.isArray(message.params)) {
                            message.params =  message.params?.map((param) =>
                                BinaryData.is(param) ? fromBinaryMessage(param.data) : param);
                        } else {
                            message.params = BinaryData.is(message.params) ? fromBinaryMessage(message.params.data) as object : message.params;
                        }
                    } else if (Message.isResponse(message)) {
                        if (BinaryData.is(message.result)) {
                            message.result = fromBinaryMessage(message.result.data) as any;
                        }
                    }
                    next(message);
                },
            }});
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

        host.communicationHandler.onRequest('fileSystem/stat', (() => {
            return {method: 'fileSystem/stat', params: [{
                type: 2,
                mtime: 2132123,
                ctime: 124112,
                size: 1231,
            }]};
        }));

        host.communicationHandler.onRequest('fileSystem/readFile', ((path: string) => {
            expect(path).toEqual('testFolder/test.txt');
            return {
                type: 'binaryData',
                data: toBinaryMessage({
                    content: Uint8Array.from(new TextEncoder().encode('HELLO WORLD!')),
                } as FileData),
            } as BinaryData;
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

        const folderStat = await guest.communicationHandler.sendRequest('fileSystem/stat', 'testFolder', hostId );
        expect(folderStat).toBeDefined();

        // sending the file path as binary only for testing the conversion
        const fileContent = await guest.communicationHandler.sendRequest('fileSystem/readFile', {type: 'binaryData', data: toBinaryMessage('testFolder/test.txt')} as BinaryData, hostId) as FileData;
        expect(new TextDecoder().decode(fileContent.content)).toEqual('HELLO WORLD!');

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
