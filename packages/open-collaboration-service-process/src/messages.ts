// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';
import { Encoding } from 'open-collaboration-protocol';
import { NotificationType, NotificationType2, NotificationType3, RequestType } from 'vscode-jsonrpc';

export function isOCPMessage(message: unknown): message is OCPMessage {
    return types.isObject<OCPMessage>(message) && types.isString(message.method) && types.isArray(message.params);
}

export interface OCPMessage {
    method: string
    params: unknown[]
    target?: string
}

// ***************************** generic messages *****************************
// all params can be either msgpack encoded base64 strings of OCPMessages or just directly OCPMessages
export const OCPRequest = new RequestType<string | OCPMessage, any, string>('request');
export const OCPNotification = new NotificationType<string | OCPMessage>('notification');
export const OCPBroadCast = new NotificationType<string | OCPMessage>('broadcast');

export function fromEncodedOCPMessage(encoded: string): OCPMessage {
    return Encoding.decode(Uint8Array.from(Buffer.from(encoded, 'base64'))) as OCPMessage;
}

export function toEncodedOCPMessage(message: OCPMessage): string {
    return Buffer.from(Encoding.encode(message)).toString('base64');
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

/**
 * resp params: [token]
 */
export const LoginRequest = new RequestType<void, [string], void>(ToServiceMessages.LOGIN);

/**
 * params: [roomId]
 * resp params: [roomToken, roomId]
 */

export const JoinRoomRequest = new RequestType<string, [string, string], void>(ToServiceMessages.JOIN_ROOM);

/**
 * params: [workspace]
 * resp params: [roomId, roomToken]
 */

export const CreateRoomRequest = new RequestType<types.Workspace, [string, string], void>(ToServiceMessages.CREATE_ROOM);

export const CloseSessionRequest = new RequestType<void, void, void>(ToServiceMessages.CLOSE_SESSION);

// YJS Awareness

export interface TextDocumentInsert {
    startOffset: number,
    endOffset?: number,
    text: string
}

export interface ClientTextSelection {
    start: number,
    end: number,
    isReversed: boolean
}

/**
 * params: [type, documentUri, text]
 * Todo: add more types for other awarness object types
 */
export const OpenDocument = new NotificationType3<string, string, string>(ToServiceMessages.OPEN_DOCUMENT);

/**
 * params: [documentUri, selections]
 */
export const UpdateTextSelection = new NotificationType2<string, ClientTextSelection[]>(ToServiceMessages.UPDATE_TEXT_SELECTION);

/**
 * params: [documentUri, changes]
 * Todo: add more types for other awarness object types
 */
export const UpdateDocumentContent = new NotificationType2<string, TextDocumentInsert[]>(ToServiceMessages.UPDATE_DOCUMENT_CONTENT);

// ***************************** From service process ********************************

/**
 * A request to the application to open the provided URL
 * params: [url]
 */

export const OpenUrl = new NotificationType<[string]>('onOpenUrl');

/**
 * A notification to the application when a session has been joined or created
 * params: [init data of the session]
 */
export const OnInitNotification = new NotificationType<[types.InitData]>('init');

/**
 * A request to the application to allow a user to join the current session
 * params: [user]
 * resp params: [join accepted]
 */
export const JoinSessionRequest = new RequestType<[types.User], [boolean], void>(ToServiceMessages.JOIN_ROOM);

/**
 * params: [error message, stack trace]
 */
export const InternalError = new NotificationType<[string, string?]>('error');

