// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

export interface YTextChange {
    start: number;
    end: number;
    text: string;
}

export interface YTextChangeDelta {
    insert?: string | object;
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
