// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as Y from 'yjs';
import { TextDocument, TextEdit } from 'vscode-languageserver-textdocument';

export interface YTextChange {
    start: number;
    end: number;
    text: string;
}

export interface YTextChangeDelta {
    insert?: string | object | Y.AbstractType<any>;
    delete?: number;
    retain?: number;
    attributes?: Record<string, any>;
}

interface ChangeSet {
    changes: YTextChange[];
    document: TextDocument;
}

export class YTextChangeTracker {

    private changeSets: ChangeSet[] = [];

    async applyDelta(delta: YTextChangeDelta[], document: string, apply: (changes: YTextChange[]) => Promise<void>): Promise<void> {
        const changes: YTextChange[] = [];
        let index = 0;
        for (const op of delta) {
            if (typeof op.retain === 'number') {
                index += op.retain;
            } else if (typeof op.insert === 'string') {
                changes.push({
                    start: index,
                    end: index,
                    text: op.insert
                });
            } else if (typeof op.delete === 'number') {
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
        await this.applyChanges(changes, document, apply);
    }

    async applyChanges(changes: YTextChange[], document: string, apply: (changes: YTextChange[]) => Promise<void>): Promise<void> {
        const changeSet: ChangeSet = {
            changes: changes,
            document: TextDocument.create('', '', 0, document)
        };
        this.changeSets.push(changeSet);
        await apply(changes);
        // Remove the change set from the list of pending changes, as it has been fully applied
        const index = this.changeSets.indexOf(changeSet);
        if (index !== -1) {
            this.changeSets.splice(index, 1);
        }
    }

    private toTextEdits(document: TextDocument, changes: YTextChange[]): TextEdit[] {
        return changes.map(change => ({
            newText: change.text,
            range: {
                start: document.positionAt(change.start),
                end: document.positionAt(change.end)
            }
        }));
    }

    shouldApply(changes: YTextChange[]): boolean {
        for (const changeSet of this.changeSets) {
            // We use TextDocument.applyEdits for convenience here to check whether the changes lead to the same result
            // We cannot simply compare the changes themselves, as they are merged together by the editor (in an unpredictable way)
            const afterNewChange = TextDocument.applyEdits(changeSet.document, this.toTextEdits(changeSet.document, changes));
            const afterExistingChanges = TextDocument.applyEdits(changeSet.document, this.toTextEdits(changeSet.document, changeSet.changes));
            if (afterNewChange === afterExistingChanges) {
                // If the changes lead to the same result, we can ignore them
                // This is usually the case when we have found a change in the client that originates from the collaboration session
                return false;
            }
        }
        return true;
    }

}
