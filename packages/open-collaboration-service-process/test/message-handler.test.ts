// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import type * as types from 'open-collaboration-protocol';
import { CancellationTokenSource, createMessageConnection, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { MessageHandler } from '../src/message-handler.js';
import { CreateRoomRequest, JoinRoomRequest, LoginRequest } from '../src/messages.js';

async function waitUntil(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

function createConnectionPair(): { client: MessageConnection; server: MessageConnection } {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const client = createMessageConnection(new StreamMessageReader(serverToClient), new StreamMessageWriter(clientToServer));
    const server = createMessageConnection(new StreamMessageReader(clientToServer), new StreamMessageWriter(serverToClient));
    client.listen();
    server.listen();
    return { client, server };
}

interface AbortSignalCapture {
    signal?: AbortSignal;
}

/**
 * A connection provider stand-in whose login/joinRoom/createRoom never resolve
 * on their own -- they only settle once the abortSignal they were given fires.
 * This simulates a stuck/slow request and lets the test prove cancellation
 * actually reaches the connection provider instead of just hanging forever.
 */
function createNeverSettlingConnectionProvider(capture: AbortSignalCapture): types.ConnectionProvider {
    const stuckUntilAborted = (options: { abortSignal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
        capture.signal = options.abortSignal;
        options.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    return {
        login: stuckUntilAborted,
        joinRoom: stuckUntilAborted,
        createRoom: stuckUntilAborted,
        connect: () => Promise.reject(new Error('connect must not be reached once the request was cancelled'))
    } as unknown as types.ConnectionProvider;
}

describe('MessageHandler cancellation forwarding', () => {
    test('cancelling a pending createRoom request aborts the connection provider call', async () => {
        const capture: AbortSignalCapture = {};
        const { client, server } = createConnectionPair();
        new MessageHandler(createNeverSettlingConnectionProvider(capture), server);

        const cts = new CancellationTokenSource();
        const pending = client.sendRequest(CreateRoomRequest, { name: 'test', folders: [] }, cts.token);
        await waitUntil(() => capture.signal !== undefined);
        expect(capture.signal?.aborted).toBe(false);

        cts.cancel();

        await expect(pending).rejects.toThrow();
        expect(capture.signal?.aborted).toBe(true);
    });

    test('cancelling a pending joinRoom request aborts the connection provider call', async () => {
        const capture: AbortSignalCapture = {};
        const { client, server } = createConnectionPair();
        new MessageHandler(createNeverSettlingConnectionProvider(capture), server);

        const cts = new CancellationTokenSource();
        const pending = client.sendRequest(JoinRoomRequest, 'some-room-id', cts.token);
        await waitUntil(() => capture.signal !== undefined);
        expect(capture.signal?.aborted).toBe(false);

        cts.cancel();

        await expect(pending).rejects.toThrow();
        expect(capture.signal?.aborted).toBe(true);
    });

    test('cancelling a pending login request aborts the connection provider call', async () => {
        const capture: AbortSignalCapture = {};
        const { client, server } = createConnectionPair();
        new MessageHandler(createNeverSettlingConnectionProvider(capture), server);

        const cts = new CancellationTokenSource();
        const pending = client.sendRequest(LoginRequest, undefined, cts.token);
        await waitUntil(() => capture.signal !== undefined);
        expect(capture.signal?.aborted).toBe(false);

        cts.cancel();

        await expect(pending).rejects.toThrow();
        expect(capture.signal?.aborted).toBe(true);
    });
});
