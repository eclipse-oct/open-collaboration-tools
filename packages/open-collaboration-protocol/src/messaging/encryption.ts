// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { NotificationMessage, EncryptedNotificationMessage, RequestMessage, EncryptedRequestMessage, ErrorMessage, ResponseErrorMessage, EncryptedResponseErrorMessage, BroadcastMessage, EncryptedBroadcastMessage, BinaryErrorMessage, ResponseMessage, EncryptedResponseMessage, Message, MessageContentKey, CompressionAlgorithm } from './messages.js';
import { Encoding } from './encoding.js';
import { Compression } from './compression.js';
import { getCryptoLib } from '../utils/crypto.js';
import { fromBase64, toBase64 } from '../utils/base64.js';
import { MaybePromise } from '../utils/promise.js';

export namespace Encryption {

    export interface KeyPair {
        publicKey: string;
        privateKey: string;
    }

    export interface AsymmetricKey {
        peerId: string;
        publicKey: string;
        supportedCompression: CompressionAlgorithm[];
    }

    export interface EncryptionKey {
        symmetricKey: MaybePromise<string>;
        cache?: Record<string, string>;
    }

    export interface DecryptionKey {
        privateKey: string;
        cache?: Record<string, string>;
    }

    export async function generateKeyPair(): Promise<KeyPair> {
        return (await getCryptoLib()).generateKeyPair();
    }
    export async function generateSymKey(): Promise<string> {
        return (await getCryptoLib()).generateSymKey();
    }
    export async function symEncrypt(data: Uint8Array, key: string, iv: string): Promise<Uint8Array> {
        return (await getCryptoLib()).symEncrypt(data, key, iv);
    }
    export async function symDecrypt(data: Uint8Array, key: string, iv: string): Promise<Uint8Array> {
        return (await getCryptoLib()).symDecrypt(data, key, iv);
    }
    export async function publicEncrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
        return (await getCryptoLib()).publicEncrypt(data, key);
    }
    export async function privateDecrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
        return (await getCryptoLib()).privateDecrypt(data, key);
    }
    export async function generateIV(): Promise<string> {
        return (await getCryptoLib()).generateIV();
    }
    export async function encrypt(message: NotificationMessage, symKey: EncryptionKey, ...keys: AsymmetricKey[]): Promise<EncryptedNotificationMessage>;
    export async function encrypt(message: RequestMessage, symKey: EncryptionKey, ...keys: AsymmetricKey[]): Promise<EncryptedRequestMessage>;
    export async function encrypt(message: ResponseMessage, symKey: EncryptionKey, ...keys: AsymmetricKey[]): Promise<EncryptedResponseMessage>;
    export async function encrypt(message: ErrorMessage, symKey: EncryptionKey, ...keys: AsymmetricKey[]): Promise<BinaryErrorMessage>;
    export async function encrypt(message: ResponseErrorMessage, symKey: EncryptionKey, ...keys: AsymmetricKey[]): Promise<EncryptedResponseErrorMessage>;
    export async function encrypt(message: BroadcastMessage, symKey: EncryptionKey, ...keys: AsymmetricKey[]): Promise<EncryptedBroadcastMessage>;
    export async function encrypt(message: Message & { content: unknown }, symKey: EncryptionKey, ...keys: AsymmetricKey[]): Promise<Message & { content: Uint8Array }>;
    export async function encrypt(message: Message & { content: unknown }, symKey: EncryptionKey, ...keys: AsymmetricKey[]): Promise<Message & { content: Uint8Array }> {
        const key = await symKey.symmetricKey;
        const keyBuffer = fromBase64(key);
        const content = message.content;
        const encoded = Encoding.encode(content);
        const compressionAlgo = Compression.bestFit(keys.map(key => key.supportedCompression));
        const compressed = await Compression.compress(encoded, compressionAlgo);
        const iv = await (await getCryptoLib()).generateIV();
        const encrypted = await (await getCryptoLib()).symEncrypt(compressed, key, iv);
        const encryptedKeys = await Promise.all(keys.map(async key => {
            let cachedKey = symKey.cache?.[key.peerId];
            if (!cachedKey) {
                cachedKey = toBase64(await (await getCryptoLib()).publicEncrypt(keyBuffer, key.publicKey));
                if (symKey.cache) {
                    symKey.cache[key.peerId] = cachedKey;
                }
            }
            return {
                target: key.peerId,
                key: cachedKey,
                iv
            } as MessageContentKey;
        }));
        return {
            ...message,
            metadata: {
                ...message.metadata,
                encryption: {
                    keys: encryptedKeys
                },
                compression: {
                    algorithm: compressionAlgo
                }
            },
            content: encrypted
        };
    }
    export async function decrypt(message: EncryptedNotificationMessage, privateKey: DecryptionKey): Promise<NotificationMessage>;
    export async function decrypt(message: EncryptedBroadcastMessage, privateKey: DecryptionKey): Promise<BroadcastMessage>;
    export async function decrypt(message: EncryptedRequestMessage, privateKey: DecryptionKey): Promise<RequestMessage>;
    export async function decrypt(message: EncryptedResponseMessage, privateKey: DecryptionKey): Promise<ResponseMessage>;
    export async function decrypt(message: EncryptedResponseErrorMessage, privateKey: DecryptionKey): Promise<ResponseErrorMessage>;
    export async function decrypt(message: BinaryErrorMessage, privateKey: DecryptionKey): Promise<ErrorMessage>;
    export async function decrypt(message: EncryptedBroadcastMessage | EncryptedNotificationMessage, privateKey: DecryptionKey): Promise<BroadcastMessage | NotificationMessage>;
    export async function decrypt(message: Message & { content: Uint8Array }, privateKey: DecryptionKey): Promise<Message & { content: unknown }>;
    export async function decrypt(message: Message & { content: Uint8Array }, privateKey: DecryptionKey): Promise<Message & { content: unknown }> {
        // We always expect exactly one key for every message we receive
        // This is obviously the case for any 1:1 message such as requests or notifications.
        // However, even for broadcasts, the server will modify the message to only contain the key for the target peer.
        if (message.metadata.encryption.keys.length !== 1) {
            throw new Error('Expected exactly one key for decryption');
        }
        const key = message.metadata.encryption.keys[0];
        let decryptedKey = privateKey.cache?.[key.key];
        if (!decryptedKey) {
            decryptedKey = toBase64(await (await getCryptoLib()).privateDecrypt(fromBase64(key.key), privateKey.privateKey));
            if (privateKey.cache) {
                privateKey.cache[key.key] = decryptedKey;
            }
        }
        const decrypted = await (await getCryptoLib()).symDecrypt(message.content, decryptedKey, key.iv);
        const decompressed = await Compression.decompress(decrypted, message.metadata.compression.algorithm);
        const decoded = Encoding.decode(decompressed);
        return {
            ...message,
            content: decoded
        };
    }
}
