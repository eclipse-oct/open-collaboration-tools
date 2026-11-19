// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { YTextChange } from './text-change.js';

/**
 * Beyond these bounds the differing region is replaced as a whole instead of being diffed.
 * The diff costs `O(size * distance)` time and `O(distance²)` memory.
 */
const MAX_DIFF_SIZE = 50_000;
const MAX_DIFF_DISTANCE = 500;

/**
 * Applies changes to a text. All changes address the text as it was before any of them
 * was applied, and must not overlap.
 */
export function applyTextChanges(text: string, changes: YTextChange[]): string {
    let result = '';
    let last = 0;
    for (const change of [...changes].sort((a, b) => a.start - b.start)) {
        result += text.substring(last, change.start) + change.text;
        last = change.end;
    }
    return result + text.substring(last);
}

/**
 * Computes the changes that turn `before` into `after`.
 *
 * The result is sorted, its changes neither overlap nor touch, and all of them address `before`.
 * A change never separates the two halves of a surrogate pair, as Yjs replaces both halves of
 * a pair it has to split.
 */
export function diffText(before: string, after: string): YTextChange[] {
    if (before === after) {
        return [];
    }
    const max = Math.min(before.length, after.length);
    let prefix = 0;
    while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
        prefix++;
    }
    if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) {
        prefix--;
    }
    let suffix = 0;
    const maxSuffix = max - prefix;
    while (suffix < maxSuffix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) {
        suffix++;
    }
    if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) {
        suffix--;
    }
    const removed = before.substring(prefix, before.length - suffix);
    const inserted = after.substring(prefix, after.length - suffix);
    const replaceAll: YTextChange[] = [{ start: prefix, end: prefix + removed.length, text: inserted }];
    if (removed.length === 0 || inserted.length === 0 || removed.length + inserted.length > MAX_DIFF_SIZE) {
        return replaceAll;
    }
    // Diff code points instead of code units, so that no surrogate pair is separated
    const changes = diffTokens(Array.from(removed), Array.from(inserted));
    if (!changes) {
        return replaceAll;
    }
    for (const change of changes) {
        change.start += prefix;
        change.end += prefix;
    }
    return changes;
}

/**
 * Myers' diff algorithm. Returns `undefined` if the inputs are too far apart.
 */
function diffTokens(a: string[], b: string[]): YTextChange[] | undefined {
    const n = a.length;
    const m = b.length;
    // Texts that have next to nothing in common are better off being replaced as a whole
    const max = Math.min(Math.floor((n + m) * 0.8), MAX_DIFF_DISTANCE);
    const center = max + 1;
    // v[center + k] is the furthest position in `a` reached on diagonal k (= x - y)
    const v = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    const goesDown = (state: Int32Array, d: number, k: number) =>
        k === -d || (k !== d && state[center + k - 1] < state[center + k + 1]);
    for (let d = 0; d <= max; d++) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
            let x = goesDown(v, d, k) ? v[center + k + 1] : v[center + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x++;
                y++;
            }
            v[center + k] = x;
            if (x >= n && y >= m) {
                return toChanges(a, b, backtrack(trace, d, n, m, center, goesDown));
            }
        }
    }
    return undefined;
}

interface TokenEdit {
    /** Position in `a` at which the edit happens */
    at: number;
    /** Index of the token of `b` to insert. The token of `a` at {@link at} is deleted if this is undefined. */
    insert?: number;
}

function backtrack(
    trace: Int32Array[], distance: number, n: number, m: number, center: number,
    goesDown: (state: Int32Array, d: number, k: number) => boolean
): TokenEdit[] {
    const edits: TokenEdit[] = [];
    let x = n;
    let y = m;
    for (let d = distance; d > 0; d--) {
        const state = trace[d];
        const k = x - y;
        const down = goesDown(state, d, k);
        const previousK = down ? k + 1 : k - 1;
        x = state[center + previousK];
        y = x - previousK;
        edits.push(down ? { at: x, insert: y } : { at: x });
    }
    return edits.reverse();
}

function toChanges(a: string[], b: string[], edits: TokenEdit[]): YTextChange[] {
    // Offsets of the tokens of `a`, as tokens can be longer than one code unit
    const offsets = new Array<number>(a.length + 1);
    let offset = 0;
    for (let i = 0; i < a.length; i++) {
        offsets[i] = offset;
        offset += a[i].length;
    }
    offsets[a.length] = offset;
    const changes: YTextChange[] = [];
    let current: YTextChange | undefined;
    let currentEnd = -1;
    for (const edit of edits) {
        if (!current || edit.at !== currentEnd) {
            current = { start: offsets[edit.at], end: offsets[edit.at], text: '' };
            currentEnd = edit.at;
            changes.push(current);
        }
        if (edit.insert !== undefined) {
            current.text += b[edit.insert];
        } else {
            currentEnd = edit.at + 1;
            current.end = offsets[currentEnd];
        }
    }
    return changes;
}

function isHighSurrogate(charCode: number): boolean {
    return charCode >= 0xD800 && charCode <= 0xDBFF;
}

function isLowSurrogate(charCode: number): boolean {
    return charCode >= 0xDC00 && charCode <= 0xDFFF;
}
