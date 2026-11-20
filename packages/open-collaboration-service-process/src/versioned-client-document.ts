// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as types from 'open-collaboration-protocol';
import { Deferred } from 'open-collaboration-protocol';
import { applyTextChanges, LineEnding, YjsTextDocumentSync, YTextChange } from 'open-collaboration-yjs';
import type * as Y from 'yjs';
import type { ApplyEditParams, ApplyEditResult, ClientTextSelection, DocumentBuffer, GetBufferParams, OpenTextDocumentParams, TextDocumentInsert } from './messages.js';

/**
 * The requests a {@link VersionedClientDocument} sends to the client.
 */
export interface VersionedClientConnection {
    applyEdit(params: ApplyEditParams): Promise<ApplyEditResult>;
    getBuffer(params: GetBufferParams): Promise<DocumentBuffer | null>;
}

export interface VersionedClientDocumentLogger {
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}

export const DEFAULT_EDIT_TIMEOUT = 5000;

export interface VersionedClientDocumentOptions {
    /**
     * How long, in milliseconds, to wait for the answer to an edit before the client's buffer is read
     * anew. Defaults to {@link DEFAULT_EDIT_TIMEOUT}, a value of 0 or less waits forever.
     */
    editTimeout?: number;
    /** Called whenever the client's buffer has caught up with the shared text */
    onDidSync?: () => void;
    /** Called with selections of the client that address the buffer as the sync knows it */
    onDidChangeSelection(selections: ClientTextSelection[]): void;
    /** Called when the client reports that it does not have the document open */
    onDidClose(): void;
    /** Defaults to the console. stdout is the channel to the client, which `console.error` and `console.warn` leave alone. */
    logger?: VersionedClientDocumentLogger;
}

interface PendingEdit {
    baseVersion: number;
    settled: boolean;
    timer?: ReturnType<typeof setTimeout>;
    resolve(applied: boolean): void;
    reject(error: Error): void;
}

/**
 * The document of a native client that reports every change of its buffer with a version and
 * applies an edit only if it still addresses that version (see `document/applyEdit`).
 *
 * The service process keeps a mirror of the buffer. The client's protocol makes it behave like an
 * editor to {@link YjsTextDocumentSync}: an outdated edit is rejected, and an applied edit is
 * reported back before it is confirmed. The sync resolves races exactly as it does for VS Code.
 *
 * Should the mirror ever become untrustworthy - a version is skipped, a change does not fit, or an
 * edit is not answered - the client's buffer is read anew with `document/getBuffer`. That only
 * happens through a client bug or a hung client, and is logged as an error.
 */
export class VersionedClientDocument implements types.Disposable {

    readonly sync: YjsTextDocumentSync;

    /** The client's buffer, as far as the client has reported it */
    private text: string;
    private version: number;
    private readonly eol?: LineEnding;
    private readonly openId: number;
    private pending?: PendingEdit;
    /** Set while the mirror is read anew. Changes the client reports in the meantime are dropped. */
    private recovery?: Deferred<void>;
    /** A selection that addresses a version the mirror has not reached yet */
    private heldSelection?: { version: number, selections: ClientTextSelection[] };
    private disposed = false;
    private readonly logger: VersionedClientDocumentLogger;

    constructor(
        readonly path: string,
        params: OpenTextDocumentParams,
        ytext: Y.Text,
        private readonly connection: VersionedClientConnection,
        private readonly options: VersionedClientDocumentOptions
    ) {
        this.text = params.text;
        this.version = params.version;
        this.openId = params.openId;
        this.eol = params.eol === '\n' || params.eol === '\r\n' ? params.eol : undefined;
        this.logger = options.logger ?? console;
        this.sync = new YjsTextDocumentSync(ytext, {
            getText: () => this.text,
            getEol: () => this.eol ?? (this.text.includes('\r\n') ? '\r\n' : '\n'),
            applyChanges: changes => this.applyChanges(changes)
        }, {
            onError: error => this.logger.error(`Failed to sync document ${path}`, error),
            onDidSync: options.onDidSync
        });
    }

    /**
     * Follows a change of the client's buffer, reported with `document/didChange`.
     */
    didChange(version: number, inserts: TextDocumentInsert[]): void {
        if (this.disposed || this.recovery) {
            // While the mirror is read anew, the answer covers every change reported before it
            return;
        }
        if (version !== this.version + 1) {
            this.recover(`Expected version ${this.version + 1} of ${this.path}, but the client reported version ${version}`);
            return;
        }
        const changes = toChanges(inserts, this.text.length);
        if (!changes) {
            this.recover(`The client reported changes of ${this.path} that do not fit its buffer`);
            return;
        }
        this.text = applyTextChanges(this.text, changes);
        this.version = version;
        this.sync.onDidChangeContent(changes);
        this.releaseSelection();
    }

    /**
     * Follows a change of the client's selections, reported with `document/didChangeSelection`.
     */
    didChangeSelection(version: number, selections: ClientTextSelection[]): void {
        if (this.disposed || version < this.version) {
            // Outdated. The next move of the caret reports a fresh one.
            return;
        }
        this.heldSelection = { version, selections };
        this.releaseSelection();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.sync.dispose();
        const pending = this.pending;
        if (pending) {
            // The sync is gone, so the outcome no longer matters. Its late answer is ignored.
            this.settle(pending, false);
        }
        this.recovery?.resolve();
    }

    private async applyChanges(changes: YTextChange[]): Promise<boolean> {
        if (this.recovery) {
            // The edit was computed for a mirror that is being replaced. It is never sent,
            // so any change reported in the meantime is the user's.
            await this.recovery.promise;
            return false;
        }
        if (this.disposed) {
            return false;
        }
        const baseVersion = this.version;
        return new Promise<boolean>((resolve, reject) => {
            const pending: PendingEdit = { baseVersion, settled: false, resolve, reject };
            this.pending = pending;
            const timeout = this.options.editTimeout ?? DEFAULT_EDIT_TIMEOUT;
            if (timeout > 0) {
                pending.timer = setTimeout(() => this.onEditTimeout(pending), timeout);
            }
            this.connection.applyEdit({
                path: this.path,
                openId: this.openId,
                baseVersion,
                changes: changes.map(change => ({ startOffset: change.start, endOffset: change.end, text: change.text }))
            }).then(
                answer => this.onEditAnswer(pending, answer),
                error => {
                    if (!this.recovery) {
                        this.settle(pending, error instanceof Error ? error : new Error(String(error)));
                    }
                }
            );
        });
    }

    private onEditAnswer(pending: PendingEdit, answer: ApplyEditResult | null | undefined): void {
        if (pending.settled || this.recovery || this.disposed) {
            // Abandoned. While the mirror is read anew, the edit is settled once that is done.
            return;
        }
        const result = answer?.result;
        if (result === 'applied') {
            if (this.version === pending.baseVersion) {
                // The sync would take the buffer for one that still lacks the edit and send it again
                this.recover(`The client applied an edit of ${this.path} without reporting the change first`);
            } else {
                this.settle(pending, true);
            }
        } else if (result === 'outdated') {
            if (this.version === pending.baseVersion) {
                // The buffer is at a version the client has not reported a change for
                this.recover(`The client rejected an edit of ${this.path} for version ${pending.baseVersion}, which is the latest version it reported`);
            } else {
                this.settle(pending, false);
            }
        } else if (result === 'notOpen') {
            this.settle(pending, false);
            this.options.onDidClose();
        } else {
            this.settle(pending, new Error(`Unknown result of an edit of ${this.path}: ${JSON.stringify(answer)}`));
        }
    }

    private async onEditTimeout(pending: PendingEdit): Promise<void> {
        if (pending.settled || this.recovery || this.disposed) {
            return;
        }
        this.logger.warn(`The client has not answered an edit of ${this.path} within ${this.options.editTimeout ?? DEFAULT_EDIT_TIMEOUT} ms. Reading its buffer.`);
        const buffer = await this.readBuffer();
        if (buffer === undefined || this.recovery || this.disposed) {
            return;
        }
        if (buffer === null) {
            this.options.onDidClose();
            return;
        }
        // The client handles requests in order: it has answered the edit before this, or never will
        const lost = !pending.settled;
        if (buffer.version !== this.version || buffer.text !== this.text) {
            this.logger.error(`The buffer of ${this.path} differs from the changes the client reported. Replacing it with the shared text.`);
            this.reset(buffer);
        } else if (lost) {
            this.logger.error(`The client did not answer an edit of ${this.path}.`);
            this.settle(pending, new Error(`The client did not answer an edit of ${this.path}`));
        }
    }

    /**
     * Reads the client's buffer anew and replaces the mirror with it. Until then, changes the client
     * reports are dropped, and edits are not sent.
     */
    private async recover(reason: string): Promise<void> {
        if (this.recovery || this.disposed) {
            return;
        }
        this.logger.error(`${reason}. Reading the buffer anew.`);
        const recovery = this.recovery = new Deferred<void>();
        const buffer = await this.readBuffer();
        if (this.disposed) {
            return;
        }
        if (buffer === null) {
            this.options.onDidClose();
            return;
        }
        if (buffer === undefined) {
            // Nothing to recover against. The document stays stalled.
            return;
        }
        this.recovery = undefined;
        this.reset(buffer);
        recovery.resolve();
    }

    /**
     * Replaces the mirror. The shared text is authoritative, so whatever differs is replaced in the
     * client's buffer by minimal edits.
     */
    private reset(buffer: DocumentBuffer): void {
        this.text = buffer.text;
        this.version = buffer.version;
        const pending = this.pending;
        if (pending) {
            // Not `false`: the sync would take a reported echo of the edit for a change of the user.
            // A failed edit is neither, and the next edit is computed from the buffer as it is now.
            this.settle(pending, new Error(`An edit of ${this.path} was abandoned, as the client's buffer was read anew`));
        }
        this.sync.refresh();
        this.releaseSelection();
    }

    private async readBuffer(): Promise<DocumentBuffer | null | undefined> {
        const timeout = this.options.editTimeout ?? DEFAULT_EDIT_TIMEOUT;
        const timer = timeout > 0 ? setTimeout(() => {
            this.logger.error(`The client does not answer for ${this.path}. The document is stalled until it does.`);
        }, timeout) : undefined;
        try {
            const buffer = await this.connection.getBuffer({ path: this.path, openId: this.openId });
            if (buffer !== null && (typeof buffer?.text !== 'string' || !Number.isInteger(buffer.version))) {
                throw new Error(`Invalid answer: ${JSON.stringify(buffer)}`);
            }
            return buffer;
        } catch (error) {
            this.logger.error(`Failed to read the buffer of ${this.path} from the client. The document is stalled.`, error);
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    }

    private settle(pending: PendingEdit, outcome: boolean | Error): void {
        if (pending.settled) {
            return;
        }
        pending.settled = true;
        clearTimeout(pending.timer);
        if (this.pending === pending) {
            this.pending = undefined;
        }
        if (outcome instanceof Error) {
            pending.reject(outcome);
        } else {
            pending.resolve(outcome);
        }
    }

    /**
     * Applies the held selection once the mirror has reached its version.
     */
    private releaseSelection(): void {
        const held = this.heldSelection;
        if (!held || this.recovery || this.disposed) {
            return;
        }
        if (held.version < this.version) {
            this.heldSelection = undefined;
        } else if (held.version === this.version) {
            this.heldSelection = undefined;
            this.options.onDidChangeSelection(held.selections);
        }
    }
}

/**
 * Converts the changes of the client, or returns `undefined` if they do not fit a buffer of the
 * given length. They may come in any order, but must not overlap.
 */
function toChanges(inserts: TextDocumentInsert[], length: number): YTextChange[] | undefined {
    if (!Array.isArray(inserts)) {
        return undefined;
    }
    const changes = inserts.map(insert => ({
        start: insert?.startOffset,
        end: insert?.endOffset ?? insert?.startOffset,
        text: insert?.text
    })).sort((a, b) => a.start - b.start);
    let last = 0;
    for (const { start, end, text } of changes) {
        if (!Number.isInteger(start) || !Number.isInteger(end) || typeof text !== 'string' || start < last || end < start || end > length) {
            return undefined;
        }
        last = end;
    }
    return changes;
}
