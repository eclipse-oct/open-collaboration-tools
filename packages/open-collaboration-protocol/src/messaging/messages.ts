// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { isArray, isObject, isString } from '../utils/types.js';
import { VERSION } from '../utils/version.js';

/**
 * A collaboration message
 */
export interface Message {
    /**
     * Protocol version
     */
    version: string;
    kind: string;
    metadata: MessageMetadata;
}

export interface MessageMetadata {
    encryption: MessageEncryption;
    compression: MessageCompression;
}

export namespace MessageMetadata {
    export function is(item: unknown): item is MessageMetadata {
        return isObject<MessageMetadata>(item) && MessageEncryption.is(item.encryption) && MessageCompression.is(item.compression);
    }
}

export const DEFAULT_METADATA: MessageMetadata = {
    encryption: {
        keys: []
    },
    compression: {
        algorithm: 'none'
    }
};

export interface MessageEncryption {
    keys: MessageContentKey[];
}

export namespace MessageEncryption {
    export function is(item: unknown): item is MessageEncryption {
        return isObject<MessageEncryption>(item) && isArray(item.keys, MessageContentKey.is);
    }
}

export interface MessageCompression {
    algorithm: CompressionAlgorithm;
}

export namespace MessageCompression {
    export function is(item: unknown): item is MessageCompression {
        return isObject<MessageCompression>(item) && isString(item.algorithm);
    }
}

export interface MessageContentKey {
    target: MessageTarget;
    key: string;
    iv: string;
}

export namespace MessageContentKey {
    export function is(item: unknown): item is MessageContentKey {
        return isObject<MessageContentKey>(item) && isString(item.target) && isString(item.key) && isString(item.iv);
    }
}

export type CompressionAlgorithm = 'none' | 'gzip' | (string & {});

export interface BinaryMessage extends Message {
    content: Uint8Array;
}

export type MessageTarget = string | undefined;
export type MessageOrigin = string;
export type MessageId = number | string;

export namespace Message {
    export function is(item: unknown): item is Message {
        return isObject<Message>(item) && isString(item.version) && isString(item.kind) && MessageMetadata.is(item.metadata);
    }
    export function isEncrypted(item: Message): item is BinaryMessage {
        return (item as BinaryMessage).content instanceof Uint8Array;
    }
}

export interface AbstractErrorMessage<T> extends Message {
    kind: 'error';
    content: T
}

export interface ErrorMessageContent {
    message: string;
}

export type UnknownErrorMessage = AbstractErrorMessage<unknown>;
export type ErrorMessage = AbstractErrorMessage<ErrorMessageContent>;
export type BinaryErrorMessage = AbstractErrorMessage<Uint8Array>;

export namespace ErrorMessage {
    export function create(message: string): ErrorMessage {
        return {
            version: VERSION,
            kind: 'error',
            metadata: DEFAULT_METADATA,
            content: {
                message
            }
        };
    }
    export function isAny(message: unknown): message is UnknownErrorMessage {
        return Message.is(message) && message.kind === 'error';
    }
    export function is(message: unknown): message is ErrorMessage {
        return isAny(message) && isObject<ErrorMessageContent>(message.content) && isString(message.content.message);
    }
    export function isBinary(message: unknown): message is BinaryErrorMessage {
        return isAny(message) && Message.isEncrypted(message);
    }
}

/**
 * Request message
 */
export interface AbstractRequestMessage<T> extends Message {
    /**
     * The request id.
     */
    id: number | string;
    kind: 'request';

    /**
     * The origin peer id of the request.
     */
    origin: MessageOrigin;

    /**
     * The peer id to which the request is addressed.
     */
    target: MessageTarget;

    content: T;
}

export interface RequestMessageContent {
    /**
     * The method to be invoked.
     */
    method: string;
    /**
     * The method's params.
     */
    params?: unknown[];
}

export type UnknownRequestMessage = AbstractRequestMessage<unknown>;
export type RequestMessage = AbstractRequestMessage<RequestMessageContent>;
export type EncryptedRequestMessage = AbstractRequestMessage<Uint8Array>;

export namespace RequestMessage {
    export function create(
        signature: RequestType<any, any> | string,
        id: number | string,
        origin: MessageOrigin,
        target: MessageTarget,
        params?: any[]
    ): RequestMessage {
        return {
            version: VERSION,
            id,
            metadata: DEFAULT_METADATA,
            origin,
            target,
            kind: 'request',
            content: {
                method: typeof signature === 'string' ? signature : signature.method,
                params
            }
        };
    }
    export function isAny(message: unknown): message is UnknownRequestMessage {
        return Message.is(message) && message.kind === 'request';
    }
    export function is(message: unknown): message is RequestMessage {
        if (!isAny(message)) {
            return false;
        }
        const content = message.content;
        return isObject<RequestMessageContent>(content) && isString(content.method);
    }
    export function isEncrypted(message: unknown): message is EncryptedRequestMessage {
        return isAny(message) && Message.isEncrypted(message);
    }
}

export interface AbstractResponseMessage<T> extends Message {
    /**
     * The original request id.
     */
    id: number | string;
    kind: 'response';
    content: T;
}

export interface ResponseMessageContent {
    /**
     * The response content.
     */
    response: unknown;
}

export type UnknownResponseMessage = AbstractResponseMessage<unknown>;
export type ResponseMessage = AbstractResponseMessage<ResponseMessageContent>;
export type EncryptedResponseMessage = AbstractResponseMessage<Uint8Array>;

export namespace ResponseMessage {
    export function create(id: number | string, response: unknown): ResponseMessage {
        return {
            kind: 'response',
            version: VERSION,
            id,
            metadata: DEFAULT_METADATA,
            content: {
                response
            }
        };
    }
    export function isAny(message: unknown): message is UnknownResponseMessage {
        return Message.is(message) && message.kind === 'response';
    }
    export function is(message: unknown): message is ResponseMessage {
        return isAny(message) && isObject<ResponseMessageContent>(message.content) && 'response' in message.content;
    }
    export function isEncrypted(message: unknown): message is EncryptedResponseMessage {
        return isAny(message) && Message.isEncrypted(message);
    }
}

export interface AbstractResponseErrorMessage<T> extends Message {
    /**
     * The original request id.
     */
    id: number | string;
    kind: 'response-error';
    content: T;
}

export interface ResponseErrorMessageContent {
    message: string;
}

export type UnknownResponseErrorMessage = AbstractResponseErrorMessage<unknown>;
export type ResponseErrorMessage = AbstractResponseErrorMessage<ResponseErrorMessageContent>;
export type EncryptedResponseErrorMessage = AbstractResponseErrorMessage<Uint8Array>;

export namespace ResponseErrorMessage {
    export function create(id: number | string, message: string): ResponseErrorMessage;
    export function create(id: number | string, message: Uint8Array): EncryptedResponseErrorMessage;
    export function create(id: number | string, message: string | Uint8Array): ResponseErrorMessage | EncryptedResponseErrorMessage {
        if (typeof message === 'string') {
            return {
                kind: 'response-error',
                version: VERSION,
                metadata: DEFAULT_METADATA,
                id,
                content: {
                    message
                }
            };
        } else {
            return {
                kind: 'response-error',
                version: VERSION,
                metadata: DEFAULT_METADATA,
                id,
                content: message
            };
        }
    }
    export function isAny(message: unknown): message is UnknownResponseErrorMessage {
        return Message.is(message) && message.kind === 'response-error';
    }
    export function is(message: unknown): message is ResponseErrorMessage {
        return isAny(message) && isObject<ResponseErrorMessageContent>(message.content) && isString(message.content.message);
    }
    export function isEncrypted(message: unknown): message is EncryptedResponseErrorMessage {
        return isAny(message) && Message.isEncrypted(message);
    }
}

export interface AbstractNotificationMessage<T> extends Message {
    kind: 'notification';
    /**
     * The origin peer id of the notification.
     */
    origin: MessageOrigin;
    /**
     * The peer id to which the notification is addressed.
     */
    target: MessageTarget;
    content: T;
}

export interface NotificationMessageContent {
    /**
     * The method to be invoked.
     */
    method: string;
    /**
     * The method's params.
     */
    params?: unknown[];
}

export type UnknownNotificationMessage = AbstractNotificationMessage<unknown>;
export type NotificationMessage = AbstractNotificationMessage<NotificationMessageContent>;
export type EncryptedNotificationMessage = AbstractNotificationMessage<Uint8Array>;

export namespace NotificationMessage {
    export function create(signature: NotificationType<any> | string, origin: MessageOrigin, target: MessageTarget, params?: any[]): NotificationMessage {
        return {
            version: VERSION,
            kind: 'notification',
            metadata: DEFAULT_METADATA,
            target,
            origin,
            content: {
                method: typeof signature === 'string' ? signature : signature.method,
                params
            }
        };
    }
    export function isAny(message: unknown): message is UnknownNotificationMessage {
        return Message.is(message) && message.kind === 'notification';
    }
    export function is(message: unknown): message is NotificationMessage {
        if (!isAny(message)) {
            return false;
        }
        const content = message.content;
        return isObject<NotificationMessageContent>(content) && isString(content.method);
    }
    export function isEncrypted(message: unknown): message is EncryptedNotificationMessage {
        return isAny(message) && Message.isEncrypted(message);
    }
}

export interface AbstractBroadcastMessage<T> extends Message {
    kind: 'broadcast';
    origin: MessageOrigin;
    content: T;
}

export interface BroadcastMessageContent {
    method: string;
    params?: unknown[];
}

export type UnknownBroadcastMessage = AbstractBroadcastMessage<unknown>;
export type BroadcastMessage = AbstractBroadcastMessage<BroadcastMessageContent>;
export type EncryptedBroadcastMessage = AbstractBroadcastMessage<Uint8Array>;

export namespace BroadcastMessage {
    export function create(signature: BroadcastType<any> | string, origin: string, params?: any[]): BroadcastMessage {
        return {
            version: VERSION,
            kind: 'broadcast',
            metadata: DEFAULT_METADATA,
            origin: origin,
            content: {
                method: typeof signature === 'string' ? signature : signature.method,
                params
            }
        };
    }
    export function isAny(message: unknown): message is UnknownBroadcastMessage {
        return Message.is(message) && message.kind === 'broadcast';
    }
    export function is(message: unknown): message is BroadcastMessage {
        if (!isAny(message)) {
            return false;
        }
        const content = message.content;
        return isObject<BroadcastMessageContent>(content) && isString(content.method);
    }
    export function isEncrypted(message: unknown): message is EncryptedBroadcastMessage {
        return isAny(message) && Message.isEncrypted(message);
    }
}

export interface MessageSignature {
    method: string
}

export class AbstractMessageSignature implements MessageSignature {
    method: string;
    constructor(method: string) {
        this.method = method;
    }
}

export class BroadcastType<P extends unknown[] = []> extends AbstractMessageSignature {
    public readonly _?: ['broadcast', P, void];
    constructor(method: string) {
        super(method);
    }
}

export class RequestType<P extends unknown[], R> extends AbstractMessageSignature {
    public readonly _?: ['request', P, R];
    constructor(method: string) {
        super(method);
    }
}

export class NotificationType<P extends unknown[]> extends AbstractMessageSignature {
    public readonly _?: ['notification', P, void];
    constructor(method: string) {
        super(method);
    }
}
