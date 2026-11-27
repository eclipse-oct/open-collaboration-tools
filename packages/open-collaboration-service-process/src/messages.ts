// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';
import { Encoding } from 'open-collaboration-protocol';
import { isTypedArray } from 'util/types';
import { NotificationType, NotificationType2, RequestType, RequestType0 } from 'vscode-jsonrpc';

export function isOCPMessage(message: unknown): message is OCPMessage {
    return types.isObject<OCPMessage>(message) && types.isString(message.method) && types.isArray(message.params);
}

export interface OCPMessage {
    method: string
    params: unknown[]
    target?: string
}

// ***************************** To service process *****************************

export namespace ToServiceMessages {
    export const LOGIN = 'login';
    export const JOIN_ROOM = 'room/joinRoom';
    export const JOIN_SESSION_REQUEST = 'room/joinSessionRequest';
    export const CREATE_ROOM = 'room/createRoom';
    export const CLOSE_SESSION = 'room/closeSession';
    export const GET_DOCUMENT_CONTENT = 'awareness/getDocumentContent';
}

/**
 * resp params: [token]
 */
export const LoginRequest = new RequestType<void, string, void>(ToServiceMessages.LOGIN);

export interface SessionData {
    roomId: string,
    roomToken: string
    authToken?: string,
    workspace: types.Workspace
}

/**
 * params: [roomId]
 * resp params: [roomToken, roomId]
 */
export const JoinRoomRequest = new RequestType<string, SessionData, void>(ToServiceMessages.JOIN_ROOM);

/**
 * params: [workspace]
 * resp params: [roomId, roomToken]
 */

export const CreateRoomRequest = new RequestType<types.Workspace, SessionData, void>(ToServiceMessages.CREATE_ROOM);

// RequestType<void, ...> still declares numberOfParams = 1 (the generic "void"
// only affects typing, not arity) — vscode-jsonrpc then rejects a truly
// zero-arg request (e.g. the Java OCTService.closeSession() binding, a
// zero-arg @JsonRequest) with "defines 1 params but received none". Use
// RequestType0, which actually declares numberOfParams = 0. See TODO.md item 6.
export const CloseSessionRequest = new RequestType0<void, void>(ToServiceMessages.CLOSE_SESSION);

// YJS Awareness

export interface TextDocumentInsert {
    startOffset: number,
    endOffset?: number,
    text: string
}

export interface ClientTextSelection {
    start: number,
    end?: number,
    isReversed: boolean
    peer?: string
}

/**
 * params: [documentPath]
 * resp params: [documentContent as message pack encoded base64 string of types.FileContent]
 */
export const GetDocumentContent = new RequestType<string, BinaryData, void>(ToServiceMessages.GET_DOCUMENT_CONTENT);

// ***************************** Versioned documents *****************************
//
// A document opened with `document/open` is synchronized through versioned edits, which lets the
// service process tell whether an edit still fits the client's buffer.
// See "Document synchronization" in the Readme for the full contract.
//
// All messages take a single object parameter, sent by name. vscode-jsonrpc and lsp4j both send a
// single-parameter message that way, and vscode-jsonrpc also accepts it wrapped in an array.

export namespace DocumentMessages {
    export const OPEN = 'document/open';
    export const CLOSE = 'document/close';
    export const DID_CHANGE = 'document/didChange';
    export const DID_CHANGE_SELECTION = 'document/didChangeSelection';
    export const APPLY_EDIT = 'document/applyEdit';
    export const GET_BUFFER = 'document/getBuffer';
}

export type DocumentEol = '\n' | '\r\n';

export interface OpenTextDocumentParams {
    path: string
    /**
     * Identifies this opening of the document. The client chooses a new value for every
     * `document/open`, for example from a counter it increments with every open of any document.
     * Requests about the document carry it, so that the client can tell those meant for an
     * earlier opening of the same path apart, which may still be on their way after a reopen.
     */
    openId: number
    /** The content of the client's buffer */
    text: string
    /**
     * The version of the buffer. The client increments it by exactly one with every change it
     * reports through `document/didChange`, starting from this value.
     */
    version: number
    /**
     * The line ending the service process uses for text it inserts. Guessed from `text` if omitted.
     */
    eol?: DocumentEol
}

/**
 * Starts the versioned synchronization of a document. Opening a path that is already open replaces
 * the document, as if it was closed first.
 */
export const OpenTextDocument = new NotificationType<OpenTextDocumentParams>(DocumentMessages.OPEN);

export interface CloseTextDocumentParams {
    path: string
}

/**
 * Stops the synchronization of a document. Its pending edit, if any, is abandoned.
 */
export const CloseTextDocument = new NotificationType<CloseTextDocumentParams>(DocumentMessages.CLOSE);

export interface DidChangeTextDocumentParams {
    path: string
    /** The version of the buffer *after* the change */
    version: number
    /**
     * All changes address the buffer as it was before any of them, are sorted, and do not overlap.
     * Offsets are UTF-16 code units, the inserted text is the text as it was actually inserted.
     */
    changes: TextDocumentInsert[]
}

/**
 * Reports a change of the client's buffer, made by the user or by an applied `document/applyEdit`.
 * Must be sent as soon as the buffer changed, before any later message about the document.
 */
export const DidChangeTextDocument = new NotificationType<DidChangeTextDocumentParams>(DocumentMessages.DID_CHANGE);

export interface DidChangeTextSelectionParams {
    path: string
    /** The version of the buffer the offsets address */
    version: number
    selections: ClientTextSelection[]
}

/**
 * Reports the client's selections of a document. The offsets and the version need to be read
 * together, at a moment when every change of the buffer has been reported.
 */
export const DidChangeTextSelection = new NotificationType<DidChangeTextSelectionParams>(DocumentMessages.DID_CHANGE_SELECTION);

export interface ApplyEditParams {
    path: string
    /** The `openId` of the `document/open` the edit is meant for */
    openId: number
    /** The version of the buffer the changes address */
    baseVersion: number
    /** All changes address the buffer at `baseVersion` as it was before any of them, sorted and not overlapping */
    changes: TextDocumentInsert[]
}

export type ApplyEditResultKind = 'applied' | 'outdated' | 'notOpen';

export interface ApplyEditResult {
    result: ApplyEditResultKind
}

/**
 * Asks the client to apply an edit to its buffer. The client:
 *
 * 1. applies it only if the version of its buffer equals `baseVersion`, and then all changes at
 *    once, back to front. Otherwise it applies nothing and answers `outdated`.
 * 2. reports an applied edit as exactly one `document/didChange` with version `baseVersion + 1`,
 *    and sends it *before* it answers `applied`.
 * 3. answers `notOpen` for a path it does not have open, or whose current `openId` differs.
 *    Applying an edit meant for an earlier opening would corrupt the document.
 *
 * The client handles `document/applyEdit` and `document/getBuffer` of a document in the order it
 * received them, on the thread that changes the buffer.
 */
export const ApplyEditRequest = new RequestType<ApplyEditParams, ApplyEditResult, void>(DocumentMessages.APPLY_EDIT);

export interface GetBufferParams {
    path: string
    /** The `openId` of the `document/open` the request is meant for */
    openId: number
}

export interface DocumentBuffer {
    text: string
    version: number
}

/**
 * Asks the client for the content and version of its buffer, or `null` if it does not have the
 * document open or its current `openId` differs. Only used to recover from a client that broke the protocol or stopped answering.
 * The answer must reflect every `document/applyEdit` the client received before it.
 */
export const GetBufferRequest = new RequestType<GetBufferParams, DocumentBuffer | null, void>(DocumentMessages.GET_BUFFER);

// ***************************** From service process ********************************

/**
 * A request to the application to open the provided URL
 * the token can be used to authenticate the user
 * params: [token]
 */

export const Authentication = new NotificationType2<string, types.AuthMetadata>('authentication');

/**
 * A notification to the application when a session has been joined or created
 * params: [init data of the session]
 */
export const OnInitNotification = new NotificationType<types.InitData>('init');

/**
 * A notification to the application containing the peer information of the current user
 * this can be used to update the UI with the peer information
 * params: [peer information]
 */
export const PeerInfoNotification = new NotificationType<types.Peer>('peerInfo');

/**
 * params : [documentPath, peerId]
 */
export const EditorOpenedNotification = new NotificationType2<string, string>('editorOpened');

/**
 * The selections of other peers in a document, with offsets of the client's buffer.
 * params: [documentPath, selections]
 */
export const UpdateTextSelection = new NotificationType2<string, ClientTextSelection[]>('awareness/updateTextSelection');

/**
 * A request to the application to allow a user to join the current session
 * params: [user]
 * resp params: [join accepted]
 */
export const JoinSessionRequest = new RequestType<types.User, boolean, void>(ToServiceMessages.JOIN_SESSION_REQUEST);

export const PeerJoinedNotification = new NotificationType<types.Peer>('peerJoined');
export const PeerLeftNotification = new NotificationType<types.Peer>('peerLeft');

export const SessionClosedNotification = new NotificationType<void>('sessionClosed');

/**
 * params: [error message, stack trace]
 */
export const InternalError = new NotificationType<{message: string, stack?: string}>('error');

// ***************************** binary encoding of message parameters *****************************
// always use a BinaryData object to send binary data
export function fromBinaryMessage(encoded: string): unknown {
    return Encoding.decode(Uint8Array.from(Buffer.from(encoded, 'base64')));
}

export function toBinaryMessage(message: unknown): string {
    return Buffer.from(Encoding.encode(message)).toString('base64');
}
export namespace BinaryData {
    export function is(message: unknown): message is BinaryData {
        return types.isObject<BinaryData>(message) && types.isString(message.data) && message.type === 'binaryData';
    }

    export function shouldConvert(message: unknown): boolean {
        if (typeof message !== 'object' || message === null) {
            return false;
        }

        if(isTypedArray(message)) {
            return true;
        }

        if (Array.isArray(message)) {
            return message.some((item) => shouldConvert(item));
        }

        return Object.keys(message).some((key) => shouldConvert((message as Record<string, unknown>)[key]));
    }
}

export interface BinaryData {
    type: 'binaryData'
    data: string
}

export interface BinaryResponse extends BinaryData {
    method?: string
}
