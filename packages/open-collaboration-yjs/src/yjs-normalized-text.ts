// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as Y from 'yjs';
import * as types from 'open-collaboration-protocol';

export interface YTextChange {
    start: number;
    end: number;
    text: string;
}

export namespace YTextChange {
    export function sort(changes: YTextChange[]): YTextChange[] {
        // Changes need to be sorted by start position
        // Most algorithms that use this data expect that the changes are sorted by ascending start position
        return [...changes].sort((a, b) => a.start - b.start);
    }
}

export interface YTextChangeDelta {
    insert?: string | object | Y.AbstractType<any>;
    delete?: number;
    retain?: number;
}

export namespace YTextChangeDelta {
    export function isInsert(delta: YTextChangeDelta): delta is { insert: string } {
        return typeof delta.insert === 'string';
    }

    export function isDelete(delta: YTextChangeDelta): delta is { delete: number } {
        return typeof delta.delete === 'number';
    }

    export function isRetain(delta: YTextChangeDelta): delta is { retain: number } {
        return typeof delta.retain === 'number';
    }

    export function toChanges(delta: YTextChangeDelta[]): YTextChange[] {
        const changes: YTextChange[] = [];
        let index = 0;
        for (const op of delta) {
            if (isRetain(op)) {
                index += op.retain;
            } else if (isInsert(op)) {
                changes.push({
                    start: index,
                    end: index,
                    text: op.insert
                });
            } else if (isDelete(op)) {
                changes.push({
                    start: index,
                    end: index + op.delete,
                    text: ''
                });
                // Increase the index by the number of characters deleted
                // In the client, every following operation will still operate on the "old code"
                // So we need to adjust the index to reflect that
                index += op.delete;
            }
        }
        return changes;
    }
}

export interface YTextChangeEvent {
    changes: YTextChange[] | string;
};

export type YjsTextDocumentChangedCallback = (changes: YTextChange[]) => Promise<void>;

interface ChangeSet {
    before: string;
    after: string;
}

export class YjsNormalizedTextDocument implements types.Disposable {

    private _yjsText: Y.Text;
    private _text: string;
    private _textLength: number;
    private _normalizedLength: number;
    private _changeSets: ChangeSet[] = [];
    private _offsets: NormalizedLineOffset[] | undefined;
    private observer: Parameters<Y.Text['observe']>[0];

    constructor(yjsText: Y.Text, callback: YjsTextDocumentChangedCallback) {
        this._yjsText = yjsText;
        this._text = yjsText.toString();
        this.observer = event => {
            this.observe(event, callback);
        };
        yjsText.observe(this.observer);
    }

    private async observe(event: Y.YTextEvent, callback: YjsTextDocumentChangedCallback): Promise<void> {
        if (event.transaction.local) {
            return;
        }
        const hasCR = this._text.includes('\r');
        const changes = YTextChangeDelta.toChanges(event.delta);
        const changeSet: YTextChange[] = [];
        for (const change of changes) {
            changeSet.push({
                start: this.originalOffset(change.start),
                end: this.originalOffset(change.end),
                text: this.normalize(change.text, hasCR),
            });
        }
        const before = this._text;
        // Update the internal text string, but don't broadcast the changes
        this.doUpdate({ changes: changeSet }, false);
        const after = this._text;
        const changeSetItem: ChangeSet = {
            before,
            after,
        };
        this._changeSets.push(changeSetItem);
        await callback(changeSet);
        const index = this._changeSets.indexOf(changeSetItem);
        if (index !== -1) {
            this._changeSets.splice(index, 1);
        }
    }

    dispose(): void {
        this._yjsText.unobserve(this.observer);
    }

    originalOffset(normalizedOffset: number): number {
        const lineOffset = this.findLineOffset(normalizedOffset, 'normalized').offsets;
        const delta = normalizedOffset - lineOffset.normalized;
        const originalOffset = lineOffset.offset + delta;
        return originalOffset;
    }

    originalOffsetAt(position: types.Position): number {
        return this.offsetAt(position, 'offset', this._textLength);
    }

    private offsetAt(position: types.Position, key: keyof NormalizedLineOffset, max: number): number {
        const lineOffsets = this.getLineOffsets();
        if (position.line >= lineOffsets.length) {
            return max;
        } else if (position.line < 0) {
            return 0;
        }
        const lineOffset = lineOffsets[position.line][key];
        if (position.character <= 0) {
            return lineOffset;
        }
        return Math.min(lineOffset + position.character, max);
    }

    positionAtNormalized(normalizedOffset: number): types.Position {
        return this.positionAt(this.originalOffset(normalizedOffset));
    }

    positionAt(offset: number): types.Position {
        const lineOffsets = this.getLineOffsets();
        let low = 0, high = lineOffsets.length;
        if (high === 0) {
            return { line: 0, character: offset };
        }
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (lineOffsets[mid].offset > offset) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        // low is the least x for which the line offset is larger than the current offset
        // or array.length if no line offset is larger than the current offset
        const line = low - 1;

        offset = this.ensureBeforeEOL(offset, lineOffsets[line].offset);
        return { line, character: offset - lineOffsets[line].offset };
    }

    normalizedOffset(offset: number): number {
        const lineOffset = this.findLineOffset(offset, 'offset').offsets;
        const delta = offset - lineOffset.offset;
        const normalizedOffset = lineOffset.normalized + delta;
        return normalizedOffset;
    }

    normalizedOffsetAt(position: types.Position): number {
        return this.offsetAt(position, 'normalized', this._normalizedLength);
    }

    update(event: YTextChangeEvent): void {
        const run = () => {
            if (typeof event.changes === 'string') {
                this.doUpdate(event, true);
            } else {
                if (this.shouldApply(event.changes)) {
                    this.doUpdate(event, true);
                }
            }
        };
        if (this._yjsText.doc) {
            // Wrap the update in a single Yjs transaction
            this._yjsText.doc.transact(() => run());
        } else {
            run();
        }
    }

    private shouldApply(changes: YTextChange[]): boolean {
        changes = YTextChange.sort(changes);
        for (const changeSet of this._changeSets) {
            let fullText = changeSet.before;
            let delta = 0;
            for (const change of changes) {
                const { start, end, text } = change;
                fullText = fullText.substring(0, start + delta) + text + fullText.substring(end + delta);
                delta += change.text.length - (end - start);
            }
            if (fullText === changeSet.after) {
                return false;
            }
        }
        return true;
    }

    private doUpdate(changes: YTextChangeEvent, yjs: boolean): void {
        // Offsets are always reset, they will be recomputed on the next call to getLineOffsets
        this._offsets = undefined;
        if (typeof changes.changes === 'string') {
            this._text = changes.changes;
            if (yjs) {
                const yjsText = this._yjsText.toString();
                this._yjsText.delete(0, yjsText.length);
                this._yjsText.insert(0, this.normalize(this._text, false));
            }
        } else {
            let delta = 0;
            for (const change of YTextChange.sort(changes.changes)) {
                const startOffset = change.start + delta;
                const endOffset = change.end + delta;
                const [normalizedStart, normalizedEnd] = this.countNormalizedOffsets(startOffset, endOffset);
                this._text = this._text.substring(0, startOffset) + change.text + this._text.substring(endOffset);
                delta += change.text.length - (endOffset - startOffset);
                if (yjs) {
                    this._yjsText.delete(normalizedStart, normalizedEnd - normalizedStart);
                    this._yjsText.insert(normalizedStart, this.normalize(change.text, false));
                }
            }
        }
    }

    /**
     * If we are within an update, offsets are unavailable.
     * Therefore, we need a secondary method to count the normalized offsets up to a certain offset in the text.
     *
     * Note that this method is not very efficient, as it needs to iterate over the entire text.
     * However, in 99% of use cases, it is only called once. Making it fast enough for the common case.
     */
    private countNormalizedOffsets(start: number, end: number): [number, number] {
        let nStart = 0;
        let nEnd = 0;
        let i = 0;
        for (;i < end; i++) {
            if (this._text.charCodeAt(i) !== CharCode.CarriageReturn) {
                if (i < start) {
                    nStart++;
                }
                nEnd++;
            }
        }
        return [nStart, nEnd];
    }

    private normalize(text: string, withCR: boolean): string {
        const nl = withCR ? '\r\n' : '\n';
        return text.replace(/\r?\n/g, nl);
    }

    private ensureBeforeEOL(offset: number, lineOffset: number): number {
        while (offset > lineOffset && isEOL(this._text.charCodeAt(offset - 1))) {
            offset--;
        }
        return offset;
    }

    private findLineOffset(offset: number, key: keyof NormalizedLineOffset): {
        offsets: NormalizedLineOffset;
        index: number;
    } {
        const lineOffsets = this.getLineOffsets();
        let low = 0, high = lineOffsets.length;
        while (low < high) {
            // eslint-disable-next-line no-bitwise
            const mid = ((low + high) / 2) | 0;
            if (lineOffsets[mid][key] > offset) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        // low is the least x for which the line offset is larger than the current offset
        const line = low - 1;
        return {
            offsets: lineOffsets[line],
            index: line
        };
    }

    private getLineOffsets(): NormalizedLineOffset[] {
        if (this._offsets === undefined) {
            const lineOffsets = computeNormalizedLineOffsets(this._text);
            this._offsets = lineOffsets.offsets;
            this._textLength = lineOffsets.length;
            this._normalizedLength = lineOffsets.normalizedLength;
        }
        return this._offsets;
    }

}

const enum CharCode {
    /**
     * The `\n` character.
     */
    LineFeed = 10,
    /**
     * The `\r` character.
     */
    CarriageReturn = 13,
}

interface NormalizedLineOffset {
    normalized: number;
    offset: number;
}

function computeNormalizedLineOffsets(text: string): {
    offsets: NormalizedLineOffset[];
    length: number;
    normalizedLength: number;
} {
    const result: NormalizedLineOffset[] = [{
        normalized: 0,
        offset: 0,
    }];
    let normalizationOffset = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (isEOL(ch)) {
            if (ch === CharCode.CarriageReturn && i + 1 < text.length && text.charCodeAt(i + 1) === CharCode.LineFeed) {
                i++;
                normalizationOffset++;
            }
            const offset = i + 1;
            const normalizedOffset = offset - normalizationOffset;
            result.push({
                normalized: normalizedOffset,
                offset: offset,
            });
        }
    }
    return {
        offsets: result,
        length: text.length,
        normalizedLength: text.length + result.length - normalizationOffset,
    };
}

function isEOL(char: number) {
    return char === CharCode.CarriageReturn || char === CharCode.LineFeed;
}
