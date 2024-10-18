// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

// ***************************** To service daeomon *****************************
export type ToDaemonMessage = LoginRequest
| JoinRoomRequest
| CreateRoomRequest
| LeaveSessionRequest
| SendRequest
| SendResponse
| SendNotification
| SendBroadcast

export interface LoginRequest {
    kind: 'login'
}

export interface JoinRoomRequest {
    kind: 'join-room',
    room: string
}

export interface CreateRoomRequest {
    kind: 'create-room',
}

export interface LeaveSessionRequest {
    kind: 'leave-session'
}

interface GenericMessage {
    type: string
    parameters: unknown[]
}
export interface SendRequest {
    kind: 'send-request',
    request: GenericMessage
    id?: number
}

export interface SendResponse {
    kind: 'send-response',
    response: GenericMessage
    id: number
}

export interface SendNotification {
    kind: 'send-notification',
    notification: GenericMessage
}

export interface SendBroadcast {
    kind: 'send-broadcast',
    broadcast: GenericMessage
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
    kind: 'update-text-selection',
    documentUri: string
    selections: Selection[];
}

export interface UpdateDocument {
    kind: 'update-document',
    documentUri: string
    changes: any // TODO add change type
}

// ***************************** From service daemon ********************************

export type FromDaeomonMessage = InternalError
| OpenUrl
| LoginResponse
| SessionCreated
| OnRequest
| OnNotification
| OnBroadcast

/**
 * a request to the application to open the provided url somehow
 */
export interface OpenUrl {
    kind: 'open-url',
    url: string
}

export interface LoginResponse {
    kind: 'login',
    authToken: string
}

/**
 * sent when joining or creating a room
 */
export interface SessionCreated {
    kind: 'session',
    info: {
        roomToken: string
        roomId: string
    }
}

export interface OnRequest {
    kind: 'on-request',
    id?: number,
    request: unknown
}

export interface OnNotification {
    kind: 'on-notification',
    notification: unknown
}

export interface OnBroadcast {
    kind: 'on-broadcast',
    broadcast: unknown
}

export interface InternalError {
    kind: 'error',
    message: string
}

// fs
// editor
// peer
// sync
// room