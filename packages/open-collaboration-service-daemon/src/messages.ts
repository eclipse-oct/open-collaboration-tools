// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

export type ToDaemonMessage = LoginRequest | JoinRoomRequest | CreateRoomRequest | LeaveSessionRequest

// To service daeomon
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
// From service daemon

export type FromDaeomonMessage = InternalError | OpenUrl | LoginResponse | SessionCreated

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
    }
}

export interface InternalError {
    kind: 'error',
    message: string
}
