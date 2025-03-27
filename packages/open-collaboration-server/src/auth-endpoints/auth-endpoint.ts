// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import type { Express } from 'express';
import { AuthProvider, Event } from 'open-collaboration-protocol';
import { User } from '../types';

export type UserInfo = Omit<User, 'id'>;
export interface AuthSuccessEvent {
    token: string;
    userInfo: UserInfo;
}

export const AuthEndpoint = Symbol('AuthEndpoint');

export interface AuthEndpoint {
    shouldActivate(): boolean;
    onStart(app: Express, hostname: string, port: number): void;
    onDidAuthenticate: Event<AuthSuccessEvent>;
    getProtocolProvider(): AuthProvider;
}
