// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import * as messages from 'open-collaboration-service-daemon/src/messages';
import { Deferred, Emitter } from 'open-collaboration-protocol';

const authTokenHost: string = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjlGS1lQMzloc1VZRkdKaDhfV2JMa3UxZyIsIm5hbWUiOiJIb3N0IiwiZW1haWwiOiIiLCJhdXRoUHJvdmlkZXIiOiJVbnZlcmlmaWVkIiwiaWF0IjoxNzMxNDIyMDc5fQ.cCyHYDCb_XZmVaqMAk9wyGdCK31MovNr4Gbzcn0Rg-0';
const authTokenGuest: string = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImNWcDlWSGZsQmNMTFFCQldHZ2dLeTFmTiIsIm5hbWUiOiJQZWVyIiwiZW1haWwiOiIiLCJhdXRoUHJvdmlkZXIiOiJVbnZlcmlmaWVkIiwiaWF0IjoxNzMxNDIyMTEwfQ.wnEpn79rp6hdnMO1eLcD2PCsSTpsr47FRk-BhgCb9mk';

class Client {
    process: ChildProcessWithoutNullStreams;

    lastRequestId = 0;

    private onMessageEmitter = new Emitter<messages.DaemonMessage>();
    onMessage = this.onMessageEmitter.event;

    constructor(token: string) {
        this.process = spawn('node', ['./lib/process.js', '--auth-token', token, '--server-address', 'http://localhost:8100']);

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
        server = spawn('node', ['../open-collaboration-server/bin/server', 'start']);
        await new Promise<void>((resolve) => {
            server.stdout.on('data', (data) => {
                if (data.toString().includes('listening on localhost:8100')) {
                    resolve();
                }
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
        const roomInfoResp = await host.sendRequest({method: 'room/createRoom', workspace: {name: 'test', folders: ['testFolder']}} as messages.CreateRoomRequest);
        const roomId = (roomInfoResp.content as messages.SessionCreatedResponse).roomId;
        expect(roomId).toBeDefined();

        const updateArived = new Deferred();
        host.onMessage(message => {
            if(message.kind === 'request' && message.content.method === 'peer/onJoinRequest') {
                host.sendResponse({method: 'room/joinRoom', accepted: true} as messages.JoinRequestResponse, message.id);
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
                expect((message.content as messages.UpdateDocumentContent).changes.length).toBe(1);
                updateArived.resolve();
            }
        });

        const initDeferred = new Deferred();

        let hostId: string = '';

        guest.onMessage(message => {
            if(message.kind === 'notification' && message.content.method === 'init') {
                hostId = (message.content as messages.OnInitNotification).initData.host.id;
                initDeferred.resolve();
            }
        });

        const joinResp = await guest.sendRequest({method: 'room/joinRoom', room: roomId} as messages.JoinRoomRequest);
        const guestRoomId = (joinResp.content as messages.SessionCreatedResponse).roomId;
        expect(guestRoomId).toEqual(roomId);

        // await until guest is initialized
        await initDeferred.promise;

        expect(hostId).toBeTruthy();

        const folderStat = await guest.sendRequest({ method: 'fileSystem/stat', params: ['testFolder'] }, hostId);
        expect(folderStat).toBeDefined();

        host.sendNotification({ method: 'awareness/openDocument', type: 'text', documentUri: 'ocp://testFolder/test.txt', text: 'HELLO WORLD!'} as messages.OpenDocument);
        guest.sendNotification({ method: 'awareness/openDocument', type: 'text', documentUri: 'ocp://testFolder/test.txt', text: 'HELLO WORLD!'} as messages.OpenDocument);

        guest.sendNotification({ method: 'awareness/updateDocument', documentUri: 'ocp://testFolder/test.txt', changes: [{ startOffset: 5, text: ' NEW' }]} as messages.UpdateDocumentContent);

        await updateArived.promise;

    }, 20000);
});
