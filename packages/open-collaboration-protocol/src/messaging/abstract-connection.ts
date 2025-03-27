// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as msg from './messages';
import { MessageTransport } from '../transport/transport';
import { Emitter, Event } from '../utils/event';
import { Deferred } from '../utils/promise';
import { Encryption } from './encryption';
import { Encoding } from './encoding';

export type Handler<P extends unknown[], R = void> = (origin: string, ...parameters: P) => (R | Promise<R>);
export type ErrorHandler = (message: string) => void;

export interface BroadcastConnection {
    onRequest(type: string, handler: Handler<any[], any>): void;
    onRequest<P extends unknown[], R>(type: msg.RequestType<P, R>, handler: Handler<P, R>): void;
    onNotification(type: string, handler: Handler<any[]>): void;
    onNotification<P extends unknown[]>(type: msg.NotificationType<P>, handler: Handler<P>): void;
    onBroadcast(type: string, handler: Handler<any[]>): void;
    onBroadcast<P extends unknown[]>(type: msg.BroadcastType<P>, handler: Handler<P>): void;
    onError(handler: ErrorHandler): void;
    sendRequest(type: string, ...parameters: any[]): Promise<any>;
    sendRequest<P extends unknown[], R>(type: msg.RequestType<P, R>, ...parameters: P): Promise<R>;
    sendNotification(type: string, ...parameters: any[]): void;
    sendNotification<P extends unknown[]>(type: msg.NotificationType<P>, ...parameters: P): void;
    sendBroadcast(type: string, ...parameters: any[]): void;
    sendBroadcast<P extends unknown[]>(type: msg.BroadcastType<P>, ...parameters: P): void;
    dispose(): void;
    onDisconnect: Event<void>;
    onReconnect: Event<void>;
    onConnectionError: Event<string>;
}

export interface RelayedRequest {
    id: string | number;
    response: Deferred<any>
    dispose(): void;
}

export interface AbstractBroadcastConnectionOptions {
    privateKey: string;
    transport: MessageTransport;
}

export abstract class AbstractBroadcastConnection implements BroadcastConnection {

    protected messageHandlers = new Map<string, Handler<any[], any>>();
    protected onErrorEmitter = new Emitter<string>();
    protected onDisconnectEmitter = new Emitter<void>();
    protected onConnectionErrorEmitter = new Emitter<string>();
    protected onReconnectEmitter = new Emitter<void>();

    get onError(): Event<string> {
        return this.onErrorEmitter.event;
    }

    get onDisconnect(): Event<void> {
        return this.onDisconnectEmitter.event;
    }

    get onReconnect(): Event<void> {
        return this.onReconnectEmitter.event;
    }

    get onConnectionError(): Event<string> {
        return this.onConnectionErrorEmitter.event;
    }

    protected requestMap = new Map<string | number, RelayedRequest>();
    protected requestId = 1;
    protected symKey = Encryption.generateSymKey();
    protected encryptionKeyCache: Record<string, string> = {};
    protected decryptionKeyCache: Record<string, string> = {};
    protected maxCacheSize = 50;
    protected _ready = new Deferred();

    constructor(readonly options: AbstractBroadcastConnectionOptions) {
        options.transport.read(data => this.handleMessage(new Uint8Array(data)));
        options.transport.onDisconnect(() => this.dispose());
        options.transport.onError(message => {
            this.onConnectionErrorEmitter.fire(message);
            this.dispose();
        });
        options.transport.onReconnect(() => this.onReconnectEmitter.fire());
    }

    dispose(): void {
        this.onDisconnectEmitter.fire();
        this.onDisconnectEmitter.dispose();
        this.onErrorEmitter.dispose();
        this.messageHandlers.clear();
        this.options.transport.dispose();
    }

    protected ready(): void {
        this._ready.resolve();
    }

    /**
     * Cleanup the encryption and decryption key caches if they exceed the maximum cache size.
     * This is to prevent memory leaks in case the cache grows due to symmetric key swapping
     * or many peers joining/leaving a room.
     */
    protected cleanupCaches(): void {
        // Determine the maximum size of the cache based on the number of available peers/keys
        const maxSize = this.getPublicKeysLength() + this.maxCacheSize;
        if (Object.keys(this.encryptionKeyCache).length > maxSize) {
            this.encryptionKeyCache = {};
        }
        if (Object.keys(this.decryptionKeyCache).length > maxSize) {
            this.decryptionKeyCache = {};
        }
    }

    protected async handleMessage(data: Uint8Array): Promise<void> {
        this.cleanupCaches();
        let message: unknown;
        try {
            message = Encoding.decode(data);
        } catch (err) {
            console.error('Decoding message error', err);
            return;
        }
        if (msg.ResponseMessage.isAny(message)) {
            const request = this.requestMap.get(message.id);
            try {
                let response: msg.ResponseMessage;
                if (msg.ResponseMessage.isEncrypted(message)) {
                    response = await Encryption.decrypt(message, {
                        privateKey: this.options.privateKey,
                        cache: this.decryptionKeyCache
                    });
                } else if (msg.ResponseMessage.is(message)) {
                    response = message;
                } else {
                    console.error('Received invalid response message');
                    return;
                }
                if (request) {
                    request.response.resolve(response.content.response);
                }
            } catch (err) {
                console.error('Failed to handle response message', err);
                request?.response.reject(err);
            }
        } else if (msg.ResponseErrorMessage.isAny(message)) {
            const request = this.requestMap.get(message.id);
            try {
                let response: msg.ResponseErrorMessage;
                if (msg.ResponseErrorMessage.isEncrypted(message)) {
                    response = await Encryption.decrypt(message, {
                        privateKey: this.options.privateKey,
                        cache: this.decryptionKeyCache
                    });
                } else if (msg.ResponseErrorMessage.is(message)) {
                    response = message;
                } else {
                    console.error('Received invalid response error message');
                    return;
                }
                if (request) {
                    request.response.reject(new Error(response.content.message));
                }
            } catch (err) {
                console.error('Failed to handle response error message', err);
                request?.response.reject(err);
            }
        } else if (msg.RequestMessage.isAny(message)) {
            try {
                let decrypted: msg.RequestMessage;
                if (msg.RequestMessage.isEncrypted(message)) {
                    decrypted = await Encryption.decrypt(message, {
                        privateKey: this.options.privateKey,
                        cache: this.decryptionKeyCache
                    });
                } else if (msg.RequestMessage.is(message)) {
                    decrypted = message;
                } else {
                    console.error('Received invalid request message');
                    return;
                }
                const handler = this.messageHandlers.get(decrypted.content.method);
                if (!handler) {
                    console.error(`No handler registered for ${decrypted.kind} method ${decrypted.content.method}.`);
                    return;
                }
                await this._ready.promise;
                let response: msg.ResponseMessage | msg.ResponseErrorMessage;

                try {
                    const result = await handler(decrypted.origin, ...(decrypted.content.params ?? []));
                    response = msg.ResponseMessage.create(decrypted.id, result);
                } catch (error) {
                    response = msg.ResponseErrorMessage.create(decrypted.id, String(error));
                }

                if (decrypted.origin === '') {
                    // Write server responses as they are, without encryption
                    await this.write(response);
                } else {
                    // Encrypt responses to other peers
                    const publicKey = this.getPublicKey(decrypted.origin);
                    const encryptedResponseMessage = await Encryption.encrypt(response, {
                        symmetricKey: this.symKey,
                        cache: this.encryptionKeyCache
                    }, publicKey);
                    await this.write(encryptedResponseMessage);
                }

            } catch (err) {
                console.error('Failed to handle request message', err);
            }
        } else if (msg.BroadcastMessage.isAny(message) || msg.NotificationMessage.isAny(message)) {
            try {
                let decrypted: msg.BroadcastMessage | msg.NotificationMessage;
                if (msg.NotificationMessage.isEncrypted(message) || msg.BroadcastMessage.isEncrypted(message)) {
                    decrypted = await Encryption.decrypt(message, {
                        privateKey: this.options.privateKey,
                        cache: this.decryptionKeyCache
                    });
                } else if (msg.NotificationMessage.is(message) || msg.BroadcastMessage.is(message)){
                    decrypted = message;
                } else {
                    console.error(`Received invalid ${message.kind} message`);
                    return;
                }
                const handler = this.messageHandlers.get(decrypted.content.method);
                if (!handler) {
                    console.error(`No handler registered for ${message.kind} method ${decrypted.content.method}.`);
                    return;
                }
                handler(message.origin, ...(decrypted.content.params ?? []));
            } catch (err) {
                console.error(`Failed to handle ${message.kind} message`, err);
            }
        } else if (msg.ErrorMessage.isAny(message)) {
            try {
                let decrypted: msg.ErrorMessage;
                if (msg.ErrorMessage.isBinary(message)) {
                    decrypted = await Encryption.decrypt(message, {
                        privateKey: this.options.privateKey,
                        cache: this.decryptionKeyCache
                    });
                } else if (msg.ErrorMessage.is(message)) {
                    decrypted = message;
                } else {
                    console.error('Received invalid error message');
                    return;
                }
                this.onErrorEmitter.fire(decrypted.content.message);
            } catch (err) {
                console.error('Failed to handle error message', err);
            }
        }
    }

    protected abstract getPublicKey(origin: string | undefined): Encryption.AsymmetricKey;
    protected abstract getPublicKeys(): Encryption.AsymmetricKey[];
    protected abstract getPublicKeysLength(): number;

    private async write(message: msg.Message): Promise<void> {
        await this.options.transport.write(Encoding.encode(message));
    }

    onRequest(type: string, handler: Handler<any[], any>): void;
    onRequest<P extends unknown[], R>(type: msg.RequestType<P, R> | string, handler: Handler<P, R>): void;
    onRequest(type: msg.RequestType<any[], any> | string, handler: Handler<any[], any>): void {
        const method = typeof type === 'string' ? type : type.method;
        this.messageHandlers.set(method, handler);
    }

    onNotification(type: string, handler: Handler<any[]>): void
    onNotification<P extends unknown[]>(type: msg.NotificationType<P> | string, handler: Handler<P>): void
    onNotification(type: msg.NotificationType<any[]> | string, handler: Handler<any[]>): void {
        const method = typeof type === 'string' ? type : type.method;
        this.messageHandlers.set(method, handler);
    }

    onBroadcast(type: msg.BroadcastType<any[]> | string, handler: Handler<any[]>): void;
    onBroadcast(type: msg.BroadcastType<any[]> | string, handler: Handler<any[]>): void;
    onBroadcast(type: msg.BroadcastType<any[]> | string, handler: Handler<any[]>): void {
        const method = typeof type === 'string' ? type : type.method;
        this.messageHandlers.set(method, handler);
    }

    sendRequest(type: string, target: msg.MessageTarget, ...parameters: any[]): Promise<any>;
    sendRequest<P extends unknown[], R>(type: msg.RequestType<P, R> | string, target: msg.MessageTarget, ...parameters: P): Promise<R>;
    async sendRequest(type: msg.RequestType<any, any> | string, target: msg.MessageTarget, ...parameters: any[]): Promise<any> {
        await this._ready.promise;
        const id = this.requestId++;
        const deferred = new Deferred<any>();
        const dispose = () => {
            this.requestMap.delete(id);
            clearTimeout(timeout);
            deferred.reject(new Error('Request timed out'));
        };
        const timeout = setTimeout(dispose, 60_000); // Timeout after one minute
        const relayedMessage: RelayedRequest = {
            id,
            response: deferred,
            dispose
        };
        this.requestMap.set(id, relayedMessage);
        const message = msg.RequestMessage.create(type, id, '', target, parameters);
        if (target === '') {
            await this.write(message);
        } else {
            const encryptedMessage = await Encryption.encrypt(message, {
                symmetricKey: this.symKey,
                cache: this.encryptionKeyCache
            }, this.getPublicKey(target));
            await this.write(encryptedMessage);
        }
        return deferred.promise;
    }

    sendNotification(type: string, target: msg.MessageTarget, ...parameters: any[]): Promise<void>;
    sendNotification<P extends unknown[]>(type: msg.NotificationType<P>, target: msg.MessageTarget, ...parameters: P): Promise<void>;
    async sendNotification(type: msg.NotificationType<any> | string, target: msg.MessageTarget, ...parameters: any[]): Promise<void> {
        await this._ready.promise;
        const message = msg.NotificationMessage.create(type, '', target, parameters);
        if (target === '') {
            await this.write(message);
        } else {
            const encryptedMessage = await Encryption.encrypt(message, {
                symmetricKey: this.symKey,
                cache: this.encryptionKeyCache
            }, this.getPublicKey(target));
            await this.write(encryptedMessage);
        }
    }

    sendBroadcast(type: string, ...parameters: any[]): Promise<void>;
    sendBroadcast<P extends unknown[]>(type: msg.BroadcastType<P>, ...parameters: P): Promise<void>;
    async sendBroadcast(type: msg.BroadcastType<any> | string, ...parameters: any[]): Promise<void> {
        await this._ready.promise;
        const message = msg.BroadcastMessage.create(type, '', parameters);
        const publicKeys = this.getPublicKeys();
        if (publicKeys.length > 0) {
            // Don't actually send the broadcast if there are no other peers
            // Encryption will fail if we don't provide at least one public key
            const encryptedMessage = await Encryption.encrypt(message, {
                symmetricKey: this.symKey,
                cache: this.encryptionKeyCache
            },  ...publicKeys);
            await this.write(encryptedMessage);
        }
    }
}
