// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test } from 'vitest';
import { applyTextChanges, diffText } from '../src/text-diff.js';

function random(seed: number): () => number {
    // Park-Miller generator
    return () => {
        seed = (seed * 48271) % 2147483647;
        return seed / 2147483647;
    };
}

describe('diffText', () => {

    test('returns no changes for equal texts', () => {
        expect(diffText('same', 'same')).toEqual([]);
    });

    test('reports an insertion as a single insertion', () => {
        expect(diffText('hello world', 'hello big world')).toEqual([{ start: 6, end: 6, text: 'big ' }]);
    });

    test('reports a deletion as a single deletion', () => {
        expect(diffText('hello big world', 'hello world')).toEqual([{ start: 6, end: 10, text: '' }]);
    });

    test('keeps the text between two distant changes untouched', () => {
        const before = 'first line\nsecond line\nthird line';
        const after = 'First line\nsecond line\nthird line!';
        expect(diffText(before, after)).toEqual([
            { start: 0, end: 1, text: 'F' },
            { start: 33, end: 33, text: '!' }
        ]);
    });

    test('does not separate surrogate pairs', () => {
        // Both emojis share their high surrogate
        const before = 'a\u{1F600}b';
        const after = 'a\u{1F601}b';
        expect(diffText(before, after)).toEqual([{ start: 1, end: 3, text: '\u{1F601}' }]);
        expect(diffText('\u{1F600}x\u{1F600}', '\u{1F601}x\u{1F601}')).toEqual([
            { start: 0, end: 2, text: '\u{1F601}' },
            { start: 3, end: 5, text: '\u{1F601}' }
        ]);
    });

    test('falls back to a single replacement for texts that are too far apart', () => {
        const before = 'start ' + 'a'.repeat(1000) + ' end';
        const after = 'start ' + 'b'.repeat(1000) + ' end';
        expect(diffText(before, after)).toEqual([{ start: 6, end: 1006, text: 'b'.repeat(1000) }]);
    });

    test('replaces texts as a whole that have next to nothing in common', () => {
        const before = 'this guest-local text must be ignored';
        const after = 'SEEDED FROM HOST DISK';
        expect(diffText(before, after)).toEqual([{ start: 0, end: before.length, text: after }]);
    });

    test('produces sorted, non-touching changes that turn one text into the other', () => {
        const next = random(42);
        const alphabet = 'ab\n \u{1F600}';
        const randomText = (length: number) => {
            let text = '';
            for (let i = 0; i < length; i++) {
                text += Array.from(alphabet)[Math.floor(next() * 5)];
            }
            return text;
        };
        for (let i = 0; i < 500; i++) {
            const before = randomText(Math.floor(next() * 40));
            const after = randomText(Math.floor(next() * 40));
            const changes = diffText(before, after);
            expect(applyTextChanges(before, changes)).toBe(after);
            for (let j = 1; j < changes.length; j++) {
                expect(changes[j].start).toBeGreaterThan(changes[j - 1].end);
            }
        }
    });
});
