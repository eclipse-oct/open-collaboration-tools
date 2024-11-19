// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import * as messages from 'open-collaboration-service-daemon/src/messages';
import { CreateRoomResponse, Emitter } from 'open-collaboration-protocol';

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

    async sendRequest(content: object): Promise<messages.Response> {
        const id = this.lastRequestId++;
        this.process.stdin.write(JSON.stringify({
            kind: 'request',
            content,
            id
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

    sendNotification(content: object) {
        this.process.stdin.write(JSON.stringify({
            kind: 'notification',
            content
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
        // Start the service
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
        const roomInfoResp = await host.sendRequest({method: 'create-room', workspace: {name: 'test', folders: ['testFolder']}} as messages.CreateRoomRequest);
        const roomId = (roomInfoResp.content as messages.SessionCreatedResponse).roomId;
        expect(roomId).toBeDefined();

        const joinResp = await guest.sendRequest({method: 'join-room', room: roomId} as messages.JoinRoomRequest);
        const guestRoomId = (joinResp.content as messages.SessionCreatedResponse).roomId;
        expect(guestRoomId).toEqual(roomId);

        host.onMessage(message => {
            if(message.kind === 'request' && message.content.method === 'fileSystem/stat') {
                host.sendNotification({method: 'fileSystem/stat', parameters: ['test-folder']});
            }
        })
        guest.sendRequest({ method: 'fileSystem/stat',parameters:['test-folder']})


    }, {timeout: 10000});
});