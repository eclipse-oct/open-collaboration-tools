// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { ClientAwareness, ClientTextSelection, ProtocolBroadcastConnection } from 'open-collaboration-protocol';
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
    updateCursorPosition(documentPath: string, offset: number): void;
    getDocumentContent(documentPath: string): string | undefined;
}

export class DocumentSync implements IDocumentSync {

    private readonly yjs: Y.Doc;
    private readonly yjsAwareness: awarenessProtocol.Awareness;
    private readonly yjsProvider: OpenCollaborationYjsProvider;

    private activeDocument?: Y.Text;
    private activeDocumentPath?: string;
    private hostId?: string;
    private documentInitialized = false;
    private hostIdPromise: Promise<string>;
    private hostIdResolve?: (hostId: string) => void;

    private onDocumentContentChangeCallback?: (documentPath: string, content: string, changes: DocumentChange[]) => void;
    private onActiveDocumentChangeCallback?: (documentPath: string) => void;

    constructor(private readonly connection: ProtocolBroadcastConnection) {
        this.yjs = new Y.Doc();
        this.yjsAwareness = new awarenessProtocol.Awareness(this.yjs);

        // Create promise for host ID
        this.hostIdPromise = new Promise((resolve) => {
            this.hostIdResolve = resolve;
        });

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
                this.tryFollowHostDocument();
            } else if (origin !== LOCAL_ORIGIN && !this.hostId) {
                console.error('[DocumentSync] Awareness change received but hostId not yet set — event will be missed');
            }
        });

        // Get host information
        connection.peer.onInit((_, initData) => {
            this.hostId = initData.host.id;
            console.error(`[DocumentSync] onInit: hostId=${initData.host.id}`);

            // Resolve the host ID promise
            if (this.hostIdResolve) {
                this.hostIdResolve(initData.host.id);
            }

            // Re-trigger the Yjs provider sync now that peers are registered.
            // The initial connect() call happens before Peer.Init, so all
            // broadcasts (including the awarenessQuery) are silently dropped
            // because getPublicKeys() returns empty at that point.
            this.yjsProvider.connect();

            // Check if there's already a document to follow
            this.tryFollowHostDocument();
        });
    }

    getConnection(): ProtocolBroadcastConnection {
        return this.connection;
    }

    /**
     * Sets the agent's peer ID in the awareness state
     * This makes the agent's cursor visible to other collaborators
     */
    setAgentPeerId(peerId: string): void {
        this.yjsAwareness.setLocalStateField('peer', peerId);
    }

    /**
     * Waits for the host ID to be received from the connection
     * @returns A promise that resolves with the host ID
     */
    async waitForHostId(): Promise<string> {
        return this.hostIdPromise;
    }

    private followDocument(documentPath: string) {
        if (this.activeDocumentPath === documentPath) {
            return;
        }
        console.error(`[DocumentSync] followDocument: "${documentPath}" (previous: "${this.activeDocumentPath ?? 'none'}")`);

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
     * Actively resolves the host's active document from awareness states,
     * calling followDocument if needed, and waits for the Yjs content sync.
     *
     * This addresses the race condition where:
     * - The awareness `change` event fires before `hostId` is set (skipped), AND
     * - `peer.onInit` fires before awareness states arrive (nothing to follow),
     * resulting in `followDocument` never being called.
     */
    async waitForActiveDocument(timeoutMs = 5000): Promise<{ path: string; content: string } | undefined> {
        const pollIntervalMs = 100;
        const deadline = Date.now() + timeoutMs;
        let logged = false;
        while (Date.now() < deadline) {
            // Actively try to discover + follow the host's document from awareness
            if (!this.activeDocumentPath) {
                this.tryFollowHostDocument();
            }
            if (this.activeDocumentPath) {
                const content = this.activeDocument?.toString();
                if (content && content.length > 0) {
                    return { path: this.activeDocumentPath, content };
                }
                if (!logged) {
                    console.error(`[DocumentSync] waitForActiveDocument: path="${this.activeDocumentPath}" but content is empty, waiting for Yjs sync...`);
                    logged = true;
                }
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }
        console.error(`[DocumentSync] waitForActiveDocument timed out after ${timeoutMs}ms (path="${this.activeDocumentPath ?? 'none'}", hostId="${this.hostId ?? 'none'}")`);
        return undefined;
    }

    /**
     * Checks the current awareness states for the host's selection
     * and calls followDocument if a document path is found.
     */
    private tryFollowHostDocument(): void {
        if (!this.hostId) {
            return;
        }
        const states = this.yjsAwareness.getStates() as Map<number, ClientAwareness>;
        let found = false;
        for (const [clientId, state] of states.entries()) {
            if (state.peer === this.hostId) {
                found = true;
                if (state.selection) {
                    this.followDocument(state.selection.path);
                } else {
                    console.error(`[DocumentSync] Host awareness (clientId=${clientId}) found but has no selection`);
                }
                return;
            }
        }
        if (!found) {
            console.error(`[DocumentSync] No awareness state found for hostId=${this.hostId} (${states.size} total states)`);
        }
    }

    getDocumentContent(documentPath: string): string | undefined {
        const document = this.activeDocumentPath === documentPath
            ? this.activeDocument
            : this.yjs.getText(documentPath);
        return document?.toString();
    }

    /**
     * Register a callback to be invoked when the active document's content changes
     * @param callback The function to call when document content changes
     */
    onDocumentChange(callback: (documentPath: string, content: string, changes: DocumentChange[]) => void): void {
        if (this.onDocumentContentChangeCallback) {
            throw new Error('Document change callback already registered');
        }
        console.debug('[DEBUG] Registering document change callback');
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

    /**
     * Requests the host to open a document and waits for its content to be synced via Yjs.
     * @returns The document content, or undefined if the sync times out
     */
    async openAndWaitForContent(hostId: string, documentPath: string, timeoutMs = 10000): Promise<string | undefined> {
        const existing = this.getDocumentContent(documentPath);
        if (existing) {
            return existing;
        }

        this.connection.editor.open(hostId, documentPath);

        return new Promise((resolve) => {
            const ytext = this.yjs.getText(documentPath);
            const timeout = setTimeout(() => {
                ytext.unobserve(observer);
                resolve(undefined);
            }, timeoutMs);

            const observer = () => {
                const content = ytext.toString();
                if (content) {
                    clearTimeout(timeout);
                    ytext.unobserve(observer);
                    resolve(content);
                }
            };
            ytext.observe(observer);

            const content = ytext.toString();
            if (content) {
                clearTimeout(timeout);
                ytext.unobserve(observer);
                resolve(content);
            }
        });
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

    /**
     * Updates the agent's cursor position in the awareness state
     * @param documentPath The path of the document
     * @param offset The character offset of the cursor
     */
    updateCursorPosition(documentPath: string, offset: number): void {
        const ytext = this.yjs.getText(documentPath);

        // Create a CRDT-based relative position for the cursor
        const relativePosition = Y.createRelativePositionFromTypeIndex(ytext, offset);

        // Create a selection range (cursor is a zero-width selection)
        const textSelection: ClientTextSelection = {
            path: documentPath,
            textSelections: [{
                start: relativePosition,
                end: relativePosition,
                direction: 1 // LeftToRight
            }]
        };

        // Update the awareness state with the new cursor position
        this.yjsAwareness.setLocalStateField('selection', textSelection);
    }
}
