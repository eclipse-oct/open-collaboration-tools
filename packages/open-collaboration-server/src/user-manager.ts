// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { injectable } from 'inversify';
import { nanoid } from 'nanoid';
import { User } from './types.js';
import { UserInfo } from './auth-endpoints/auth-endpoint.js';

@injectable()
export class UserManager {

    async registerUser(user: UserInfo): Promise<User> {
        const registeredUser: User = {
            ...user,
            id: nanoid(24)
        };
        return registeredUser;
    }

    async getUser(_id: string): Promise<User | undefined> {
        return undefined;
    }

}
