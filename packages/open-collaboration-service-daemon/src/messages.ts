// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

// To service daeomon
export type ToDaemonMessage = LoginRequest
| JoinRoomRequest
| CreateRoomRequest
| LeaveSessionRequest
| SendRequest
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
}

export interface SendNotification {
    kind: 'send-notification',
    notification: GenericMessage
}

export interface SendBroadcast {
    kind: 'send-broadcast',
    broadcast: GenericMessage
}

// From service daemon

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
