// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as Y from 'yjs';
import type * as types from 'open-collaboration-protocol';
import type { YTextChange } from './text-change.js';
import { applyTextChanges, diffText } from './text-diff.js';

export type LineEnding = '\n' | '\r\n';

/**
 * The editor buffer a {@link YjsTextDocumentSync} keeps in sync with a shared `Y.Text`.
 *
 * The buffer can only be edited asynchronously, and it can change while such an edit is on its way.
 */
export interface TextDocumentAdapter {
    /**
     * The current content of the buffer.
     */
    getText(): string;
    /**
     * The line ending to use for text that is inserted into the buffer.
     */
    getEol(): LineEnding;
    /**
     * Applies the changes to the buffer. All changes address the buffer as returned by {@link getText}
     * at the time of the call. They are sorted and do not overlap.
     *
     * Must resolve to `false` and leave the buffer untouched if the buffer changed before the
     * changes could be applied. A change of the buffer - this one included - must have been reported
     * to {@link YjsTextDocumentSync.onDidChangeContent} by the time the returned promise resolves.
     */
    applyChanges(changes: YTextChange[]): Promise<boolean>;
}

export interface YjsTextDocumentSyncOptions {
    /**
     * How often in a row an edit may fail for no apparent reason before the sync gives up on it.
     * The sync tries again with the next change on either side. Defaults to 5.
     */
    maxStalledAttempts?: number;
    /**
     * How long, in milliseconds, a change of a document that has not been shared yet is held back
     * before it is reported as an error. The change is still written once the document gets shared.
     * Defaults to 5000, a value of 0 or less never reports it.
     */
    unsharedTimeout?: number;
    /**
     * Called when the adapter throws, the sync gives up on an edit, or changes are held back for too long.
     */
    onError?: (error: unknown) => void;
    /**
     * Called whenever the buffer has caught up with the shared text. Until then, offsets are
     * converted between the two as well as the pending changes allow.
     */
    onDidSync?: () => void;
}

/** A change of the buffer in terms of the shadow, which is not written to the shared text yet */
interface HeldChange {
    /** The shadow the changes address */
    before: string;
    changes: YTextChange[];
}

interface InFlightEdit {
    /** The buffer content the edit was computed for */
    before: string;
    /** The buffer content once the edit has been applied */
    after: string;
    /**
     * The change the buffer reported that looks exactly like the edit. It is either the edit,
     * or the very same change made by the user. Only the outcome of the edit tells them apart.
     */
    echo?: YTextChange[];
    /** The changes the buffer reported after the echo. They follow it once it is told apart. */
    held: HeldChange[];
}

/** The content of the shared text. Read once per change, as reading it is not cheap. */
interface SharedSnapshot {
    /** The content as it is. Other clients may have put `\r\n` line endings into it. */
    raw: string;
    /** The content with `\n` line endings */
    text: string;
    /** The offsets of the `\r\n` line endings of {@link raw}, computed on demand */
    lineEndings?: number[];
}

/**
 * Keeps an asynchronously editable buffer in sync with a shared `Y.Text`.
 *
 * It relies on a single invariant: the shadow is the content of the buffer, as far as the buffer
 * has reported it. Everything is derived from the shadow and the shared text:
 *
 * - A change of the shared text is never replayed. Instead, one edit at a time, the difference
 *   between the buffer and the shared text is applied to the buffer until both agree. An edit the
 *   buffer rejects is simply computed anew.
 * - A change of the buffer is a local change, unless it is exactly the edit that is on its way
 *   and the buffer accepts that edit.
 * - A local change made while the buffer is behind addresses the buffer, not the shared text.
 *   It is rebased onto the shared text before it is written to it.
 *
 * The sync only ever writes `\n` line endings to the shared text. Both the buffer and the shared
 * text may contain `\r\n` as well, even for some of their lines only: other clients write the
 * text of their editor as it is. Offsets of the buffer and of the shared text are converted accordingly.
 */
export class YjsTextDocumentSync implements types.Disposable {

    /** The content of the buffer, as far as the buffer has reported it */
    private buffer: string;
    /** The content of the buffer with `\n` line endings */
    private shadow: string;
    /** The offsets of the `\r\n` line endings of the buffer, computed on demand */
    private bufferLineEndings?: number[];
    private snapshot?: SharedSnapshot;
    /** The number of changes the buffer has reported */
    private revision = 0;
    /**
     * Whether the shared text holds the document. A buffer that has content while the shared text is
     * empty got its content from elsewhere: the document has not been shared yet. The buffer then
     * stands for itself until the document is {@link seed seeded} from either side.
     */
    private shared: boolean;
    /** The content the buffer had when the sync was created, as long as the document is not shared */
    private unsharedBase?: string;
    private unsharedTimer?: ReturnType<typeof setTimeout>;
    /** Whether the shared text may contain changes that are not part of the buffer */
    private behind = false;
    /** Whether a change of the shared text is our own */
    private writing = false;
    private inFlight?: InFlightEdit;
    private pumping?: Promise<void>;
    private disposed = false;
    private readonly observer = () => {
        this.snapshot = undefined;
        this.onDidChangeShared();
    };

    constructor(
        private readonly ytext: Y.Text,
        private readonly adapter: TextDocumentAdapter,
        private readonly options: YjsTextDocumentSyncOptions = {}
    ) {
        this.buffer = adapter.getText();
        this.shadow = normalize(this.buffer);
        this.shared = ytext.length > 0 || this.shadow.length === 0;
        this.unsharedBase = this.shared ? undefined : this.shadow;
        ytext.observe(this.observer);
        if (this.shared && this.readShared().text !== this.shadow) {
            // A shared text that holds the document is authoritative
            this.behind = true;
            this.schedule();
        }
    }

    /**
     * Whether the buffer contains everything the shared text contains.
     */
    get synced(): boolean {
        return this.shared && !this.behind;
    }

    /**
     * The content of the buffer, as far as the buffer has reported it.
     */
    get text(): string {
        return this.buffer;
    }

    /**
     * Shares the document by replacing the shared text with the content of the buffer.
     */
    seed(): void {
        this.setBuffer(this.adapter.getText());
        this.write(() => {
            this.ytext.delete(0, this.ytext.length);
            if (this.shadow.length > 0) {
                this.ytext.insert(0, this.shadow);
            }
        });
        this.markShared();
        this.behind = false;
    }

    /**
     * Reports a change of the buffer. Needs to be called for every change, in order, and before the
     * buffer changes again.
     *
     * All changes address the buffer as it was before any of them was applied, and must not overlap.
     */
    onDidChangeContent(changes: YTextChange[]): void {
        if (this.disposed || changes.length === 0) {
            return;
        }
        this.revision++;
        const before = this.shadow;
        const reported = this.sanitize(changes);
        let local = this.toNormalizedChanges(reported);
        const buffer = applyTextChanges(this.buffer, reported);
        let after: string;
        if (!keepsLineEndings(this.buffer, reported)) {
            // A change took a line ending apart or put one together
            after = normalize(buffer);
            local = diffText(before, after);
        } else if (this.buffer === before && reported.every(change => !change.text.includes('\r'))) {
            after = buffer;
        } else {
            after = applyTextChanges(before, local);
        }
        this.buffer = buffer;
        this.shadow = after;
        this.bufferLineEndings = undefined;
        if (before === after) {
            // A change of nothing but line endings is not a change of the shared text
            return;
        }
        const inFlight = this.inFlight;
        if (inFlight?.echo) {
            inFlight.held.push({ before, changes: local });
        } else if (inFlight && before === inFlight.before && after === inFlight.after) {
            inFlight.echo = local;
        } else if (!this.shared) {
            // The changes of a document that is not shared are written once it is, see onDidChangeShared
            this.expectToBeShared();
        } else {
            // Offsets address the buffer. If it is behind, they need to be rebased onto the shared text.
            this.writeChanges(local, this.behind ? diffText(before, this.readShared().text) : []);
            this.schedule();
        }
    }

    /**
     * Reads the buffer anew. Needs to be called when the buffer changed in a way that was not
     * reported as a change of its content, like switching its line endings.
     */
    refresh(): void {
        if (this.disposed) {
            return;
        }
        // An edit that is on its way was computed for the previous state of the buffer
        this.revision++;
        const shadow = this.shadow;
        this.setBuffer(this.adapter.getText());
        if (shadow !== this.shadow) {
            // The content did change. The shared text is authoritative, so the change is replaced.
            this.behind = this.shared;
            this.schedule();
        }
    }

    /**
     * Writes changes to the shared text that address a text the pending changes have not been applied to.
     */
    private writeChanges(changes: YTextChange[], pending: YTextChange[]): void {
        // The rebased changes address the shared text with `\n` line endings
        const operations = changes.map(change => {
            const { deletions, insertAt } = rebase(change, pending);
            return {
                deletions: deletions.map(({ start, end }) => ({
                    start: this.toSharedOffset(start),
                    end: this.toSharedOffset(end)
                })),
                insertAt: this.toSharedOffset(insertAt),
                text: change.text
            };
        });
        this.write(() => {
            // Back to front, so that a change does not move the ones that are still to be written
            for (let i = operations.length - 1; i >= 0; i--) {
                const { deletions, insertAt, text } = operations[i];
                for (let j = deletions.length - 1; j >= 0; j--) {
                    this.ytext.delete(deletions[j].start, deletions[j].end - deletions[j].start);
                }
                if (text.length > 0) {
                    this.ytext.insert(insertAt, text);
                }
            }
        });
    }

    /**
     * Resolves once the changes of the shared text have reached the buffer, or the sync gave up on them.
     */
    async flush(): Promise<void> {
        this.schedule();
        await this.pumping;
    }

    /**
     * Converts an offset of the buffer to the offset of the shared text.
     *
     * While the buffer is behind, the offset is moved along with the changes it has yet to receive.
     */
    normalizedOffset(offset: number): number {
        let result = this.toShadowOffset(offset);
        if (this.shared && this.behind) {
            result = moveOffset(result, diffText(this.shadow, this.readShared().text), true);
        }
        return this.toSharedOffset(result);
    }

    /**
     * Converts an offset of the shared text to the offset of the buffer.
     *
     * While the buffer is behind, the result is where the offset is going to be once the buffer has
     * caught up, as far as the buffer has such a place already. See {@link YjsTextDocumentSyncOptions.onDidSync}.
     */
    editorOffset(normalizedOffset: number): number {
        let result = this.fromSharedOffset(normalizedOffset);
        if (this.shared && this.behind) {
            result = moveOffset(result, diffText(this.shadow, this.readShared().text), false);
        }
        return this.toBufferOffset(result);
    }

    dispose(): void {
        if (!this.disposed) {
            this.disposed = true;
            clearTimeout(this.unsharedTimer);
            this.ytext.unobserve(this.observer);
        }
    }

    private onDidChangeShared(): void {
        if (this.writing || this.disposed) {
            return;
        }
        const base = this.unsharedBase;
        this.markShared();
        if (base !== undefined && base !== this.shadow) {
            // The buffer was changed before the document got shared. Its changes address the content
            // it started with, which usually is the content the document got shared with. If it is
            // not, they are rebased like any other change of a buffer that is behind.
            this.writeChanges(diffText(base, this.shadow), diffText(base, this.readShared().text));
        }
        this.behind = true;
        this.schedule();
    }

    private markShared(): void {
        this.shared = true;
        this.unsharedBase = undefined;
        clearTimeout(this.unsharedTimer);
        this.unsharedTimer = undefined;
    }

    /**
     * Reports changes that are held back for longer than it should take to share the document.
     */
    private expectToBeShared(): void {
        const timeout = this.options.unsharedTimeout ?? 5000;
        if (this.unsharedTimer === undefined && timeout > 0) {
            this.unsharedTimer = setTimeout(() => {
                if (!this.shared && !this.disposed) {
                    this.options.onError?.(new Error('The document has not been shared yet. Its changes are held back until it is.'));
                }
            }, timeout);
        }
    }

    private setBuffer(buffer: string): void {
        if (buffer !== this.buffer) {
            this.buffer = buffer;
            this.shadow = normalize(buffer);
            this.bufferLineEndings = undefined;
        }
    }

    private readShared(): SharedSnapshot {
        if (!this.snapshot) {
            const raw = this.ytext.toString();
            this.snapshot = { raw, text: normalize(raw) };
        }
        return this.snapshot;
    }

    private write(callback: () => void): void {
        this.writing = true;
        try {
            if (this.ytext.doc) {
                this.ytext.doc.transact(callback);
            } else {
                callback();
            }
        } finally {
            this.writing = false;
            this.snapshot = undefined;
        }
    }

    private schedule(): void {
        if (this.behind && !this.pumping && !this.disposed) {
            this.pumping = this.pump();
        }
    }

    /**
     * Applies the difference between the buffer and the shared text to the buffer until both agree.
     */
    private async pump(): Promise<void> {
        try {
            // Wait for the current batch of changes to complete
            await Promise.resolve();
            const maxStalled = this.options.maxStalledAttempts ?? 5;
            let stalled = 0;
            while (this.behind && !this.disposed) {
                // The shared text is authoritative. Should the buffer ever have changed without
                // reporting it, the unreported change is replaced along with everything else.
                this.setBuffer(this.adapter.getText());
                const before = this.shadow;
                const target = this.readShared().text;
                if (before === target) {
                    this.behind = false;
                    break;
                }
                const inFlight: InFlightEdit = this.inFlight = { before, after: target, held: [] };
                const revision = this.revision;
                let applied = false;
                let failed = false;
                try {
                    applied = await this.adapter.applyChanges(this.toEditorChanges(diffText(before, target)));
                } catch (error) {
                    failed = true;
                    this.options.onError?.(error);
                } finally {
                    this.inFlight = undefined;
                }
                if (inFlight.echo && !this.disposed) {
                    if (!applied && !failed) {
                        // The buffer rejected the edit, so it was the user who made the very same change
                        inFlight.held.unshift({ before, changes: inFlight.echo });
                    }
                    for (const held of inFlight.held) {
                        this.writeChanges(held.changes, diffText(held.before, this.readShared().text));
                    }
                }
                // A rejected edit is expected when the buffer changed in the meantime,
                // even if the change left its content as it was
                if (inFlight.echo || (!applied && this.revision !== revision)) {
                    stalled = 0;
                } else if (++stalled >= maxStalled) {
                    this.options.onError?.(new Error('Failed to apply the changes of the shared document.'));
                    break;
                } else {
                    await new Promise(resolve => setTimeout(resolve, 10 * stalled));
                }
            }
            if (!this.behind && !this.disposed) {
                this.options.onDidSync?.();
            }
        } catch (error) {
            this.options.onError?.(error);
        } finally {
            this.pumping = undefined;
        }
    }

    /**
     * Sorts the changes and keeps them within the buffer and apart from each other.
     */
    private sanitize(changes: YTextChange[]): YTextChange[] {
        let last = 0;
        return [...changes].sort((a, b) => a.start - b.start).map(change => {
            const start = Math.min(Math.max(change.start, last), this.buffer.length);
            const end = last = Math.min(Math.max(change.end, start), this.buffer.length);
            return { start, end, text: change.text };
        });
    }

    private toNormalizedChanges(changes: YTextChange[]): YTextChange[] {
        return changes.map(change => ({
            start: this.toShadowOffset(change.start),
            end: this.toShadowOffset(change.end),
            text: normalize(change.text)
        }));
    }

    private toEditorChanges(changes: YTextChange[]): YTextChange[] {
        const eol = this.adapter.getEol();
        return changes.map(change => ({
            start: this.toBufferOffset(change.start),
            end: this.toBufferOffset(change.end),
            text: eol === '\n' ? change.text : change.text.replace(/\n/g, eol)
        }));
    }

    /**
     * Converts an offset of the buffer to the offset of the shadow. They only differ in their line
     * endings: a `\r\n` of the buffer is a single `\n` in the shadow.
     */
    private toShadowOffset(offset: number): number {
        return toNormalizedOffset(this.buffer, this.shadow, () => this.getBufferLineEndings(), offset);
    }

    private toBufferOffset(offset: number): number {
        return fromNormalizedOffset(this.buffer, this.shadow, () => this.getBufferLineEndings(), offset);
    }

    private getBufferLineEndings(): number[] {
        return this.bufferLineEndings ??= findLineEndings(this.buffer);
    }

    /**
     * Converts an offset of the shared text with `\n` line endings to the offset of the shared text as it is.
     */
    private toSharedOffset(offset: number): number {
        const shared = this.readShared();
        return fromNormalizedOffset(shared.raw, shared.text, () => shared.lineEndings ??= findLineEndings(shared.raw), offset);
    }

    private fromSharedOffset(offset: number): number {
        const shared = this.readShared();
        return toNormalizedOffset(shared.raw, shared.text, () => shared.lineEndings ??= findLineEndings(shared.raw), offset);
    }
}

interface RebasedChange {
    /** The parts of the changed range that still exist. Sorted, and all of them at or after {@link insertAt} */
    deletions: Array<{ start: number, end: number }>;
    insertAt: number;
}

/**
 * Rebases a change onto the text that results from applying the pending changes. Both the change
 * and the pending changes address the same text.
 *
 * Text that is inserted by a pending change is kept, even within the range of the change.
 */
function rebase(change: YTextChange, pending: YTextChange[]): RebasedChange {
    const deletions: RebasedChange['deletions'] = [];
    let insertAt: number | undefined;
    // By how much the text between the previous and the next pending change has moved
    let shift = 0;
    let keptFrom = 0;
    const deleteKept = (keptTo: number) => {
        const start = Math.max(keptFrom, change.start);
        const end = Math.min(keptTo, change.end);
        if (start < end) {
            deletions.push({ start: start + shift, end: end + shift });
        }
    };
    for (const other of pending) {
        deleteKept(other.start);
        if (insertAt === undefined && change.start < other.end) {
            // Text that is replaced by a pending change no longer offers a position
            insertAt = Math.min(change.start, other.start) + shift;
        }
        shift += other.text.length - (other.end - other.start);
        keptFrom = other.end;
    }
    deleteKept(Number.MAX_SAFE_INTEGER);
    return { deletions, insertAt: insertAt ?? change.start + shift };
}

/**
 * Moves an offset along with changes: from the text the changes address to the text that results
 * from applying them if `forward` is set, the other way around if not.
 *
 * An offset within text that has no counterpart is moved to the start of the change.
 */
function moveOffset(offset: number, changes: YTextChange[], forward: boolean): number {
    // By how much the text behind the previous change has moved
    let shift = 0;
    for (const change of changes) {
        const start = forward ? change.start : change.start + shift;
        const end = forward ? change.end : start + change.text.length;
        if (offset <= start) {
            break;
        }
        if (offset < end) {
            return forward ? change.start + shift : change.start;
        }
        shift += change.text.length - (change.end - change.start);
    }
    return forward ? offset + shift : offset - shift;
}

function normalize(text: string): string {
    return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

const CARRIAGE_RETURN = 13;
const LINE_FEED = 10;

/**
 * Whether no change takes a `\r\n` of the text apart or puts one together. The line endings of the
 * changed text then are the ones the text and the inserted texts have on their own.
 *
 * The changes need to be sorted and must not overlap.
 */
function keepsLineEndings(text: string, changes: YTextChange[]): boolean {
    let previousEnd = -1;
    for (const { start, end, text: inserted } of changes) {
        if (start === previousEnd) {
            // The inserted texts of two changes that touch may form a line ending
            return false;
        }
        previousEnd = end;
        const previous = start > 0 ? text.charCodeAt(start - 1) : 0;
        const next = end < text.length ? text.charCodeAt(end) : 0;
        if (previous === CARRIAGE_RETURN && text.charCodeAt(start) === LINE_FEED) {
            return false;
        }
        if (next === LINE_FEED && end > 0 && text.charCodeAt(end - 1) === CARRIAGE_RETURN) {
            return false;
        }
        const first = inserted.length > 0 ? inserted.charCodeAt(0) : next;
        const last = inserted.length > 0 ? inserted.charCodeAt(inserted.length - 1) : previous;
        if ((previous === CARRIAGE_RETURN && first === LINE_FEED) || (last === CARRIAGE_RETURN && next === LINE_FEED)) {
            return false;
        }
    }
    return true;
}

/**
 * Returns the offsets of the `\r\n` line endings of a text. They are all that moves an offset when
 * the line endings of the text are normalized: a `\r\n` becomes a single `\n`.
 */
function findLineEndings(text: string): number[] {
    const result: number[] = [];
    for (let index = text.indexOf('\r\n'); index >= 0; index = text.indexOf('\r\n', index + 2)) {
        result.push(index);
    }
    return result;
}

/**
 * Returns the number of leading items of a list that match the predicate.
 * Once an item does not match, none of the following may.
 */
function countLeading(length: number, matches: (index: number) => boolean): number {
    let low = 0;
    let high = length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (matches(mid)) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

/**
 * Converts an offset of a text to the offset of the same text with `\n` line endings.
 * An offset within a line ending is taken as the one behind it.
 */
function toNormalizedOffset(text: string, normalized: string, lineEndings: () => number[], offset: number): number {
    offset = Math.max(0, Math.min(offset, text.length));
    if (text.length === normalized.length) {
        return offset;
    }
    const offsets = lineEndings();
    return offset - countLeading(offsets.length, i => offsets[i] + 1 < offset);
}

/**
 * Converts an offset of a text with `\n` line endings to the offset of the same text as it is.
 */
function fromNormalizedOffset(text: string, normalized: string, lineEndings: () => number[], offset: number): number {
    offset = Math.max(0, Math.min(offset, normalized.length));
    if (text.length === normalized.length) {
        return offset;
    }
    const offsets = lineEndings();
    // The line ending at offsets[i] is the character at offsets[i] - i of the normalized text
    return offset + countLeading(offsets.length, i => offsets[i] - i < offset);
}
