// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

export interface JoinRoomUri {
    readonly path: string;
    readonly query: string;
}

export function getJoinRoomId(uri: JoinRoomUri): string | undefined {
    if (uri.path !== '/join') {
        return undefined;
    }
    const roomId = new URLSearchParams(uri.query).get('room');
    return roomId || undefined;
}
