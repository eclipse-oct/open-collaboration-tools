// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { ClientAwareness, ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import { OpenCollaborationYjsProvider, LOCAL_ORIGIN } from 'open-collaboration-yjs';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

export interface Position {
    line: number;
    column: number;
}

export interface DocumentInsert {
    type: 'insert';
    offset: number;
    position: Position;
    text: string;
}

export interface DocumentDelete {
    type: 'delete';
    startOffset: number;
    endOffset: number;
    startPosition: Position;
    endPosition: Position;
}

export type DocumentChange = DocumentInsert | DocumentDelete;

export interface IDocumentSync {
    applyEdit(documentPath: string, text: string, offset: number, replacedLength: number): void;
}

export class DocumentSync implements IDocumentSync {

    private readonly yjs: Y.Doc;
    private readonly yjsAwareness: awarenessProtocol.Awareness;
    private readonly yjsProvider: OpenCollaborationYjsProvider;

    private activeDocument?: Y.Text;
    private activeDocumentPath?: string;
    private hostId?: string;
    private documentInitialized = false;

    private onDocumentContentChangeCallback?: (documentPath: string, content: string, changes: DocumentChange[]) => void;
    private onActiveDocumentChangeCallback?: (documentPath: string) => void;

    constructor(private readonly connection: ProtocolBroadcastConnection) {
        this.yjs = new Y.Doc();
        this.yjsAwareness = new awarenessProtocol.Awareness(this.yjs);

        // Set up the Yjs provider
        this.yjsProvider = new OpenCollaborationYjsProvider(connection, this.yjs, this.yjsAwareness, {
            resyncTimer: 10_000
        });
        this.yjsProvider.connect();

        // Handle reconnection
        connection.onReconnect(() => {
            this.yjsProvider.connect();
        });

        // Listen for host's active document changes
        this.yjsAwareness.on('change', (_: any, origin: string) => {
            if (origin !== LOCAL_ORIGIN && this.hostId) {
                const states = this.yjsAwareness.getStates() as Map<number, ClientAwareness>;
                for (const state of states.values()) {
                    // Only follow documents from the host
                    if (state.peer === this.hostId && state.selection) {
                        this.followDocument(state.selection.path);
                        break;
                    }
                }
            }
        });

        // Get host information
        connection.peer.onInit((_, initData) => {
            this.hostId = initData.host.id;

            // Now that we know the host, check if there's already a document to follow
            const states = this.yjsAwareness.getStates() as Map<number, ClientAwareness>;
            for (const state of states.values()) {
                if (state.peer === this.hostId && state.selection) {
                    this.followDocument(state.selection.path);
                    break;
                }
            }
        });
    }

    private followDocument(documentPath: string) {
        if (this.activeDocumentPath === documentPath) {
            return;
        }

        // Unsubscribe from previous document if any
        if (this.activeDocument) {
            this.activeDocument.unobserve(this.handleContentChange);
        }

        // Set up new document
        this.activeDocumentPath = documentPath;
        this.activeDocument = this.yjs.getText(documentPath);
        this.documentInitialized = false;

        // Listen for content changes on the active document
        this.activeDocument.observe(this.handleContentChange);

        // Request the document from the host
        if (this.hostId) {
            this.connection.editor.open(this.hostId, documentPath);
        }

        // Trigger the active document change callback
        if (this.onActiveDocumentChangeCallback) {
            this.onActiveDocumentChangeCallback(documentPath);
        }
    }

    private handleContentChange = (event: Y.YTextEvent) => {
        if (!this.onDocumentContentChangeCallback || !this.activeDocumentPath || !this.activeDocument) {
            return;
        }
        if (!this.documentInitialized && event.delta.length === 1 && typeof event.delta[0].insert === 'string') {
            // Skip the initial sync event (single insert at offset 0 with entire content)
            this.documentInitialized = true;
            return;
        }
        if (event.transaction.local) {
            return;
        }

        const content = this.activeDocument.toString();
        const documentChanges: DocumentChange[] = [];
        let index = 0;
        for (const delta of event.delta) {
            if ('retain' in delta && typeof delta.retain === 'number') {
                index += delta.retain;
            } else if ('insert' in delta && typeof delta.insert === 'string') {
                const position = this.offsetToPosition(content, index);
                documentChanges.push({
                    type: 'insert',
                    offset: index,
                    position,
                    text: delta.insert
                });
                index += delta.insert.length;
            } else if ('delete' in delta && typeof delta.delete === 'number') {
                const startPosition = this.offsetToPosition(content, index);
                const endPosition = this.offsetToPosition(content, index + delta.delete);
                documentChanges.push({
                    type: 'delete',
                    startOffset: index,
                    endOffset: index + delta.delete,
                    startPosition,
                    endPosition
                });
            }
        }

        this.onDocumentContentChangeCallback(this.activeDocumentPath, content, documentChanges);
    };

    private offsetToPosition(text: string, offset: number): Position {
        const textBeforeOffset = text.substring(0, offset);
        const lines = textBeforeOffset.split('\n');
        return {
            line: lines.length - 1,
            column: lines[lines.length - 1].length
        };
    }

    getActiveDocumentContent(): string | undefined {
        return this.activeDocument?.toString();
    }

    getActiveDocumentPath(): string | undefined {
        return this.activeDocumentPath;
    }

    /**
     * Register a callback to be invoked when the active document's content changes
     * @param callback The function to call when document content changes
     */
    onDocumentChange(callback: (documentPath: string, content: string, changes: DocumentChange[]) => void): void {
        if (this.onDocumentContentChangeCallback) {
            throw new Error('Document change callback already registered');
        }
        this.onDocumentContentChangeCallback = callback;
    }

    /**
     * Register a callback to be invoked when the active document changes
     * @param callback The function to call when active document changes
     */
    onActiveChange(callback: (documentPath: string) => void): void {
        if (this.onActiveDocumentChangeCallback) {
            throw new Error('Active document change callback already registered');
        }
        this.onActiveDocumentChangeCallback = callback;
    }

    dispose(): void {
        if (this.activeDocument) {
            this.activeDocument.unobserve(this.handleContentChange);
        }
        this.yjsProvider.dispose();
        this.yjs.destroy();
        this.yjsAwareness.destroy();
    }

    /**
     * Applies text changes to the active document
     * @param documentPath The path of the document to edit
     * @param text The text to insert
     * @param offset The offset at which to insert the text
     * @param replacedLength The length of text to replace (0 for insertion only)
     */
    applyEdit(documentPath: string, text: string, offset: number, replacedLength: number): void {
        const document = this.activeDocumentPath === documentPath
            ? this.activeDocument
            : this.yjs.getText(documentPath);
        if (!document) {
            throw new Error('No document to apply changes to');
        }

        if (replacedLength === 1 && text.length === 1) {
            // Special case for flicker-free busy indicator
            document.applyDelta([
                { retain: offset },
                { delete: replacedLength },
                { insert: text }
            ]);
        } else {
            if (replacedLength > 0) {
                document.delete(offset, replacedLength);
            }
            if (text.length > 0) {
                document.insert(offset, text);
            }
        }
    }
}
