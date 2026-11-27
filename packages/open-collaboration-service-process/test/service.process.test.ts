// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { realpathSync } from 'fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { Authentication, BinaryData, CloseSessionRequest, CreateRoomRequest, fromBinaryMessage, GetDocumentContent, JoinRoomRequest, JoinSessionRequest, OnInitNotification, PeerInfoNotification, PeerLeftNotification, toBinaryMessage, UpdateTextSelection } from 'open-collaboration-service-process';
import { Deferred, FileData } from 'open-collaboration-protocol';
import { createMessageConnection, Message, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { FakeVersionedClient } from './fake-versioned-client.js';

const SERVER_ADDRESS = 'http://localhost:8100';
class Client {
    process: ChildProcessWithoutNullStreams;

    lastRequestId = 0;

    communicationHandler: MessageConnection;

    constructor() {
        this.process = spawn('node',
            // Use the canonical path: on Windows, a drive letter in the wrong case (`c:\` in VS Code
            // terminals) makes Node load a second copy of Yjs through the linked workspace packages.
            [realpathSync.native(`${__dirname}/../lib/process.js`), '--server-address', SERVER_ADDRESS],
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
        // Surface what the process reports, like a second copy of Yjs being loaded
        this.process.stderr.on('data', data => console.error('Service process: ', data.toString()));
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
        const selectionArived = new Deferred();
        let hostId: string = '';

        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => {
            return true;
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

        const folderStat = await guest.communicationHandler.sendRequest('fileSystem/stat', 'testFolder', hostId);
        expect(folderStat).toBeDefined();

        // sending the file path as binary only for testing the conversion
        const fileContent = await guest.communicationHandler.sendRequest('fileSystem/readFile', {type: 'binaryData', data: toBinaryMessage('testFolder/test.txt')} as BinaryData, hostId) as FileData;
        expect(new TextDecoder().decode(fileContent.content)).toEqual('HELLO WORLD!');

        const hostEditor = new FakeVersionedClient(host.communicationHandler, 'testFolder/test.txt', 'HELLO WORLD!');
        const guestEditor = new FakeVersionedClient(guest.communicationHandler, 'testFolder/test.txt', 'HELLO WORLD!');
        hostEditor.sendOpen();
        guestEditor.sendOpen();

        guestEditor.selectAt(0);

        await selectionArived.promise;

        guestEditor.type(5, 5, ' NEW');

        await waitUntil(async () => hostEditor.text === 'HELLO NEW WORLD!', 'the guest\'s change to reach the host\'s editor');

    }, 60000);

    test('guest opening a document the host has not seen yet seeds it from the host\'s real file content', async () => {
        // Regression test for a bug where a guest opening a document the host
        // hadn't opened yet caused CollaborationInstance's `editor.onOpen`
        // handler to seed the shared Yjs document with an empty string instead
        // of the host's actual file content — silently discarding the file's
        // real content for every peer, including the host itself. The guest's
        // own `text` argument to `openDocument` is expected to be ignored (only
        // the host's file content is authoritative), but the host must read its
        // real file instead of seeding blank.
        const path = 'testFolder/only-guest-knows.txt';
        const realDiskContent = 'SEEDED FROM HOST DISK';

        let readFileCalls = 0;
        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => true);
        host.communicationHandler.onRequest('fileSystem/readFile', ((requestedPath: string) => {
            readFileCalls++;
            expect(requestedPath).toEqual(path);
            return {
                type: 'binaryData',
                data: toBinaryMessage({
                    content: Uint8Array.from(new TextEncoder().encode(realDiskContent)),
                } as FileData),
            } as BinaryData;
        }));

        const initDeferred = new Deferred();
        let hostId = '';
        guest.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'guest');
        });
        guest.communicationHandler.onNotification(OnInitNotification, (initData) => {
            hostId = initData.host.id;
            initDeferred.resolve();
        });

        const { roomId } = await host.communicationHandler.sendRequest(CreateRoomRequest, { name: 'test', folders: ['testFolder'] });
        await guest.communicationHandler.sendRequest(JoinRoomRequest, roomId);
        await initDeferred.promise;
        expect(hostId).toBeTruthy();

        // The guest is the *first* one to touch this path — the host's client
        // never sent document/open for it — which is exactly what makes
        // CollaborationInstance's editor.onOpen handler take the "path not
        // seen yet" branch. The guest's own text is nonsense on purpose: it
        // must never end up as the seeded content.
        const guestEditor = new FakeVersionedClient(guest.communicationHandler, path, 'this guest-local text must be ignored');
        guestEditor.sendOpen();

        await waitUntil(async () => guestEditor.text === realDiskContent, 'the host\'s file content to reach the guest\'s editor');
        expect(readFileCalls).toEqual(1);

        // Cross-check via the pull-based getDocumentContent path too, from both sides.
        const guestContent = await guest.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
        expect(new TextDecoder().decode(guestContent.content)).toEqual(realDiskContent);
        const hostContent = await host.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
        expect(new TextDecoder().decode(hostContent.content)).toEqual(realDiskContent);
    }, 60000);

    test('guest opening a document the host has not seen yet does not duplicate the content', async () => {
        // The guest's content is fetched out-of-band from the host's disk (via
        // getDocumentContent, mirroring what the VS Code file system provider does
        // on `readFile`), while openDocument registers an *empty* Y.Text for the
        // path. The host seeding that Y.Text then reaches the guest as an "insert
        // <whole file> at offset 0" delta, which the guest used to apply on top of
        // the content it already had.
        //
        // VS Code only papers this over with the debounced resync in
        // `getOrCreateThrottle`, hence a brief flicker there; native clients
        // driving the service process have no such safety net.
        const path = 'testFolder/first-opened-by-guest.txt';
        const realDiskContent = 'line one\nline two\nline three';

        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => true);
        host.communicationHandler.onRequest('fileSystem/readFile', ((requestedPath: string) => {
            expect(requestedPath).toEqual(path);
            return {
                type: 'binaryData',
                data: toBinaryMessage({
                    content: Uint8Array.from(new TextEncoder().encode(realDiskContent)),
                } as FileData),
            } as BinaryData;
        }));

        const initDeferred = new Deferred();
        guest.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'guest');
        });
        guest.communicationHandler.onNotification(OnInitNotification, () => initDeferred.resolve());

        const { roomId } = await host.communicationHandler.sendRequest(CreateRoomRequest, { name: 'test', folders: ['testFolder'] });
        await guest.communicationHandler.sendRequest(JoinRoomRequest, roomId);
        await initDeferred.promise;

        // 1. The client opens the file: content is pulled from the host, since
        //    nothing has been shared for this path yet.
        const initialContent = await guest.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
        // Stands in for the native client's in-memory document: every edit the
        // service process sends is applied, so its final value is what the user sees.
        const guestEditor = new FakeVersionedClient(guest.communicationHandler, path, new TextDecoder().decode(initialContent.content));
        expect(guestEditor.text).toEqual(realDiskContent);

        // 2. The client reports the now-open document to the service process,
        //    which asks the host to share it.
        guestEditor.sendOpen();

        // 3. Wait for the host's seeding update to reach the guest's shared
        //    document. We poll instead of awaiting a document/applyEdit
        //    because the correct behaviour is to send the client no edit at
        //    all - it already shows what the host seeded.
        await waitUntil(async () => {
            const shared = await guest.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
            return new TextDecoder().decode(shared.content) === realDiskContent;
        }, 'the host to seed the shared document');
        // Give any change notification a chance to arrive before asserting.
        await new Promise(resolve => setTimeout(resolve, 500));

        // Before the fix the guest received `{startOffset: 0, endOffset: 0,
        // text: <whole file>}` and ended up showing the file twice.
        expect(guestEditor.text).not.toEqual(realDiskContent + realDiskContent);
        expect(guestEditor.text).toEqual(realDiskContent);
        expect(guestEditor.edits).toEqual([]);
    }, 60000);

    test('host opening a document a guest already edited does not discard the guest\'s edits', async () => {
        // Seeding is a plain delete-everything + insert-everything, and the host
        // used to do it unconditionally on every openDocument. Opening a file a
        // guest already had open therefore discarded the guest's unsaved edits and
        // invalidated every relative position, making peer selections jump.
        //
        // A non-empty shared document is authoritative instead: the host skips
        // seeding and adopts the shared content into its own editor.
        const path = 'testFolder/edited-by-guest.txt';
        const diskContent = 'aaa\nbbb';
        const editedContent = 'XXXaaa\nbbb';

        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => true);
        // The host's file on disk never changes, and still holds the content
        // from before the guest's edit.
        host.communicationHandler.onRequest('fileSystem/readFile', (() => ({
            type: 'binaryData',
            data: toBinaryMessage({
                content: Uint8Array.from(new TextEncoder().encode(diskContent)),
            } as FileData),
        } as BinaryData)));

        const initDeferred = new Deferred();
        guest.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'guest');
        });
        guest.communicationHandler.onNotification(OnInitNotification, () => initDeferred.resolve());

        const { roomId } = await host.communicationHandler.sendRequest(CreateRoomRequest, { name: 'test', folders: ['testFolder'] });
        await guest.communicationHandler.sendRequest(JoinRoomRequest, roomId);
        await initDeferred.promise;

        // The guest opens the file first, which makes the host share it.
        const initial = await guest.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
        expect(new TextDecoder().decode(initial.content)).toEqual(diskContent);
        const guestEditor = new FakeVersionedClient(guest.communicationHandler, path, diskContent);
        guestEditor.sendOpen();
        // Wait for the seed to come back round to the *guest*. Polling the host
        // would only prove it seeded its own copy.
        await waitUntil(async () => {
            const shared = await guest.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
            return new TextDecoder().decode(shared.content) === diskContent;
        }, 'the host\'s seed to reach the guest');

        // The guest types, but nothing is written to the host's disk. The host's
        // client has nothing open for this path yet, so only the shared document moves.
        guestEditor.type(0, 0, 'XXX');
        await waitUntil(async () => {
            const shared = await host.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
            return new TextDecoder().decode(shared.content) === editedContent;
        }, "the guest's edit to reach the host");

        // Now the host's client opens the same file for the first time. Its
        // editor was loaded from disk, so it starts out with the stale content.
        const hostEditor = new FakeVersionedClient(host.communicationHandler, path, diskContent);
        hostEditor.sendOpen();
        await waitUntil(async () => hostEditor.text === editedContent, 'the host\'s editor to adopt the shared content');

        // The guest's edit must survive on both sides.
        const hostShared = await host.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
        expect(new TextDecoder().decode(hostShared.content)).toEqual(editedContent);
        const guestShared = await guest.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
        expect(new TextDecoder().decode(guestShared.content)).toEqual(editedContent);

        // ...and the host's own editor must have been brought up to date with
        // the shared content rather than overwriting it.
        expect(hostEditor.text).toEqual(editedContent);
        expect(guestEditor.text).toEqual(editedContent);
    }, 60000);

    test('two clients converge, with an edit typed during a remote change where it was typed', async () => {
        // The host's user types while the guest's change is on its way to the host's editor. A
        // client that applied the change anyway would misplace it, as it addresses the buffer
        // without the user's text.
        const path = 'testFolder/versioned.txt';
        const diskContent = 'hello world';

        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => true);
        host.communicationHandler.onRequest('fileSystem/readFile', (() => ({
            type: 'binaryData',
            data: toBinaryMessage({
                content: Uint8Array.from(new TextEncoder().encode(diskContent)),
            } as FileData),
        } as BinaryData)));
        const initDeferred = new Deferred();
        guest.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'guest');
        });
        guest.communicationHandler.onNotification(OnInitNotification, () => initDeferred.resolve());

        const { roomId } = await host.communicationHandler.sendRequest(CreateRoomRequest, { name: 'test', folders: ['testFolder'] });
        await guest.communicationHandler.sendRequest(JoinRoomRequest, roomId);
        await initDeferred.promise;

        const hostEditor = new FakeVersionedClient(host.communicationHandler, path, diskContent);
        hostEditor.sendOpen();

        const guestEditor = new FakeVersionedClient(guest.communicationHandler, path, diskContent);
        guestEditor.sendOpen();
        await waitUntil(async () => {
            const shared = await guest.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
            return new TextDecoder().decode(shared.content) === diskContent;
        }, 'the host\'s document to reach the guest');

        hostEditor.beforeApply = () => hostEditor.type(0, 0, 'say ');
        guestEditor.type(5, 5, ' big');

        const expected = 'say hello big world';
        await waitUntil(async () => hostEditor.text === expected && guestEditor.text === expected,
            `both editors to show "${expected}"`);
        expect(hostEditor.edits.map(edit => edit.baseVersion)).toEqual([0, 1]);
        for (const client of [host, guest]) {
            const shared = await client.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
            expect(new TextDecoder().decode(shared.content)).toEqual(expected);
        }
    }, 60000);

    test('a host file with CRLF line endings is shared with LF line endings', async () => {
        // The shared text holds `\n` line endings only. A host file that a guest opens before the
        // host's client did must be normalized like every other client's seed.
        const path = 'testFolder/crlf.txt';
        const diskContent = 'one\r\ntwo\r\nthree';

        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => true);
        host.communicationHandler.onRequest('fileSystem/readFile', (() => ({
            type: 'binaryData',
            data: toBinaryMessage({
                content: Uint8Array.from(new TextEncoder().encode(diskContent)),
            } as FileData),
        } as BinaryData)));
        const initDeferred = new Deferred();
        guest.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'guest');
        });
        guest.communicationHandler.onNotification(OnInitNotification, () => initDeferred.resolve());

        const { roomId } = await host.communicationHandler.sendRequest(CreateRoomRequest, { name: 'test', folders: ['testFolder'] });
        await guest.communicationHandler.sendRequest(JoinRoomRequest, roomId);
        await initDeferred.promise;

        const guestEditor = new FakeVersionedClient(guest.communicationHandler, path, diskContent);
        guestEditor.sendOpen();
        await waitUntil(async () => {
            const shared = await host.communicationHandler.sendRequest(GetDocumentContent, path) as unknown as FileData;
            return new TextDecoder().decode(shared.content) === 'one\ntwo\nthree';
        }, 'the host to share the normalized file content');
        // The guest's buffer keeps its own line endings
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(guestEditor.text).toEqual(diskContent);
    }, 60000);

    test('a second guest\'s initData.guests includes the first guest', async () => {
        // Regression test: CollaborationInstance.peers (used to build a
        // joiner's initData.guests) was only ever read in room.onJoin and
        // written in onLeave/onInit, never on join itself. So every guest but
        // the first got an empty guests list, never learning earlier peers'
        // ids/keys - causing "No key found for peer" once they broadcast
        // anything (e.g. a selection update).
        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => true);

        let guest1Id = '';
        guest.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'guest1');
        });
        guest.communicationHandler.onNotification(PeerInfoNotification, (peer) => {
            guest1Id = peer.id;
        });
        const guest1Init = new Deferred();
        guest.communicationHandler.onNotification(OnInitNotification, () => guest1Init.resolve());

        const { roomId } = await host.communicationHandler.sendRequest(CreateRoomRequest, { name: 'test', folders: ['testFolder'] });
        await guest.communicationHandler.sendRequest(JoinRoomRequest, roomId);
        await guest1Init.promise;
        expect(guest1Id).toBeTruthy();

        const guest2 = new Client();
        try {
            const guest2Init = new Deferred<{ guests: Array<{ id: string }> }>();
            guest2.communicationHandler.onNotification(Authentication, (token) => {
                makeSimpleLoginRequest(token, 'guest2');
            });
            guest2.communicationHandler.onNotification(OnInitNotification, (initData) => guest2Init.resolve(initData));

            await guest2.communicationHandler.sendRequest(JoinRoomRequest, roomId);
            const initData = await guest2Init.promise;

            expect(initData.guests.map(g => g.id)).toContain(guest1Id);
        } finally {
            guest2.process?.kill();
        }
    }, 60000);

    test('guest leaving via CloseSessionRequest notifies the host immediately', async () => {
        // Regression test for a request/params arity mismatch: CloseSessionRequest
        // used to be declared as RequestType<void, void, void>, which vscode-jsonrpc
        // still treats as numberOfParams = 1 (the generic "void" only affects typing).
        // The Java OCTService.closeSession() binding is a genuine zero-arg
        // @JsonRequest, so the request was rejected with "defines 1 params but
        // received none" before it ever reached leaveRoom() — the host never learned
        // the guest left and only found out ~30-45s later via the heartbeat timeout
        // (see the Eclipse plugin's TODO.md, items 5 and 6). Fixed by switching to
        // RequestType0. This test fails on both counts if the mismatch regresses:
        // the sendRequest below would reject, and/or the host would never see
        // PeerLeftNotification.
        host.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'host');
        });
        host.communicationHandler.onRequest(JoinSessionRequest, () => true);

        let guestId = '';
        const initDeferred = new Deferred();
        guest.communicationHandler.onNotification(Authentication, (token) => {
            makeSimpleLoginRequest(token, 'guest');
        });
        guest.communicationHandler.onNotification(OnInitNotification, () => {
            initDeferred.resolve();
        });
        guest.communicationHandler.onNotification(PeerInfoNotification, (peer) => {
            guestId = peer.id;
        });

        const { roomId } = await host.communicationHandler.sendRequest(CreateRoomRequest, { name: 'test', folders: ['testFolder'] });
        await guest.communicationHandler.sendRequest(JoinRoomRequest, roomId);
        await initDeferred.promise;
        expect(guestId).toBeTruthy();

        const peerLeft = new Deferred<string>();
        host.communicationHandler.onNotification(PeerLeftNotification, (peer) => {
            peerLeft.resolve(peer.id);
        });

        // Before the fix this request rejected with an InvalidParams error
        // instead of resolving.
        await guest.communicationHandler.sendRequest(CloseSessionRequest);

        const leftPeerId = await peerLeft.promise;
        expect(leftPeerId).toEqual(guestId);
    }, 60000);
});

async function waitUntil(condition: () => Promise<boolean>, label = 'condition', timeout = 20000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await condition()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function makeSimpleLoginRequest(token: string, username: string) {
    await fetch(`${SERVER_ADDRESS}/api/login/simple/`, {
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
        body: JSON.stringify({ token, user: username }),
    });
}
