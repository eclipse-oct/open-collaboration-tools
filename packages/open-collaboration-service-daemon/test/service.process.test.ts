// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import * as messages from 'open-collaboration-service-daemon/src/messages';
import { Deferred, Emitter } from 'open-collaboration-protocol';

const authTokenHost: string = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IkF2S2JlczliU1hDZ0FxSHhwa0xqYVRBcyIsIm5hbWUiOiJob3N0IiwiZW1haWwiOiIiLCJhdXRoUHJvdmlkZXIiOiJVbnZlcmlmaWVkIiwiaWF0IjoxNzM4MjQxNTcwfQ.IWetdyBTAo2DswcYKs5Jzxl3AzuKGccFnGsc5A9XE8s';
const authTokenGuest: string = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IlBrQmN4blBJc1Qzenl5YVlLUEpGWXRxViIsIm5hbWUiOiJndWVzdCIsImVtYWlsIjoiIiwiYXV0aFByb3ZpZGVyIjoiVW52ZXJpZmllZCIsImlhdCI6MTczODI0MTY0Nn0.ABHj54q5u_z1Cd57Mscryp4rMPPiwxLLfSl-anCtD1E';

class Client {
    process: ChildProcessWithoutNullStreams;

    lastRequestId = 0;

    private onMessageEmitter = new Emitter<messages.DaemonMessage>();
    onMessage = this.onMessageEmitter.event;

    constructor(token: string) {
        this.process = spawn('node',
            [`${__dirname}/../lib/process.js`, '--auth-token', token, '--server-address', 'http://localhost:8100'],
            {
                env: { ...process.env, 'OCT_JWT_PRIVATE_KEY': 'some_test_key'}
            });
        this.process.stdout.on('data', (data) => {
            console.log('stdout: ', data.toString());
            const message = JSON.parse(data.toString()) as messages.DaemonMessage;
            this.onMessageEmitter.fire(message);
        });

        this.process.stderr.on('data', (data) => {
            console.log('stderr: ', data.toString());
            console.error(data.toString());
        });
    }

    async sendRequest(content: object, target?: string): Promise<messages.Response> {
        const id = this.lastRequestId++;
        this.process.stdin.write(JSON.stringify({
            kind: 'request',
            content,
            id,
            target
        } as messages.Request));

        return new Promise<messages.Response>((resolve) => {
            const listener = this.onMessageEmitter.event((message) => {
                if (message.kind === 'response' && message.id === id) {
                    resolve(message);
                    listener.dispose();
                }
            });
        });
    }

    async sendResponse(content: object, id: number) {
        this.process.stdin.write(JSON.stringify({
            kind: 'response',
            content,
            id
        } as messages.Response));
    }

    sendNotification(content: object, target?: string) {
        this.process.stdin.write(JSON.stringify({
            kind: 'notification',
            content,
            target
        } as messages.Notification));
    }

    sendBroadcast(content: object) {
        this.process.stdin.write(JSON.stringify({
            kind: 'broadcast',
            content
        } as messages.Broadcast));
    }
}

describe('Service Process', () => {
    let server: ChildProcessWithoutNullStreams;
    let host: Client;
    let guest: Client;
    beforeAll(async () => {
        //Start the collaboration server
        process.env.OCT_JWT_PRIVATE_KEY = 'some_test_key';
        server = spawn('node', [`${__dirname}/../../open-collaboration-server/bin/server`, 'start']);
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
        host = new Client(authTokenHost);
        guest = new Client(authTokenGuest);
    });
    afterEach(() => {
        host.process?.kill();
        guest.process?.kill();
    });
    test('test service processes without login', async () => {
        const roomInfoResp = await host.sendRequest({method: 'room/createRoom', params: [{name: 'test', folders: ['testFolder']}]} as messages.CreateRoomRequest);
        const roomId = (roomInfoResp.content as messages.SessionCreatedResponse).params[1];
        expect(roomId).toBeDefined();

        const updateArived = new Deferred();
        host.onMessage(message => {
            if(message.kind === 'request' && message.content.method === 'peer/onJoinRequest') {
                host.sendResponse({method: 'room/joinRoom', params: [true]} as messages.JoinRequestResponse, message.id);
                console.log('host accepted join request');
            } else if(message.kind === 'request' && message.content.method === 'fileSystem/stat') {
                console.log('filesystem request');
                host.sendResponse({method: 'fileSystem/stat', params: {
                    type: 2,
                    mtime: 2132123,
                    ctime: 124112,
                    size: 1231,
                }}, message.id);
            } else if (message.kind === 'notification' && message.content.method === 'awareness/updateDocument') {
                expect((message.content as messages.UpdateDocumentContent).params[1].length).toBe(1);
                updateArived.resolve();
            }
        });

        const initDeferred = new Deferred();

        let hostId: string = '';

        guest.onMessage(message => {
            if(message.kind === 'notification' && message.content.method === 'init') {
                hostId = (message.content as messages.OnInitNotification).params[0].host.id;
                initDeferred.resolve();
            }
        });

        const joinResp = await guest.sendRequest({method: 'room/joinRoom', params: [roomId]} as messages.JoinRoomRequest);
        const guestRoomId = (joinResp.content as messages.SessionCreatedResponse).params[1];
        expect(guestRoomId).toEqual(roomId);

        // await until guest is initialized
        await initDeferred.promise;

        expect(hostId).toBeTruthy();

        const folderStat = await guest.sendRequest({ method: 'fileSystem/stat', params: ['testFolder'] }, hostId);
        expect(folderStat).toBeDefined();

        host.sendNotification({ method: 'awareness/openDocument', params: ['text', 'ocp://testFolder/test.txt', 'HELLO WORLD!']} as messages.OpenDocument);
        guest.sendNotification({ method: 'awareness/openDocument', params: ['text', 'ocp://testFolder/test.txt', 'HELLO WORLD!']} as messages.OpenDocument);

        guest.sendNotification({ method: 'awareness/updateDocument', params: ['ocp://testFolder/test.txt', [{ startOffset: 5, text: ' NEW' }]]} as messages.UpdateDocumentContent);

        await updateArived.promise;

    }, 2000000);
});
