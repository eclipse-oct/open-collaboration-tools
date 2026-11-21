// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { Deferred } from 'open-collaboration-protocol';
import { createMessageConnection, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { ApplyEditRequest, ClientTextSelection, CloseTextDocument, DidChangeTextDocument, DidChangeTextSelection, GetBufferRequest, OpenTextDocumentParams, OpenTextDocument } from '../src/messages.js';
import { VersionedClientDocument } from '../src/versioned-client-document.js';
import { FakeVersionedClient } from './fake-versioned-client.js';

const PATH = 'folder/file.txt';

interface Setup {
    client: FakeVersionedClient;
    document: VersionedClientDocument;
    ytext: Y.Text;
    selections: ClientTextSelection[][];
    warnings: string[];
    errors: string[];
    closed: () => boolean;
}

const connections: MessageConnection[] = [];

afterEach(() => {
    connections.forEach(connection => connection.dispose());
    connections.length = 0;
});

function setup(text: string, options: { editTimeout?: number, shared?: string } = {}): Setup {
    const clientToService = new PassThrough();
    const serviceToClient = new PassThrough();
    const clientConnection = createMessageConnection(new StreamMessageReader(serviceToClient), new StreamMessageWriter(clientToService));
    const service = createMessageConnection(new StreamMessageReader(clientToService), new StreamMessageWriter(serviceToClient));
    connections.push(clientConnection, service);

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText(PATH);
    ytext.insert(0, options.shared ?? text);
    const client = new FakeVersionedClient(clientConnection, PATH, text);
    const selections: ClientTextSelection[][] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let closed = false;
    // Routes messages to the current document, as CollaborationInstance does
    const open = (params: OpenTextDocumentParams) => new VersionedClientDocument(PATH, params, ytext, {
        applyEdit: request => service.sendRequest(ApplyEditRequest, request),
        getBuffer: request => service.sendRequest(GetBufferRequest, request)
    }, {
        editTimeout: options.editTimeout ?? 200,
        onDidChangeSelection: selection => selections.push(selection),
        onDidClose: () => closed = true,
        logger: {
            warn: message => warnings.push(message),
            error: message => errors.push(message)
        }
    });
    let document: VersionedClientDocument | undefined = open({ path: PATH, text, version: 0, openId: client.openId });
    service.onNotification(OpenTextDocument, params => {
        document?.dispose();
        document = open(params);
    });
    service.onNotification(CloseTextDocument, () => {
        document?.dispose();
        document = undefined;
    });
    service.onNotification(DidChangeTextDocument, params => document?.didChange(params.version, params.changes));
    service.onNotification(DidChangeTextSelection, params => document?.didChangeSelection(params.version, params.selections));
    clientConnection.listen();
    service.listen();
    return {
        client, ytext, selections, warnings, errors, closed: () => closed,
        get document() {
            if (!document) {
                throw new Error('The document is closed');
            }
            return document;
        }
    };
}

async function converged({ client, document, ytext }: Setup, expected: string): Promise<void> {
    await waitUntil(() => client.text === ytext.toString() && document.sync.synced, () =>
        `client: ${JSON.stringify(client.text)}, shared: ${JSON.stringify(ytext.toString())}`);
    await document.sync.flush();
    expect(ytext.toString()).toEqual(expected);
    expect(client.text).toEqual(expected);
}

async function waitUntil(condition: () => boolean, describe: () => string = () => '', timeout = 3000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out. ${describe()}`);
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

describe('VersionedClientDocument', () => {

    test('applies a remote change', async () => {
        const setup_ = setup('hello world');
        setup_.ytext.insert(5, ',');
        await converged(setup_, 'hello, world');
        expect(setup_.client.edits.map(edit => edit.baseVersion)).toEqual([0]);
        expect(setup_.client.version).toEqual(1);
        expect(setup_.errors).toEqual([]);
    });

    test('reports changes of the client to the shared text', async () => {
        const setup_ = setup('hello world');
        setup_.client.type(0, 5, 'goodbye');
        setup_.client.type(13, 13, '!');
        await converged(setup_, 'goodbye world!');
        expect(setup_.client.edits).toEqual([]);
    });

    test('a change the user makes while an edit is on its way lands where it was typed', async () => {
        const setup_ = setup('hello world');
        // The edit addresses the buffer without the user's change, so a client that applied it anyway
        // would put the remote text into the middle of the user's word.
        setup_.client.beforeApply = () => setup_.client.type(0, 0, 'say ');
        setup_.ytext.insert(6, 'big ');
        await converged(setup_, 'say hello big world');
        expect(setup_.client.edits.map(edit => edit.baseVersion)).toEqual([0, 1]);
        expect(setup_.errors).toEqual([]);
    });

    test('an edit of several changes arrives intact', async () => {
        const setup_ = setup('one two three four');
        setup_.ytext.doc!.transact(() => {
            setup_.ytext.delete(14, 4);
            setup_.ytext.insert(14, 'FOUR');
            setup_.ytext.delete(0, 3);
            setup_.ytext.insert(0, 'ONE');
        });
        await converged(setup_, 'ONE two three FOUR');
        expect(setup_.client.edits).toHaveLength(1);
        expect(setup_.client.edits[0].changes.length).toBeGreaterThan(1);
    });

    test('the user making exactly the change of a rejected edit keeps both', async () => {
        const setup_ = setup('abc');
        // The user types what the edit inserts. The edit is rejected, so the change is the user's own.
        setup_.client.beforeApply = () => setup_.client.type(0, 0, 'X');
        setup_.ytext.insert(0, 'X');
        await converged(setup_, 'XXabc');
    });

    test('an applied edit is not taken for a change of the user', async () => {
        const setup_ = setup('abc');
        setup_.ytext.insert(3, 'def');
        await converged(setup_, 'abcdef');
        // Give a wrongly written-back echo the chance to show up as duplicated text
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(setup_.ytext.toString()).toEqual('abcdef');
    });

    test('a slow client that answers after the timeout does not duplicate text', async () => {
        const setup_ = setup('abc', { editTimeout: 50 });
        const gate = setup_.client.gate = new Deferred<void>();
        setup_.ytext.insert(3, '123');
        await waitUntil(() => setup_.warnings.length > 0);
        setup_.client.gate = undefined;
        gate.resolve();
        await converged(setup_, 'abc123');
        expect(setup_.errors).toEqual([]);
        expect(setup_.client.edits).toHaveLength(1);
    });

    test('an edit the client never answers is recovered through getBuffer', async () => {
        const setup_ = setup('abc', { editTimeout: 50 });
        setup_.client.dropNextEdit = true;
        setup_.ytext.insert(3, '123');
        await converged(setup_, 'abc123');
        expect(setup_.client.edits).toHaveLength(2);
        expect(setup_.errors.some(error => error.includes('did not answer'))).toBe(true);
    });

    test('a skipped version replaces the mirror with the client\'s buffer', async () => {
        const setup_ = setup('abc');
        // The notification of version 1 got lost: the client reports version 2
        setup_.client.type(3, 3, 'd', 2);
        // The shared text is authoritative, so the unreported change is reverted
        await converged(setup_, 'abc');
        expect(setup_.errors.some(error => error.includes('Expected version 1'))).toBe(true);
        // ...and the document keeps working
        setup_.client.type(0, 0, 'Z');
        setup_.ytext.insert(4, '!');
        await converged(setup_, 'Zabc!');
    });

    test('changes that do not fit the buffer are recovered from', async () => {
        const setup_ = setup('abc');
        setup_.client.connection.sendNotification(DidChangeTextDocument, { path: PATH, version: 1, changes: [{ startOffset: 10, text: 'x' }] });
        setup_.client.version = 1;
        await waitUntil(() => setup_.errors.some(error => error.includes('do not fit')));
        // The mirror is at the client's version again: its next change is accepted
        setup_.client.type(3, 3, 'd');
        await converged(setup_, 'abcd');
    });

    test('closing the document abandons a pending edit', async () => {
        const setup_ = setup('abc');
        const gate = setup_.client.gate = new Deferred<void>();
        setup_.ytext.insert(0, 'X');
        // Let the edit reach the blocked client
        await new Promise(resolve => setTimeout(resolve, 20));
        setup_.document.dispose();
        setup_.client.gate = undefined;
        gate.resolve();
        await setup_.document.sync.flush();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(setup_.errors).toEqual([]);
    });

    test('an edit of a document the client has closed closes it', async () => {
        const setup_ = setup('abc');
        setup_.client.open = false;
        setup_.ytext.insert(0, 'X');
        await waitUntil(setup_.closed);
    });

    test('an edit meant for an earlier opening is not applied after the document is reopened', async () => {
        const setup_ = setup('abc', { shared: 'Xabc' });
        // The edit of the first opening waits at the client while the client reopens the document
        // with a new counter. Both openings compute the same edit for version 0, so without the
        // openId the client would apply the stale one, and the new opening would take its echo
        // for a change of the user once its own edit is rejected, which duplicates the text.
        const gate = setup_.client.gate = new Deferred<void>();
        const first = setup_.document;
        setup_.client.reopen();
        await waitUntil(() => setup_.document !== first);
        setup_.client.gate = undefined;
        gate.resolve();
        await converged(setup_, 'Xabc');
        expect(setup_.client.edits.map(edit => edit.openId)).toEqual([1, 2]);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(setup_.ytext.toString()).toEqual('Xabc');
        expect(setup_.errors).toEqual([]);
    });

    test('an edit meant for an earlier opening is not applied after a close and reopen', async () => {
        const setup_ = setup('abc', { shared: 'Xabc' });
        const gate = setup_.client.gate = new Deferred<void>();
        const first = setup_.document;
        setup_.client.close();
        setup_.client.reopen();
        await waitUntil(() => { try { return setup_.document !== first; } catch { return false; } });
        setup_.client.gate = undefined;
        gate.resolve();
        await converged(setup_, 'Xabc');
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(setup_.ytext.toString()).toEqual('Xabc');
    });

    test('a selection that overtakes its change is applied once the change has arrived', async () => {
        const setup_ = setup('hello');
        setup_.client.selectAt(7, 1);
        setup_.client.type(0, 0, 'XX');
        await waitUntil(() => setup_.selections.length > 0);
        expect(setup_.selections).toEqual([[{ start: 7, end: 7, isReversed: false }]]);
        expect(setup_.document.sync.text).toEqual('XXhello');
    });

    test('an outdated selection is dropped', async () => {
        const setup_ = setup('hello');
        setup_.client.type(0, 0, 'XX');
        setup_.client.selectAt(1, 0);
        setup_.client.selectAt(3, 1);
        await waitUntil(() => setup_.selections.length > 0);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(setup_.selections).toEqual([[{ start: 3, end: 3, isReversed: false }]]);
    });
});
