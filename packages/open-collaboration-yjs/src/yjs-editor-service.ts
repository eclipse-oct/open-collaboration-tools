// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as Y from 'yjs';
import * as YA from 'y-protocols/awareness';
import * as types from 'open-collaboration-protocol';
import { YTextChange } from './ytext-change-tracker';
import { LOCAL_ORIGIN } from './yjs-provider';

export interface YjsPeerState {
    clientId: number;
    clock: number;
    lastUpdated: number;
    awareness: types.ClientAwareness;
}

export class YjsEditorService {

    private _doc: Y.Doc;
    private _awareness: YA.Awareness;

    constructor(doc: Y.Doc, awareness: YA.Awareness) {
        this._doc = doc;
        this._awareness = awareness;
    }

    get doc(): Y.Doc {
        return this._doc;
    }

    get awareness(): YA.Awareness {
        return this._awareness;
    }

    getText(type: string, name: string): Y.Text {
        const map = this._doc.getMap<Y.Text>(type);
        const existing = map.get(name);
        if (existing) {
            return existing;
        } else {
            const ytext = new Y.Text();
            map.set(name, ytext);
            return ytext;
        }
    }

    addTextObserver(ytext: Y.Text, callback: (changes: YTextChange[]) => void): types.Disposable {
        const observer = (event: Y.YTextEvent) => {
            if (event.transaction.local) {
                // Ignore local changes
                return;
            }
            const changes = YTextChange.fromDelta(event.changes.delta);
            callback(changes);
        };
        ytext.observe(observer);
        return { dispose: () => ytext.unobserve(observer) };
    }

    getEditorText(path: string): Y.Text {
        return this.getText('text', path);
    }

    setClientAwareness(awareness: types.ClientAwareness): void {
        this._awareness.setLocalState(awareness);
    }

    setClientAwarenessField<T extends keyof types.ClientAwareness>(field: T, value: types.ClientAwareness[T]): void {
        this._awareness.setLocalStateField(field, value);
    }

    getClientStates(excludeSelf = false): YjsPeerState[] {
        const states: YjsPeerState[] = [];
        const awarenessStates = this._awareness.getStates();
        for (const [clientId, state] of awarenessStates) {
            if (excludeSelf && clientId === this._awareness.clientID) {
                continue;
            }
            const meta = this._awareness.meta.get(clientId);
            if (meta) {
                const { clock, lastUpdated } = meta;
                states.push({
                    clientId,
                    clock,
                    lastUpdated,
                    awareness: state as types.ClientAwareness
                });
            }
        }
        return states;
    }

    getClientState(peerId: string): YjsPeerState | undefined {
        return this.getClientStates().find(state => state.awareness.peer === peerId);
    }

    getClientAwareness(peerId: string): types.ClientAwareness | undefined {
        return this.getClientState(peerId)?.awareness;
    }

    onDidChangeAwareness(callback: () => void): types.Disposable {
        const observer = (_: any, origin: string) => {
            if (origin !== LOCAL_ORIGIN) {
                callback();
            }
        };
        this._awareness.on('change', observer);
        return { dispose: () => this._awareness.off('change', observer) };
    }

}