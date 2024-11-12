// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as types from 'open-collaboration-protocol';

export type DaemonMessage = Request | Response | Notification | Broadcast

export function isOCPMessage(message: unknown): message is OCPMessage {
    return types.isObject<OCPMessage>(message) && types.isString(message.method) && types.isArray(message.parameters);
}

export interface OCPMessage {
    method: string
    parameters: unknown[]
}

export type ServiceRequests = LoginRequest | JoinRoomRequest | CreateRoomRequest | CloseSessionRequest
export type ClientRequests = JoinRequest

export interface Request {
    kind: 'request',
    content: OCPMessage | ServiceRequests | JoinRequest
    id: number // set by message handler
}

export type ServiceResponse = LoginResponse | SessionCreatedResponse
export type ClientResponse = JoinRequestResponse

export interface Response {
    kind: 'response',
    content: OCPMessage | ServiceResponse | ClientResponse
    id: number
}

export type ClientNotifications = OpenUrl | InternalError

export interface Notification {
    kind: 'notification',
    content: OCPMessage | ClientNotifications
}

export interface Broadcast {
    kind: 'broadcast',
    content: OCPMessage
}

// ***************************** To service daeomon *****************************

export interface LoginRequest {
    method: 'login'
}

export interface JoinRoomRequest {
    method: 'join-room',
    room: string
}

export interface JoinRequestResponse {
    method: 'join-request-response',
    accepted: boolean
}

export interface CreateRoomRequest {
    method: 'create-room',
    workspace: types.Workspace
}

export interface CloseSessionRequest {
    method: 'close-session'
}

// awarenss update

export interface Position {
    line: number
    character: number
}
export interface Selection {
    start: Position
    end: Position
}

// YJS Awareness

export interface UpdateTextSelection {
    method: 'update-text-selection',
    documentUri: string
    selections: Selection[];
}

export interface UpdateDocument {
    method: 'update-document',
    documentUri: string
    changes: any // TODO add change type
}

// ***************************** From service daemon ********************************

/**
 * A request to the application to open the provided URL
 */
export interface OpenUrl {
    method: 'open-url',
    url: string
}

export interface LoginResponse {
    authToken: string
}

/**
 * A notification when joining or creating a room was successful
 */
export interface SessionCreatedResponse {
    roomToken: string
    roomId: string
}

/**
 * A request to the application to allow a user to join the current session
 * expected return: {accepted: boolean, id: id of request}
 */
export interface JoinRequest {
    method: 'join-request',
    user: types.User
}

export interface InternalError {
    method: 'error',
    message: string
}
