// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as types from 'open-collaboration-protocol';

// socket.io is configured with the default 1 MB `maxHttpBufferSize` (see
// docs/terminal-sharing.md §2), so chunks are capped well below that even after framing
// and encryption overhead.
export const MAX_CHUNK_BYTES = 32 * 1024;
const COALESCE_WINDOW_MS = 10;

/**
 * Coalesces bursty `onData` events from a pty into fewer, size-capped messages and assigns
 * monotonically increasing sequence numbers used for gap detection on the receiving end
 * (see docs/terminal-sharing.md §10). Pure and independent of VS Code/node-pty so it can be
 * unit tested directly.
 */
export class OutputChunker {

    private pending = '';
    private timer: ReturnType<typeof setTimeout> | undefined;
    private seq = 0;
    private disposed = false;

    constructor(private readonly emit: (chunk: types.TerminalChunk) => void) { }

    /** The `seq` of the most recently emitted chunk, or -1 if none has been emitted yet. */
    get currentSeq(): number {
        return this.seq - 1;
    }

    push(data: string): void {
        if (this.disposed) {
            return;
        }
        this.pending += data;
        if (byteLength(this.pending) >= MAX_CHUNK_BYTES) {
            this.flush();
            return;
        }
        if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), COALESCE_WINDOW_MS);
        }
    }

    /** Flushes any buffered output immediately, e.g. right before sending an exit notification. */
    flush(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.pending.length === 0) {
            return;
        }
        for (const part of splitByBytes(this.pending, MAX_CHUNK_BYTES)) {
            this.emit({ seq: this.seq++, data: part });
        }
        this.pending = '';
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.pending = '';
    }
}

function byteLength(text: string): number {
    return Buffer.byteLength(text, 'utf8');
}

/**
 * Splits `text` into chunks of at most `maxBytes` UTF-8 bytes each, without ever slicing a
 * multi-byte character in half.
 */
export function splitByBytes(text: string, maxBytes: number): string[] {
    if (byteLength(text) <= maxBytes) {
        return [text];
    }
    const parts: string[] = [];
    let start = 0;
    while (start < text.length) {
        // Binary search the largest prefix (in UTF-16 code units) whose UTF-8 encoding fits.
        // `low` always progresses by at least one code unit, even if that single unit alone
        // exceeds maxBytes, so a pathologically small cap can't cause an infinite loop.
        let low = start + 1;
        let high = text.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (byteLength(text.slice(start, mid)) <= maxBytes) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        parts.push(text.slice(start, low));
        start = low;
    }
    return parts;
}
