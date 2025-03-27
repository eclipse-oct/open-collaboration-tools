// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Emitter, Event, Deferred } from '../utils';
import { MessageTransport, MessageTransportProvider } from './transport';
import { io, Socket } from 'socket.io-client';

export const SocketIoTransportProvider: MessageTransportProvider = {
    id: 'socket.io',
    createTransport: (url, headers) => {
        const socket = io(url, {
            extraHeaders: headers
        });
        const transport = new SocketIoTransport(socket);
        return transport;
    }
};

export class SocketIoTransport implements MessageTransport {

    readonly id = 'socket.io';

    private onReconnectEmitter = new Emitter<void>();
    private onDisconnectEmitter = new Emitter<void>();
    private onErrorEmitter = new Emitter<string>();
    private disconnectTimeout?: NodeJS.Timeout;
    private ready = new Deferred();

    get onDisconnect(): Event<void> {
        return this.onDisconnectEmitter.event;
    }

    get onReconnect(): Event<void> {
        return this.onReconnectEmitter.event;
    }

    get onError(): Event<string> {
        return this.onErrorEmitter.event;
    }

    constructor(protected socket: Socket) {
        this.socket.on('disconnect', (_reason, _description) => {
            this.ready = new Deferred();
            // Give it 30 seconds to reconnect before firing the disconnect event
            this.disconnectTimeout = setTimeout(() => {
                this.onDisconnectEmitter.fire();
                this.disconnectTimeout = undefined;
            }, 30_000);
        });
        this.socket.io.on('reconnect', () => {
            if (this.disconnectTimeout) {
                clearTimeout(this.disconnectTimeout);
                this.disconnectTimeout = undefined;
                this.ready.resolve();
            }
            this.onReconnectEmitter.fire();
        });
        this.socket.on('error', () => this.onErrorEmitter.fire('Websocket connection closed unexpectedly.'));
        this.socket.on('connect', () => this.ready.resolve());
    }

    async write(data: Uint8Array): Promise<void> {
        await this.ready.promise.then(() => this.socket.send(data));
    }

    read(cb: (data: Uint8Array) => void): void {
        this.socket.on('message', data => cb(data));
    }

    dispose(): void {
        this.onDisconnectEmitter.dispose();
        this.socket.close();
    }
}
