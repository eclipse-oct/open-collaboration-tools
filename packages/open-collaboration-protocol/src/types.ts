// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { CompressionAlgorithm } from './messaging';
import { isObject } from './utils';

export type Path = string;
export type Token = string;
export type Id = string;
export type Binary = Uint8Array;

// HTTP API

export interface CreateRoomResponse {
    roomId: Id;
    roomToken: Token;
    loginToken?: Token;
}

export namespace CreateRoomResponse {
    export function is(arg: unknown): arg is CreateRoomResponse {
        return isObject<CreateRoomResponse>(arg) && typeof arg.roomId === 'string' && typeof arg.roomToken === 'string';
    }
    export function create(roomId: Id, roomToken: Token, loginToken?: Token): CreateRoomResponse {
        return { roomId, roomToken, loginToken };
    }
}

export interface LoginValidateResponse {
    valid: boolean;
}

export namespace LoginValidateResponse {
    export function is(arg: unknown): arg is LoginValidateResponse {
        return isObject<LoginValidateResponse>(arg) && typeof arg.valid === 'boolean';
    }
    export function create(valid: boolean): LoginValidateResponse {
        return { valid };
    }
}

export interface LoginInitialResponse {
    pollToken: string;
    auth: AuthMetadata;
}

export namespace LoginInitialResponse {
    export function is(arg: unknown): arg is LoginInitialResponse {
        return isObject<LoginInitialResponse>(arg) && typeof arg.pollToken === 'string' && typeof arg.auth === 'object';
    }
    export function create(pollToken: string, auth: AuthMetadata): LoginInitialResponse {
        return { pollToken, auth };
    }
}

export interface AuthMetadata {
    providers: AuthProvider[];
    loginPageUrl?: string;
    defaultSuccessUrl?: string;
}

export type AuthProvider = FormAuthProvider | WebAuthProvider;

export interface CommonAuthProvider {
    name: string;
    group: InfoMessage;
    label: InfoMessage;
    details?: InfoMessage;
}

export interface FormAuthProvider extends CommonAuthProvider {
    type: 'form';
    endpoint: string;
    fields: FormAuthProviderField[];
}

export interface FormAuthProviderField {
    name: string;
    required: boolean;
    label: InfoMessage;
    placeHolder?: InfoMessage;
}

export interface WebAuthProvider extends CommonAuthProvider {
    type: 'web';
    endpoint: string;
}

export interface LoginPollResponse {
    loginToken?: string;
}

export namespace LoginPollResponse {
    export function is(arg: unknown): arg is LoginPollResponse {
        return isObject<LoginPollResponse>(arg) && (typeof arg.loginToken === 'undefined' || typeof arg.loginToken === 'string');
    }
    export function create(loginToken?: string): LoginPollResponse {
        return { loginToken };
    }
}

export interface JoinRoomInitialResponse {
    pollToken: string;
    roomId: string;
}

export namespace JoinRoomInitialResponse {
    export function is(arg: unknown): arg is JoinRoomInitialResponse {
        return isObject<JoinRoomInitialResponse>(arg) && typeof arg.pollToken === 'string' && typeof arg.roomId === 'string';
    }
    export function create(pollToken: string, roomId: string): JoinRoomInitialResponse {
        return { pollToken, roomId };
    }
}

export interface JoinRoomResponse {
    roomId: Id;
    roomToken: Token;
    loginToken?: Token;
    workspace: Workspace;
    host: Peer;
}

export namespace JoinRoomResponse {
    export function is(arg: unknown): arg is JoinRoomResponse {
        return isObject<JoinRoomResponse>(arg)
            && typeof arg.roomId === 'string'
            && typeof arg.roomToken === 'string'
            && typeof arg.workspace === 'object'
            && typeof arg.host === 'object';
    }
    export function create(roomId: Id, roomToken: Token, workspace: Workspace, host: Peer): JoinRoomResponse {
        return { roomId, roomToken, workspace, host };
    }
}

export interface JoinRoomPollResponse extends InfoMessage {
    failure: boolean;
}

export namespace JoinRoomPollResponse {
    export function is(arg: unknown): arg is JoinRoomPollResponse {
        return InfoMessage.is(arg) && typeof (arg as JoinRoomPollResponse).failure === 'boolean';
    }
    export function create(code: string, params: string[], message: string, failure: boolean): JoinRoomPollResponse {
        return { code, params, message, failure };
    }
}

export interface ProtocolServerMetaData {
    owner: string;
    version: string;
    transports: string[];
}

export interface InfoMessage {
    code: string;
    params: string[];
    message: string;
}

export namespace InfoMessage {
    export function is(arg: unknown): arg is InfoMessage {
        return isObject<InfoMessage>(arg)
            && typeof arg.code === 'string'
            && Array.isArray(arg.params)
            && arg.params.every(param => typeof param === 'string')
            && typeof arg.message === 'string';
    }
    export function create(code: string, params: string[], message: string): InfoMessage {
        return { code, params, message };
    }
}

// Transport based API

export interface User {
    name: string
    email?: string
    authProvider?: string
}

export interface JoinResponse {
    workspace: Workspace
}

export interface Peer {
    id: Id
    host: boolean
    name: string
    email?: string
    metadata: PeerMetaData
}

export interface PeerMetaData {
    encryption: EncryptionMetaData
    compression: CompressionMetaData;
}

export interface EncryptionMetaData {
    publicKey: string;
}

export interface CompressionMetaData {
    supported: CompressionAlgorithm[];
}

export interface InitRequest {
    protocol: string;
}

export interface InitData {
    protocol: string
    host: Peer
    guests: Peer[]
    permissions: Permissions
    capabilities: Capabilities
    workspace: Workspace
}

export interface Workspace {
    name: string
    folders: string[]
}

export interface Capabilities {

}

export interface Room {
    id: string
    host: Peer
    guests: Peer[]
    permissions: Permissions
}

export interface Permissions {
    readonly: boolean;
    [key: string]: string | boolean;
}

export interface FileSystemStat {
    type: FileType;
    mtime: number;
    ctime: number;
    size: number;
    permissions?: FilePermission;
}

export interface FileSystemDirectory {
    [name: string]: FileType
}

export interface FileData {
    content: Binary
}

export enum FilePermission {
    /**
     * File is readonly.
     */
    Readonly = 1
}

export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64
}

export interface FileChangeEvent {
    changes: FileChange[]
}

export interface FileChange {
    type: FileChangeEventType
    path: Path
}

export enum FileChangeEventType {
    Create = 0,
    Update = 1,
    Delete = 2
}

export interface ClientAwareness {
    /**
     * The peer id of the client.
     */
    peer: string;
    /**
     * The client's current state.
     */
    state?: ClientState;
}

export type ClientState = ClientTextState | ClientChatState | object & { kind: string };

export namespace ClientState {
    export function is<T extends { kind: string }>(arg: any, kind: T['kind']): arg is T {
        return typeof arg === 'object' && arg !== null && arg.kind === kind;
    }
    export function isFn<T extends { kind: string }>(kind: T['kind']): (arg: any) => arg is T {
        return (arg) => is(arg, kind);
    }
}

export interface ClientChatState {
    kind: 'chat';
    writing: boolean;
}

export namespace ClientChatState {
    export const is = ClientState.isFn<ClientChatState>('chat');
}

export interface ClientTextState {
    kind: 'text';
    path: Path;
    visibleRanges?: Range[];
    textSelections: RelativeTextSelection[];
}

export namespace ClientTextState {
    export const is = ClientState.isFn<ClientTextState>('text');
}

export namespace SelectionDirection {
    export const LeftToRight = 1;
    export const RightToLeft = 2;
}

export interface ClientId {
    client: number
    clock: number
}

export interface RelativeTextSelection {
    start: RelativeTextPosition;
    end: RelativeTextPosition;
    direction: SelectionDirection;
}

export interface RelativeTextPosition {
    type: ClientId | null
    tname: string | null
    item: ClientId | null
    assoc: number
}

export interface Position {
    line: number;
    character: number;
}

export namespace Position {
    export function is(arg: any): arg is Position {
        return arg && typeof arg.line === 'number' && typeof arg.character === 'number';
    }
    export function create(line: number, character: number): Position {
        return { line, character };
    }
}

export interface Range {
    start: Position;
    end: Position;
}

export namespace Range {
    export function is(arg: any): arg is Range {
        return arg && Position.is(arg.start) && Position.is(arg.end);
    }
    export function create(start: Position, end: Position): Range {
        return { start, end };
    }
}

export type SelectionDirection = 1 | 2;
