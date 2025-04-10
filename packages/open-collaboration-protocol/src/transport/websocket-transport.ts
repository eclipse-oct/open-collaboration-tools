// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Emitter, Event } from '../utils/event.js';
import { Deferred } from '../utils/promise.js';
import { MessageTransport, MessageTransportProvider } from './transport.js';

export interface WebSocketTransportProvider extends MessageTransportProvider {
    Constructor: typeof WebSocket;
}

export const WebSocketTransportProvider: WebSocketTransportProvider = {
    id: 'websocket',
    createTransport: (url, headers) => {
        if (url.startsWith('https')) {
            url = url.replace('https', 'wss');
        } else if (url.startsWith('http')) {
            url = url.replace('http', 'ws');
        }
        if (url.endsWith('/')) {
            url = url.slice(0, -1);
        }
        const query = Object.entries(headers).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
        const socket = new WebSocketTransportProvider.Constructor(url + '/websocket' + (query ? '?' + query : ''));
        socket.binaryType = 'arraybuffer';
        const transport = new WebSocketTransport(socket);
        return transport;
    },
    Constructor: typeof WebSocket === 'undefined' ? undefined! : WebSocket
};

export class WebSocketTransport implements MessageTransport {

    readonly id = 'websocket';

    private onDisconnectEmitter = new Emitter<void>();
    private onErrorEmitter = new Emitter<string>();
    private ready = new Deferred();

    get onReconnect(): Event<void> {
        return Event.None;
    }

    get onDisconnect(): Event<void> {
        return this.onDisconnectEmitter.event;
    }

    get onError(): Event<string> {
        return this.onErrorEmitter.event;
    }

    constructor(protected socket: WebSocket) {
        this.socket.onclose = () => this.onDisconnectEmitter.fire();
        this.socket.onerror = () => this.onErrorEmitter.fire('Websocket connection closed unexpectedly.');
        this.socket.onopen = () => this.ready.resolve();
    }

    async write(data: Uint8Array): Promise<void> {
        await this.ready.promise.then(() => this.socket.send(data));
    }

    read(cb: (data: Uint8Array) => void): void {
        this.socket.onmessage = event => cb(event.data);
    }

    dispose(): void {
        this.onDisconnectEmitter.dispose();
        this.socket.close();
    }
}
