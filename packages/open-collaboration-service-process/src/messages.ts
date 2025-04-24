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

export function toEncodedOCPMessage(message: unknown): string {
    return Buffer.from(Encoding.encode(message)).toString('base64');
}

// ***************************** To service process *****************************

export namespace ToServiceMessages {
    export const LOGIN = 'login';
    export const JOIN_ROOM = 'room/joinRoom';
    export const JOIN_SESSION_REQUEST = 'room/joinSessionRequest';
    export const CREATE_ROOM = 'room/createRoom';
    export const CLOSE_SESSION = 'room/closeSession';
    export const OPEN_DOCUMENT = 'awareness/openDocument';
    export const GET_DOCUMENT_CONTENT = 'awareness/getDocumentContent';
    export const UPDATE_TEXT_SELECTION = 'awareness/updateTextSelection';
    export const UPDATE_DOCUMENT_CONTENT = 'awareness/updateDocument';
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

export const CloseSessionRequest = new RequestType<void, void, void>(ToServiceMessages.CLOSE_SESSION);

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
 * params: [type, documentUri, text]
 * Todo: add more types for other awarness object types
 */
export const OpenDocument = new NotificationType3<string, string, string>(ToServiceMessages.OPEN_DOCUMENT);

/**
 * params: [documentPath]
 * resp params: [documentContent as message pack encoded base64 string of types.FileContent]
 */
export const GetDocumentContent = new RequestType<string, BinaryResponse, void>(ToServiceMessages.GET_DOCUMENT_CONTENT);

/**
 * params: [documentPath, selections]
 */
export const UpdateTextSelection = new NotificationType2<string, ClientTextSelection[]>(ToServiceMessages.UPDATE_TEXT_SELECTION);

/**
 * params: [documentPath, changes]
 * Todo: add more types for other awarness object types
 */
export const UpdateDocumentContent = new NotificationType2<string, TextDocumentInsert[]>(ToServiceMessages.UPDATE_DOCUMENT_CONTENT);

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
 * params : [documentPath, peerId]
 */
export const EditorOpenedNotification = new NotificationType2<string, string>('editorOpened');

/**
 * A request to the application to allow a user to join the current session
 * params: [user]
 * resp params: [join accepted]
 */
export const JoinSessionRequest = new RequestType<types.User, boolean, void>(ToServiceMessages.JOIN_SESSION_REQUEST);

/**
 * params: [error message, stack trace]
 */
export const InternalError = new NotificationType<{message: string, stack?: string}>('error');

export namespace BinaryResponse {
    export function is(message: unknown): message is BinaryResponse {
        return types.isObject<BinaryResponse>(message) && types.isString(message.data) && message.type === 'binaryResponse';
    }
}

export interface BinaryResponse {
    type: 'binaryResponse'
    method?: string
    data: string
}
