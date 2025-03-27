// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Event } from '../utils/event';

export type ConnectionWriter = (data: ArrayBufferLike) => Promise<void>;
export type ConnectionReader = (cb: (data: ArrayBufferLike) => void) => void;

export interface MessageTransportProvider {
    readonly id: string;
    createTransport(url: string, headers: Record<string, string>): MessageTransport;
}

export interface MessageTransport {
    readonly id: string;
    write: ConnectionWriter;
    read: ConnectionReader;
    dispose(): void;
    onReconnect: Event<void>;
    onDisconnect: Event<void>;
    onError: Event<string>;
}
