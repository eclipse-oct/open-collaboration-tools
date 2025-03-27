// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable } from 'inversify';
import { type Express } from 'express';
import { Emitter, FormAuthProvider, Info } from 'open-collaboration-protocol';
import { AuthEndpoint, AuthSuccessEvent } from './auth-endpoint';
import { Logger, LoggerSymbol } from '../utils/logging';
import { Configuration } from '../utils/configuration';

@injectable()
export class SimpleLoginEndpoint implements AuthEndpoint {

    protected static readonly ENDPOINT = '/api/login/simple';

    @inject(LoggerSymbol) protected logger: Logger;

    @inject(Configuration) protected configuration: Configuration;

    private authSuccessEmitter = new Emitter<AuthSuccessEvent>();
    onDidAuthenticate = this.authSuccessEmitter.event;

    shouldActivate(): boolean {
        return this.configuration.getValue('oct-activate-simple-login', 'boolean') ?? false;
    }

    getProtocolProvider(): FormAuthProvider {
        return {
            type: 'form',
            name: 'unverified',
            endpoint: SimpleLoginEndpoint.ENDPOINT,
            label: {
                code: Info.Codes.UnverifiedLoginLabel,
                message: 'Unverified',
                params: []
            },
            details: {
                code: Info.Codes.UnverifiedLoginDetails,
                message: 'Login with a user name and an optional email address',
                params: []
            },
            group: {
                code: Info.Codes.BuiltinsGroup,
                message: 'Builtins',
                params: []
            },
            fields: [
                {
                    name: 'user',
                    label: {
                        code: Info.Codes.UsernameLabel,
                        message: 'Username',
                        params: []
                    },
                    required: true,
                    placeHolder: {
                        code: Info.Codes.UsernamePlaceholder,
                        message: 'Your user name that will be shown to all session participants',
                        params: []
                    }
                }, {
                    name: 'email',
                    label: {
                        code: Info.Codes.EmailLabel,
                        message: 'Email',
                        params: []
                    },
                    required: false,
                    placeHolder: {
                        code: Info.Codes.EmailPlaceholder,
                        message: 'Your email that will be shown to the host when joining the session',
                        params: []
                    }
                }
            ]
        };
    }

    onStart(app: Express, _hostname: string, _port: number): void {
        app.post(SimpleLoginEndpoint.ENDPOINT, async (req, res) => {
            try {
                const token = req.body.token as string;
                const user = req.body.user as string;
                const email = req.body.email as string | undefined;
                await Promise.all(this.authSuccessEmitter.fire({ token, userInfo: { name: user, email, authProvider: 'Unverified' } }));
                res.send('Ok');
            } catch (err) {
                this.logger.error('Failed to perform simple login', err);
                res.status(400);
                res.send('Failed to perform simple login');
            }
        });
    }
}
