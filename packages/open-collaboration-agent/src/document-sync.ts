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

/**
 * Source category that resolved the active document, used for diagnostic
 * logging in {@link DocumentSync.waitForActiveDocument}.
 *  - `'sender'`     — the chat sender's awareness state had a selection.
 *  - `'host'`       — the host peer's awareness state had a selection.
 *  - `'peer'`       — some other peer's awareness state had a selection.
 *  - `'yjs-fallback'` — no awareness selection was available, but a Y.Text in
 *                      the local Yjs share store looked like a usable document.
 *  - `'none'`       — no document could be resolved.
 */
type DocumentResolutionSource = 'sender' | 'host' | 'peer' | 'yjs-fallback' | 'none';

export interface IDocumentSync {
    applyEdit(documentPath: string, text: string, offset: number, replacedLength: number): void;
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
                this.tryFollowPeerDocument();
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
            this.tryFollowPeerDocument();
        });
    }

    getConnection(): ProtocolBroadcastConnection {
        return this.connection;
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
     * Actively resolves an active document from awareness states, calling
     * followDocument if needed, and waits for the Yjs content sync.
     *
     * Resolution priority:
     *   1. The peer matching `preferredPeerId` (typically the chat sender).
     *   2. The host peer.
     *   3. Any other peer with a selection (most recently updated wins).
     *   4. As a last-resort fallback, a non-empty `Y.Text` already present in
     *      the shared Yjs store whose key looks like a workspace path.
     *
     * This addresses the race condition where:
     * - The awareness `change` event fires before `hostId` is set (skipped), AND
     * - `peer.onInit` fires before awareness states arrive (nothing to follow),
     * resulting in `followDocument` never being called.
     */
    async waitForActiveDocument(timeoutMs = 5000, preferredPeerId?: string): Promise<{ path: string; content: string } | undefined> {
        const pollIntervalMs = 100;
        const deadline = Date.now() + timeoutMs;
        let lastSource: DocumentResolutionSource = 'none';
        while (Date.now() < deadline) {
            // Actively try to discover + follow a document from awareness
            if (!this.activeDocumentPath) {
                lastSource = this.tryFollowPeerDocument(preferredPeerId);
            }
            if (this.activeDocumentPath) {
                const content = this.activeDocument?.toString();
                if (content && content.length > 0) {
                    return { path: this.activeDocumentPath, content };
                }
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        // Polling exhausted without resolving the document. Try the Yjs share-store
        // fallback before giving up: in some reconnect scenarios no peer has
        // re-broadcast a selection yet, but a previously synced Y.Text is still
        // available locally and is good enough for the agent to act on.
        if (!this.activeDocumentPath) {
            const fallbackPath = this.tryYjsShareFallback();
            if (fallbackPath) {
                this.followDocument(fallbackPath);
                lastSource = 'yjs-fallback';
                const content = this.activeDocument?.toString();
                if (content && content.length > 0) {
                    console.error(
                        `[DocumentSync] waitForActiveDocument resolved via yjs-fallback after ${timeoutMs}ms ` +
                        `(path="${fallbackPath}")`
                    );
                    return { path: fallbackPath, content };
                }
            }
        }

        // Final summary log: which sources were considered and what was selected.
        const states = this.yjsAwareness.getStates() as Map<number, ClientAwareness>;
        const peerSummary = Array.from(states.values())
            .map(state => `${state.peer ?? '?'}${state.selection?.path ? `:"${state.selection.path}"` : ':<no-selection>'}`)
            .join(', ');
        console.error(
            `[DocumentSync] waitForActiveDocument timed out after ${timeoutMs}ms ` +
            `(path="${this.activeDocumentPath ?? 'none'}", hostId="${this.hostId ?? 'none'}", ` +
            `preferredPeerId="${preferredPeerId ?? 'none'}", lastSource="${lastSource}", ` +
            `awareness=[${peerSummary}])`
        );
        return undefined;
    }

    /**
     * Checks the current awareness states for a usable selection and follows the
     * referenced document. Selection is chosen with the priority:
     * preferred peer → host → any peer (most recently updated wins).
     *
     * Returns the source category that was used (or `'none'` if no selection
     * was found). This method intentionally stays silent: per-call logs were
     * very noisy when invoked from `waitForActiveDocument`'s polling loop, so
     * the caller is responsible for emitting any summary log.
     */
    private tryFollowPeerDocument(preferredPeerId?: string): DocumentResolutionSource {
        if (!this.hostId) {
            return 'none';
        }
        const states = this.yjsAwareness.getStates() as Map<number, ClientAwareness>;

        if (preferredPeerId) {
            for (const state of states.values()) {
                if (state.peer === preferredPeerId && state.selection?.path) {
                    this.followDocument(state.selection.path);
                    return 'sender';
                }
            }
        }

        for (const state of states.values()) {
            if (state.peer === this.hostId && state.selection?.path) {
                this.followDocument(state.selection.path);
                return 'host';
            }
        }

        // Any peer: prefer the most recently updated awareness entry.
        const meta = this.yjsAwareness.meta as Map<number, { clock: number; lastUpdated: number }>;
        let bestPath: string | undefined;
        let bestUpdated = -1;
        for (const [clientId, state] of states.entries()) {
            if (state.peer && state.selection?.path) {
                const updated = meta.get(clientId)?.lastUpdated ?? 0;
                if (updated > bestUpdated) {
                    bestUpdated = updated;
                    bestPath = state.selection.path;
                }
            }
        }
        if (bestPath) {
            this.followDocument(bestPath);
            return 'peer';
        }

        return 'none';
    }

    /**
     * Searches the local Yjs share store for the most recently edited
     * `Y.Text` whose key looks like a workspace-relative path (i.e. contains
     * a `/` separator). Used as the last-resort fallback in
     * `waitForActiveDocument` when no peer has published a selection.
     *
     * Recency is approximated by the maximum CRDT clock observed across the
     * Y.Text's items: clocks grow monotonically per client as edits occur,
     * so a higher max clock typically corresponds to a more-recently edited
     * document.
     */
    private tryYjsShareFallback(): string | undefined {
        let bestKey: string | undefined;
        let bestClock = -1;
        for (const [key, type] of this.yjs.share.entries()) {
            if (!(type instanceof Y.Text)) {
                continue;
            }
            if (!key.includes('/')) {
                continue;
            }
            if (type.length === 0) {
                continue;
            }
            const clock = this.maxItemClock(type);
            if (clock > bestClock) {
                bestClock = clock;
                bestKey = key;
            }
        }
        return bestKey;
    }

    private maxItemClock(text: Y.Text): number {
        let max = 0;
        // Walk the linked list of items inside the Y.Text and track the
        // largest (clock + length) seen. Internal Yjs structures are not
        // part of the public typings, so we cast through `any`.
        let item: any = (text as unknown as { _start?: unknown })._start;
        while (item) {
            const clock = item.id?.clock ?? 0;
            const length = item.length ?? 0;
            const end = clock + length;
            if (end > max) {
                max = end;
            }
            item = item.right;
        }
        return max;
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

}
