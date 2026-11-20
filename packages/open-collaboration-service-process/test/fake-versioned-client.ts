// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Deferred } from 'open-collaboration-protocol';
import { applyTextChanges } from 'open-collaboration-yjs';
import type { MessageConnection } from 'vscode-jsonrpc';
import {
    ApplyEditParams, ApplyEditRequest, ApplyEditResult, DidChangeTextDocument, DidChangeTextSelection, DocumentBuffer,
    GetBufferRequest, OpenTextDocument, TextDocumentInsert
} from '../src/messages.js';

/**
 * A native client that follows the rules of `document/applyEdit`: it handles requests in the order
 * it received them, applies an edit only to the version it addresses, back to front, and reports
 * it as one `document/didChange` before it answers.
 */
export class FakeVersionedClient {

    version = 0;
    readonly edits: ApplyEditParams[] = [];
    /** Runs once, after the next edit has arrived and before the client looks at it */
    beforeApply?: () => void;
    /** The next edit is never answered */
    dropNextEdit = false;
    /** While set, the client handles no request, like an IntelliJ EDT blocked by a modal dialog */
    gate?: Deferred<void>;
    open = true;
    /** Requests are handled one after the other, in the order they arrived */
    private queue: Promise<unknown> = Promise.resolve();

    constructor(readonly connection: MessageConnection, readonly path: string, public text: string) {
        connection.onRequest(ApplyEditRequest, params => this.enqueue(() => this.applyEdit(params)));
        connection.onRequest(GetBufferRequest, params => this.enqueue<DocumentBuffer | null>(() =>
            this.open && params.path === path ? { text: this.text, version: this.version } : null));
    }

    /** Opens the document with the service process */
    sendOpen(): void {
        this.connection.sendNotification(OpenTextDocument, { path: this.path, text: this.text, version: this.version });
    }

    /** The user changes the buffer */
    type(start: number, end: number, text: string, versionStep = 1): void {
        this.change([{ startOffset: start, endOffset: end, text }], versionStep);
    }

    selectAt(offset: number, version = this.version): void {
        this.connection.sendNotification(DidChangeTextSelection, { path: this.path, version, selections: [{ start: offset, end: offset, isReversed: false }] });
    }

    private applyEdit(params: ApplyEditParams): ApplyEditResult | Promise<never> {
        this.edits.push(params);
        if (this.dropNextEdit) {
            this.dropNextEdit = false;
            return new Promise<never>(() => {});
        }
        const beforeApply = this.beforeApply;
        this.beforeApply = undefined;
        beforeApply?.();
        if (!this.open || params.path !== this.path) {
            return { result: 'notOpen' };
        }
        if (params.baseVersion !== this.version) {
            return { result: 'outdated' };
        }
        this.change(params.changes);
        return { result: 'applied' };
    }

    private change(changes: TextDocumentInsert[], versionStep = 1): void {
        this.text = applyTextChanges(this.text, changes.map(change => ({
            start: change.startOffset,
            end: change.endOffset ?? change.startOffset,
            text: change.text
        })));
        this.version += versionStep;
        this.connection.sendNotification(DidChangeTextDocument, { path: this.path, version: this.version, changes });
    }

    private enqueue<T>(handle: () => T | Promise<T>): Promise<T> {
        const result = this.queue.then(async () => {
            await this.gate?.promise;
            return handle();
        });
        // A dropped request must not hold up the ones behind it
        this.queue = Promise.race([result, new Promise(resolve => setTimeout(resolve, 0))]).catch(() => undefined);
        return result;
    }
}
