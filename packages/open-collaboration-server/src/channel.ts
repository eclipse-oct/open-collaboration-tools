// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Socket } from 'socket.io';
import * as ws from 'ws';
import { Disposable, Emitter, Encoding, Event, DisposableCollection, Message } from 'open-collaboration-protocol';

export class Channel {

    private onDidCloseEmitter = new Emitter<void>();
    private onDidDisconnectEmitter = new Emitter<void>();
    private onDidReconnectEmitter = new Emitter<void>();
    private onMessageEmitter = new Emitter<Message>();

    get onClose(): Event<void> {
        return this.onDidCloseEmitter.event;
    }

    get onDisconnect(): Event<void> {
        return this.onDidDisconnectEmitter.event;
    }

    get onReconnect(): Event<void> {
        return this.onDidReconnectEmitter.event;
    }

    get transport(): TransportChannel | undefined {
        return this._transport;
    }

    set transport(transport: TransportChannel | undefined) {
        this.toDispose.dispose();
        this._transport = transport;
        if (transport) {
            this.toDispose.push(transport.onClose(() => {
                this.onDidDisconnectEmitter.fire();
                this._transport = undefined;
            }));
            this.toDispose.push(transport.onMessage(message => {
                this.onMessageEmitter.fire(message);
            }));
            this.onDidReconnectEmitter.fire();
            for (const message of this.buffer) {
                transport.sendMessage(message);
            }
            this.buffer = [];
        }
    }

    private _transport?: TransportChannel;
    // Buffer to store messages that couldn't be sent yet due to a disconnect
    private buffer: Message[] = [];
    private toDispose = new DisposableCollection();
    private closeTimeout: NodeJS.Timeout | undefined;

    constructor(transport: TransportChannel) {
        this._transport = transport;
        this.toDispose.push(transport.onClose(() => {
            this.onDidDisconnectEmitter.fire();
            this._transport = undefined;
        }));
        this.toDispose.push(transport.onMessage(message => {
            this.onMessageEmitter.fire(message);
        }));
        this.onDisconnect(() => {
            this.closeTimeout = setTimeout(() => {
                this.close();
            }, 30_000);
        });
        this.onReconnect(() => {
            if (this.closeTimeout) {
                clearTimeout(this.closeTimeout);
                this.closeTimeout = undefined;
            }
        });
    }

    get onMessage(): Event<Message> {
        return this.onMessageEmitter.event;
    }

    sendMessage(message: Message): void {
        if (this._transport) {
            this._transport.sendMessage(message);
        } else {
            this.buffer.push(message);
        }
    }

    close(): void {
        this.toDispose.dispose();
        this.onDidCloseEmitter.fire();
        this.onDidCloseEmitter.dispose();
        this.onDidDisconnectEmitter.dispose();
        this.onDidReconnectEmitter.dispose();
        this.transport?.close();
    }

}

export interface TransportChannel {
    onMessage(cb: (message: Message) => void): Disposable;
    sendMessage(message: Message): void;
    close(): void;
    onClose: Event<void>;
}

export class WebSocketChannel implements TransportChannel {
    private onDidCloseEmitter = new Emitter<void>();

    get onClose(): Event<void> {
        return this.onDidCloseEmitter.event;
    }

    private _socket: ws.WebSocket;

    constructor(socket: ws.WebSocket) {
        this._socket = socket;
        this._socket.onclose = () => {
            this.onDidCloseEmitter.fire();
        };
    }

    onMessage(cb: (message: Message) => void): Disposable {
        const decode = (message: ArrayBuffer) => {
            const data = Encoding.decode(new Uint8Array(message)) as Message;
            cb(data);
        };
        this._socket.on('message', decode);
        return Disposable.create(() => {
            this._socket.off('message', decode);
        });
    }

    sendMessage(message: Message): void {
        const buffer = Encoding.encode(message);
        this._socket.send(buffer);
    }

    close(): void {
        this.onDidCloseEmitter.dispose();
        this._socket.close();
    }

}

export class SocketIoChannel implements TransportChannel {

    private onDidCloseEmitter = new Emitter<void>();

    get onClose(): Event<void> {
        return this.onDidCloseEmitter.event;
    }

    private _socket: Socket;

    constructor(socket: Socket) {
        this._socket = socket;
        this._socket.on('disconnect', () => {
            this.onDidCloseEmitter.fire();
        });
    }

    onMessage(cb: (message: Message) => void): Disposable {
        const decode = (message: ArrayBuffer) => {
            try {
                const data = Encoding.decode(new Uint8Array(message)) as Message;
                cb(data);
            } catch(e) {
                console.error(e);
            }
        };
        this._socket.on('message', decode);
        return Disposable.create(() => {
            this._socket.off('message', decode);
        });
    }

    sendMessage(message: Message): void {
        const buffer = Encoding.encode(message);
        this._socket.send(buffer);
    }

    close(): void {
        this.onDidCloseEmitter.dispose();
        this._socket.disconnect(true);
    }
}
