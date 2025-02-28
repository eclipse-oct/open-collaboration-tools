// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';

export type ServiceProcessMessage = Request | Response | Notification | Broadcast

export function isOCPMessage(message: unknown): message is OCPMessage {
    return types.isObject<OCPMessage>(message) && types.isString(message.method) && types.isArray(message.params);
}

export interface OCPMessage {
    method: string
    params: unknown[]
}

export interface Request {
    kind: 'request',
    content: OCPMessage
    target?: string,
    id: number // set by message handler
}

export interface Response {
    kind: 'response',
    content: OCPMessage
    id: number
}

export interface Notification {
    kind: 'notification',
    target?: string,
    content: OCPMessage
}

export interface Broadcast {
    kind: 'broadcast',
    content: OCPMessage
}

// ***************************** To service process *****************************

export namespace ToServiceMessages {
    export const LOGIN = 'login';
    export const JOIN_ROOM = 'room/joinRoom';
    export const CREATE_ROOM = 'room/createRoom';
    export const CLOSE_SESSION = 'room/closeSession';
    export const OPEN_DOCUMENT = 'awareness/openDocument';
    export const UPDATE_TEXT_SELECTION = 'awareness/updateTextSelection';
    export const UPDATE_DOCUMENT_CONTENT = 'awareness/updateDocument';
}

export interface LoginRequest extends OCPMessage {
    method: typeof ToServiceMessages.LOGIN,
}

/**
 * params: [roomId]
 */
export interface JoinRoomRequest extends OCPMessage {
    method: typeof ToServiceMessages.JOIN_ROOM,
    params: [string]
}

/**
 * params: [accepted]
 */
export interface JoinRequestResponse extends OCPMessage {
    method: typeof ToServiceMessages.JOIN_ROOM,
    params: [boolean]
}

/**
 * params: [workspace]
 */
export interface CreateRoomRequest extends OCPMessage {
    method: typeof ToServiceMessages.CREATE_ROOM,
    params: [types.Workspace]
}

export interface CloseSessionRequest extends OCPMessage {
    method: typeof ToServiceMessages.CLOSE_SESSION
}

// YJS Awareness

export interface TextDocumentInsert {
    startOffset: number,
    endOffset?: number,
    text: string
}

/**
 * params: [type, documentUri, text]
 * Todo: add more types for other awarness object types
 */
export interface OpenDocument extends OCPMessage {
    method: typeof ToServiceMessages.OPEN_DOCUMENT,
    params: [string, string, string]
}

/**
 * params: [documentUri, selections]
 */
export interface UpdateTextSelection extends OCPMessage {
    method: typeof ToServiceMessages.UPDATE_TEXT_SELECTION,
    params: [string, types.Range[]];
}

/**
 * params: [documentUri, changes]
 * Todo: add more types for other awarness object types
 */
export interface UpdateDocumentContent extends OCPMessage {
    method: typeof ToServiceMessages.UPDATE_DOCUMENT_CONTENT,
    params: [string, TextDocumentInsert[]]
}

// ***************************** From service process ********************************

/**
 * A request to the application to open the provided URL
 * params: [url]
 */
export interface OpenUrl extends OCPMessage {
    method: 'onOpenUrl',
    params: [string]
}

/**
 * params: [authToken]
 */
export interface LoginResponse extends OCPMessage {
    method: typeof ToServiceMessages.LOGIN,
    params: [string]
}

/**
 * A notification when joining or creating a room was successful
 * params: [roomToken, roomId]
 */
export interface SessionCreatedResponse {
    method: 'room/joinRoom' | 'room/createRoom',
    params: [string, string]
}

/**
 * params: [initData]
 */
export interface OnInitNotification extends OCPMessage {
    method: 'init',
    params: [types.InitData]
}

/**
 * A request to the application to allow a user to join the current session
 * params: [user]
 */
export interface JoinRequest extends OCPMessage {
    method: 'peer/onJoinRequest',
    params: [types.User]
}
/**
 * params: [message, (stack)]
 */
export interface InternalError extends OCPMessage {
    method: 'error',
    params: [string, string?]
}
