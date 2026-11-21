// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { afterEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { applyTextChanges } from '../src/text-diff.js';
import type { YTextChange } from '../src/text-change.js';
import { LineEnding, TextDocumentAdapter, YjsTextDocumentSync, YjsTextDocumentSyncOptions } from '../src/yjs-text-sync.js';

/**
 * Behaves like a VS Code document: an edit takes time to reach the buffer, is rejected if the
 * buffer changed in the meantime, and every change of the buffer is reported right away.
 */
class FakeEditor implements TextDocumentAdapter {

    sync?: YjsTextDocumentSync;
    version = 0;
    /** The edits that were applied to the buffer */
    readonly edits: YTextChange[][] = [];
    rejected = 0;
    maxConcurrentEdits = 0;
    /** Runs once, while the next edit is on its way to the buffer */
    whileRequested?: () => void;
    /** Runs once, after the next edit was applied and before its result is back */
    whileResponding?: () => void;
    /** Resolves when an edit or its result has arrived */
    travel: () => Promise<void> = () => Promise.resolve();
    private concurrentEdits = 0;

    constructor(public text: string, public eol: LineEnding = '\n') {
    }

    getText(): string {
        return this.text;
    }

    getEol(): LineEnding {
        return this.eol;
    }

    async applyChanges(changes: YTextChange[]): Promise<boolean> {
        this.maxConcurrentEdits = Math.max(this.maxConcurrentEdits, ++this.concurrentEdits);
        try {
            const version = this.version;
            await this.travel();
            this.runOnce('whileRequested');
            if (version !== this.version) {
                this.rejected++;
                return false;
            }
            this.edits.push(changes);
            this.change(changes);
            await this.travel();
            this.runOnce('whileResponding');
            return true;
        } finally {
            this.concurrentEdits--;
        }
    }

    /** An edit made by the user */
    type(start: number, end: number, text: string): void {
        this.change([{ start, end, text }]);
    }

    change(changes: YTextChange[]): void {
        this.text = applyTextChanges(this.text, changes);
        this.version++;
        this.sync?.onDidChangeContent(changes);
    }

    private runOnce(hook: 'whileRequested' | 'whileResponding'): void {
        const callback = this[hook];
        this[hook] = undefined;
        callback?.();
    }
}

const PATH = 'file.txt';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function settle(...syncs: YjsTextDocumentSync[]): Promise<void> {
    for (let i = 0; i < 100; i++) {
        await Promise.all(syncs.map(sync => sync.flush()));
        await tick();
        if (syncs.every(sync => sync.synced)) {
            return;
        }
    }
    throw new Error('The documents did not settle');
}

describe('YjsTextDocumentSync', () => {

    const syncs: YjsTextDocumentSync[] = [];
    const errors: unknown[] = [];

    afterEach(() => {
        syncs.splice(0).forEach(sync => sync.dispose());
        errors.length = 0;
    });

    function attach(doc: Y.Doc, editor: FakeEditor, options?: YjsTextDocumentSyncOptions): YjsTextDocumentSync {
        const sync = new YjsTextDocumentSync(doc.getText(PATH), editor, {
            onError: error => errors.push(error),
            ...options
        });
        editor.sync = sync;
        syncs.push(sync);
        return sync;
    }

    /**
     * A local document that shares `content`, and the document of a remote peer.
     * Updates travel between them instantly.
     */
    function createSession(content: string, eol?: LineEnding, options?: YjsTextDocumentSyncOptions) {
        const local = new Y.Doc();
        const remote = new Y.Doc();
        remote.getText(PATH).insert(0, content);
        Y.applyUpdate(local, Y.encodeStateAsUpdate(remote));
        local.on('update', (update, origin) => origin !== remote && Y.applyUpdate(remote, update, local));
        remote.on('update', (update, origin) => origin !== local && Y.applyUpdate(local, update, remote));
        const editor = new FakeEditor(eol === '\r\n' ? content.replace(/\n/g, '\r\n') : content, eol);
        const sync = attach(local, editor, options);
        return { local, remote, remoteText: remote.getText(PATH), editor, sync };
    }

    test('applies a remote change to the buffer as a minimal edit', async () => {
        const { remoteText, editor, sync } = createSession('hello world');
        remoteText.insert(6, 'big ');
        expect(sync.synced).toBe(false);
        await settle(sync);
        expect(editor.text).toBe('hello big world');
        expect(editor.edits).toEqual([[{ start: 6, end: 6, text: 'big ' }]]);
    });

    test('writes a local change to the shared text', () => {
        const { remoteText, editor, sync } = createSession('hello world');
        editor.type(0, 5, 'goodbye');
        expect(remoteText.toString()).toBe('goodbye world');
        expect(sync.synced).toBe(true);
    });

    test('writes simultaneous local changes that all address the previous content', () => {
        const { remoteText, editor } = createSession('one two three');
        // Reported back to front, like VS Code does
        editor.change([{ start: 8, end: 13, text: '3' }, { start: 4, end: 7, text: '2' }, { start: 0, end: 3, text: '1' }]);
        expect(remoteText.toString()).toBe('1 2 3');
    });

    test('does not send a remote change back', async () => {
        const { local, remote, remoteText, editor, sync } = createSession('hello world');
        let localUpdates = 0;
        local.on('update', (_, origin) => {
            if (origin !== remote) {
                localUpdates++;
            }
        });
        remoteText.insert(0, 'oh, ');
        remoteText.delete(9, 6);
        await settle(sync);
        expect(editor.text).toBe('oh, hello');
        expect(remoteText.toString()).toBe('oh, hello');
        expect(localUpdates).toBe(0);
    });

    test('applies one edit at a time and combines the changes that arrive meanwhile', async () => {
        const { remoteText, editor, sync } = createSession('0123456789');
        remoteText.insert(0, 'a');
        await Promise.resolve();
        await Promise.resolve();
        // The first edit is on its way
        remoteText.insert(11, 'b');
        remoteText.insert(6, 'c');
        await settle(sync);
        expect(editor.text).toBe('a01234c56789b');
        expect(editor.maxConcurrentEdits).toBe(1);
        expect(editor.edits).toHaveLength(2);
        expect(editor.edits[1]).toEqual([{ start: 6, end: 6, text: 'c' }, { start: 11, end: 11, text: 'b' }]);
    });

    test('recomputes an edit that the buffer rejected because the user typed', async () => {
        const { remoteText, editor, sync } = createSession('hello world');
        remoteText.insert(0, '>> ');
        // The user types at the end while the edit for the remote change is on its way.
        // The offset addresses a buffer that does not contain the remote change yet.
        editor.whileRequested = () => editor.type(11, 11, '!');
        await settle(sync);
        expect(editor.rejected).toBe(1);
        expect(remoteText.toString()).toBe('>> hello world!');
        expect(editor.text).toBe('>> hello world!');
        expect(errors).toEqual([]);
    });

    test('accepts a local change made right after an edit was applied', async () => {
        const { remoteText, editor, sync } = createSession('hello world');
        remoteText.insert(0, '>> ');
        // The buffer contains the remote change, but the result of the edit is not back yet
        editor.whileResponding = () => editor.type(14, 14, '!');
        await settle(sync);
        expect(editor.rejected).toBe(0);
        expect(remoteText.toString()).toBe('>> hello world!');
        expect(editor.text).toBe('>> hello world!');
    });

    test('does not take the same change made by the user for an edit of its own', async () => {
        const { remoteText, editor, sync } = createSession('hello world');
        remoteText.insert(5, '!');
        // The user types what the remote peer typed, at the same place, before the edit arrives
        editor.whileRequested = () => {
            editor.type(5, 5, '!');
            editor.type(12, 12, '?');
        };
        await settle(sync);
        expect(editor.rejected).toBe(1);
        expect(remoteText.toString()).toBe('hello!! world?');
        expect(editor.text).toBe('hello!! world?');
        expect(errors).toEqual([]);
    });

    test('converts offsets while the buffer is behind and tells when it has caught up', async () => {
        let caughtUp = 0;
        const { remoteText, editor, sync } = createSession('hello world', '\n', { onDidSync: () => caughtUp++ });
        remoteText.insert(0, '>> ');
        expect(sync.synced).toBe(false);
        // "world" starts at offset 6 of the buffer and at offset 9 of the shared text
        expect(sync.normalizedOffset(6)).toBe(9);
        expect(sync.editorOffset(9)).toBe(6);
        // The buffer has no place for an offset within the text it has yet to receive
        expect(sync.editorOffset(2)).toBe(0);
        expect(caughtUp).toBe(0);
        await settle(sync);
        expect(caughtUp).toBe(1);
        expect(editor.text).toBe('>> hello world');
        expect(sync.normalizedOffset(9)).toBe(9);
        expect(sync.editorOffset(9)).toBe(9);
    });

    test('rebases a local change onto several pending remote changes', async () => {
        const { remoteText, editor, sync } = createSession('one two three');
        remoteText.insert(13, '!');
        remoteText.delete(0, 4);
        remoteText.insert(0, '1 ');
        editor.whileRequested = () => editor.type(4, 7, '2');
        await settle(sync);
        expect(remoteText.toString()).toBe('1 2 three!');
        expect(editor.text).toBe('1 2 three!');
    });

    test('keeps remotely inserted text when the user deletes the text around it', async () => {
        const { remoteText, editor, sync } = createSession('one two three');
        remoteText.insert(5, 'XYZ');
        editor.whileRequested = () => editor.type(4, 8, '');
        await settle(sync);
        expect(remoteText.toString()).toBe('one XYZthree');
        expect(editor.text).toBe('one XYZthree');
    });

    test('does not delete text twice that was deleted on both sides', async () => {
        const { remoteText, editor, sync } = createSession('one two three');
        remoteText.delete(2, 4);
        editor.whileRequested = () => editor.type(4, 10, '');
        await settle(sync);
        expect(remoteText.toString()).toBe('onree');
        expect(editor.text).toBe('onree');
    });

    test('translates between the line endings of the buffer and the shared text', async () => {
        const { remoteText, editor, sync } = createSession('one\ntwo\nthree', '\r\n');
        expect(sync.synced).toBe(true);
        expect(sync.normalizedOffset(10)).toBe(8);
        expect(sync.editorOffset(8)).toBe(10);

        // "two" starts at offset 5 of the buffer
        editor.type(5, 8, '2\r\n2');
        expect(remoteText.toString()).toBe('one\n2\n2\nthree');

        remoteText.insert(13, '\nfour');
        remoteText.delete(0, 3);
        await settle(sync);
        expect(editor.text).toBe('\r\n2\r\n2\r\nthree\r\nfour');
        expect(remoteText.toString()).toBe('\n2\n2\nthree\nfour');
    });

    test('supports a buffer that mixes line endings', async () => {
        const local = new Y.Doc();
        const text = local.getText(PATH);
        text.insert(0, 'one\ntwo\nthree\nfour');
        const editor = new FakeEditor('one\r\ntwo\nthree\r\nfour');
        const sync = attach(local, editor);
        expect(sync.synced).toBe(true);
        expect(sync.editorOffset(8)).toBe(9);
        expect(sync.editorOffset(14)).toBe(16);
        expect(sync.normalizedOffset(16)).toBe(14);

        // "three" starts at offset 9 of the buffer
        editor.type(9, 14, '3');
        expect(text.toString()).toBe('one\ntwo\n3\nfour');

        local.transact(() => text.insert(10, '4 or '), 'remote');
        await settle(sync);
        expect(editor.text).toBe('one\r\ntwo\n3\r\n4 or four');
    });

    test('follows a change that takes a line ending apart', () => {
        const { remoteText, editor, sync } = createSession('one\ntwo', '\r\n');
        // Removes the "\r" of the line ending, which leaves the "\n" in place
        editor.type(3, 4, '');
        expect(editor.text).toBe('one\ntwo');
        expect(remoteText.toString()).toBe('one\ntwo');
        editor.type(4, 4, '2 ');
        expect(remoteText.toString()).toBe('one\n2 two');
        expect(sync.synced).toBe(true);
    });

    test('supports a shared text that contains carriage returns', async () => {
        const { local, remote, remoteText, editor, sync } = createSession('one\ntwo\nthree');
        let localUpdates = 0;
        local.on('update', (_, origin) => {
            if (origin !== remote) {
                localUpdates++;
            }
        });
        // A peer that writes the text of its editor as it is
        remoteText.insert(3, '\r\n1.5');
        await settle(sync);
        expect(editor.text).toBe('one\n1.5\ntwo\nthree');
        // The line ending is inserted the way the buffer wants it
        expect(editor.edits).toEqual([[{ start: 4, end: 4, text: '1.5\n' }]]);
        expect(localUpdates).toBe(0);
        expect(errors).toEqual([]);

        // "two" starts at offset 8 of the buffer and at offset 9 of the shared text
        expect(sync.normalizedOffset(8)).toBe(9);
        expect(sync.editorOffset(9)).toBe(8);
        editor.type(8, 11, '2');
        expect(remoteText.toString()).toBe('one\r\n1.5\n2\nthree');

        // Removes the line ending as a whole
        editor.type(3, 4, ' ');
        expect(remoteText.toString()).toBe('one 1.5\n2\nthree');
        expect(sync.synced).toBe(true);
    });

    describe('when the line ending of the buffer is switched', () => {

        function createSwitchedSession() {
            const session = createSession('one\ntwo\nthree', '\r\n');
            let localUpdates = 0;
            session.local.on('update', (_, origin) => {
                if (origin !== session.remote) {
                    localUpdates++;
                }
            });
            session.editor.eol = '\n';
            return { ...session, localUpdates: () => localUpdates };
        }

        async function expectToBeInSync({ remoteText, editor, sync }: ReturnType<typeof createSwitchedSession>) {
            // "two" starts at offset 4 now, it started at offset 5 before
            editor.type(4, 7, '2');
            expect(remoteText.toString()).toBe('one\n2\nthree');
            remoteText.insert(11, '\nfour');
            await settle(sync);
            expect(editor.text).toBe('one\n2\nthree\nfour');
        }

        test('follows a switch that is not reported as a change once it is refreshed', async () => {
            const session = createSwitchedSession();
            session.editor.text = 'one\ntwo\nthree';
            session.sync.refresh();
            expect(session.localUpdates()).toBe(0);
            expect(session.sync.synced).toBe(true);
            await expectToBeInSync(session);
        });

        test('follows a switch that is reported as a replacement of the whole content', async () => {
            const session = createSwitchedSession();
            session.editor.type(0, 15, 'one\ntwo\nthree');
            // Nothing changed as far as the shared text is concerned
            expect(session.localUpdates()).toBe(0);
            await expectToBeInSync(session);
        });

        test('replaces a change of the content that came with an unreported switch', async () => {
            const session = createSwitchedSession();
            session.editor.text = 'one\nthree';
            session.sync.refresh();
            await settle(session.sync);
            expect(session.editor.text).toBe('one\ntwo\nthree');
            expect(session.remoteText.toString()).toBe('one\ntwo\nthree');
        });
    });

    test('lets a non-empty shared text replace the content of the buffer', async () => {
        const local = new Y.Doc();
        local.getText(PATH).insert(0, 'shared content');
        const editor = new FakeEditor('stale content');
        const sync = attach(local, editor);
        await settle(sync);
        expect(editor.text).toBe('shared content');
        expect(local.getText(PATH).toString()).toBe('shared content');
    });

    test('seeds an empty shared text with the content of the buffer', () => {
        const local = new Y.Doc();
        const editor = new FakeEditor('line 1\r\nline 2', '\r\n');
        const sync = attach(local, editor);
        expect(sync.synced).toBe(false);
        sync.seed();
        expect(sync.synced).toBe(true);
        expect(local.getText(PATH).toString()).toBe('line 1\nline 2');
    });

    describe('for a document that has not been shared yet', () => {

        function createGuest(content: string) {
            const local = new Y.Doc();
            const host = new Y.Doc();
            const editor = new FakeEditor(content);
            const sync = attach(local, editor);
            const seed = (hostContent: string) => {
                host.getText(PATH).insert(0, hostContent);
                Y.applyUpdate(local, Y.encodeStateAsUpdate(host), host);
            };
            return { text: local.getText(PATH), editor, sync, seed };
        }

        test('leaves the buffer alone when the host shares the same content', async () => {
            const { text, editor, sync, seed } = createGuest('content of the file');
            seed('content of the file');
            await settle(sync);
            expect(editor.text).toBe('content of the file');
            expect(text.toString()).toBe('content of the file');
            expect(editor.edits).toEqual([]);
        });

        test('adopts the content the host shares if it differs', async () => {
            const { text, editor, sync, seed } = createGuest('content of the file');
            seed('unsaved content of the file');
            await settle(sync);
            expect(editor.text).toBe('unsaved content of the file');
            expect(text.toString()).toBe('unsaved content of the file');
        });

        test('holds back local changes until the host shares the content they were made to', async () => {
            const { text, editor, sync, seed } = createGuest('content');
            editor.type(0, 0, 'my ');
            editor.type(10, 10, '!');
            expect(text.toString()).toBe('');
            seed('content');
            expect(text.toString()).toBe('my content!');
            await settle(sync);
            expect(editor.text).toBe('my content!');
            expect(editor.edits).toEqual([]);
        });

        test('rebases local changes if the host shares different content', async () => {
            const { text, editor, sync, seed } = createGuest('some content');
            editor.type(12, 12, '!');
            editor.type(0, 4, 'my');
            expect(text.toString()).toBe('');
            seed('some unsaved content');
            await settle(sync);
            expect(editor.text).toBe('my unsaved content!');
            expect(text.toString()).toBe('my unsaved content!');
        });

        test('keeps local changes if the host shares content that has nothing in common', async () => {
            const { text, editor, sync, seed } = createGuest('content');
            editor.type(7, 7, ' of mine');
            seed('something else entirely');
            await settle(sync);
            expect(text.toString()).toContain(' of mine');
            expect(text.toString()).toContain('something else entirely');
            expect(editor.text).toBe(text.toString());
        });

        test('reports local changes that are held back for too long', async () => {
            const editor = new FakeEditor('content');
            const sync = attach(new Y.Doc(), editor, { unsharedTimeout: 10 });
            await new Promise(resolve => setTimeout(resolve, 30));
            // Nothing is held back as long as the buffer does not change
            expect(errors).toEqual([]);
            editor.type(0, 0, 'my ');
            await new Promise(resolve => setTimeout(resolve, 30));
            expect(errors).toHaveLength(1);
            expect(sync.synced).toBe(false);
        });
    });

    test('gives up on an edit the buffer keeps rejecting and tries again with the next change', async () => {
        const { remoteText, editor, sync } = createSession('hello');
        const applyChanges = editor.applyChanges.bind(editor);
        editor.applyChanges = async () => false;
        remoteText.insert(5, ' world');
        await sync.flush();
        expect(errors).toHaveLength(1);
        expect(sync.synced).toBe(false);
        expect(editor.text).toBe('hello');

        editor.applyChanges = applyChanges;
        remoteText.insert(11, '!');
        await settle(sync);
        expect(editor.text).toBe('hello world!');
    });

    test('works with a buffer that takes every edit as applied the moment it is sent', async () => {
        // Like the service process, which cannot ask its client whether an edit was applied
        const { remoteText, editor, sync } = createSession('hello world');
        const sent: YTextChange[][] = [];
        editor.applyChanges = async changes => {
            sent.push(changes);
            editor.change(changes);
            return true;
        };
        remoteText.insert(0, '>> ');
        remoteText.insert(14, '!');
        await settle(sync);
        editor.type(3, 8, 'goodbye');
        expect(sent).toEqual([[{ start: 0, end: 0, text: '>> ' }, { start: 11, end: 11, text: '!' }]]);
        expect(editor.text).toBe('>> goodbye world!');
        expect(remoteText.toString()).toBe('>> goodbye world!');
        expect(errors).toEqual([]);
    });

    test('stops when it is disposed', async () => {
        const { remoteText, editor, sync } = createSession('hello');
        sync.dispose();
        remoteText.insert(5, ' world');
        editor.type(0, 0, '>');
        await sync.flush();
        expect(editor.text).toBe('>hello');
        expect(remoteText.toString()).toBe('hello world');
    });

    test('converges when both peers edit while updates and edits are delayed', async () => {
        for (let seed = 1; seed <= 25; seed++) {
            const next = random(seed);
            const tasks: Array<() => void> = [];
            const travel = () => new Promise<void>(resolve => tasks.push(resolve));
            const runTask = () => tasks.splice(Math.floor(next() * tasks.length), 1)[0]();

            const docs = [new Y.Doc(), new Y.Doc()];
            docs[0].getText(PATH).insert(0, 'first line\nsecond line\nthird line\n');
            Y.applyUpdate(docs[1], Y.encodeStateAsUpdate(docs[0]));
            docs.forEach((doc, i) => doc.on('update', (update, origin) => {
                if (origin !== 'relay') {
                    tasks.push(() => Y.applyUpdate(docs[1 - i], update, 'relay'));
                }
            }));
            const editors = [
                new FakeEditor(docs[0].getText(PATH).toString()),
                new FakeEditor(docs[1].getText(PATH).toString().replace(/\n/g, '\r\n'), '\r\n')
            ];
            const peers = editors.map((editor, i) => {
                editor.travel = travel;
                return attach(docs[i], editor);
            });

            for (let step = 0; step < 150; step++) {
                if (next() < 0.4) {
                    randomEdit(editors[Math.floor(next() * 2)], next);
                } else if (tasks.length > 0) {
                    runTask();
                }
                await tick();
            }
            for (let round = 0; tasks.length > 0 || !peers.every(peer => peer.synced); round++) {
                expect(round, `seed ${seed} does not settle`).toBeLessThan(1000);
                if (tasks.length > 0) {
                    runTask();
                }
                await tick();
            }

            const expected = docs[0].getText(PATH).toString();
            expect(docs[1].getText(PATH).toString(), `seed ${seed}`).toBe(expected);
            expect(editors[0].text, `seed ${seed}`).toBe(expected);
            expect(editors[1].text, `seed ${seed}`).toBe(expected.replace(/\n/g, '\r\n'));
            expect(errors, `seed ${seed}`).toEqual([]);
            expect(Math.max(...editors.map(editor => editor.maxConcurrentEdits))).toBeLessThanOrEqual(1);
            syncs.splice(0).forEach(sync => sync.dispose());
        }
    });
});

function random(seed: number): () => number {
    // Park-Miller generator
    return () => {
        seed = (seed * 48271) % 2147483647;
        return seed / 2147483647;
    };
}

/**
 * Replaces up to two ranges of the buffer, the way a user with multiple cursors would.
 */
function randomEdit(editor: FakeEditor, next: () => number): void {
    // A user cannot place the cursor within a line ending, so pick the offsets between characters
    const text = editor.text.replace(/\r\n/g, '\n');
    const toEditor = (offset: number) => editor.eol === '\n'
        ? offset
        : offset + text.substring(0, offset).split('\n').length - 1;
    const fragments = ['a', 'b', 'xyz', editor.eol, ' ', ''];
    const changes: YTextChange[] = [];
    let last = 0;
    for (let i = 0; i < 2 && last <= text.length && (i === 0 || next() < 0.3); i++) {
        const start = last + Math.floor(next() * (text.length - last + 1));
        const end = next() < 0.4 ? Math.min(text.length, start + Math.floor(next() * 6)) : start;
        changes.push({ start: toEditor(start), end: toEditor(end), text: fragments[Math.floor(next() * fragments.length)] });
        last = end + 1;
    }
    if (changes.some(change => change.start !== change.end || change.text.length > 0)) {
        editor.change(changes);
    }
}
