// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable } from 'inversify';
import { type Express } from 'express';
import { AuthProviderMetadata, Emitter, FormAuthProviderCongifuration } from 'open-collaboration-protocol';
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

    getMetadata(): AuthProviderMetadata {
        return {
            label: 'Unverified',
            type: 'form',
            endpoint: SimpleLoginEndpoint.ENDPOINT,
            fields: ['user', 'email']
        } as FormAuthProviderCongifuration;
    }

    onStart(app: Express, _hostname: string, _port: number): void {
        app.post(SimpleLoginEndpoint.ENDPOINT, async (req, res) => {
            try {
                const token = req.body.token as string;
                const user = req.body.user as string;
                const email = req.body.email as string | undefined;
                await this.authSuccessEmitter.fire({token, userInfo: {name: user, email, authProvider: 'Unverified'}});
                res.send('Ok');
            } catch (err) {
                this.logger.error('Failed to perform simple login', err);
                res.status(400);
                res.send('Failed to perform simple login');
            }
        });
    }
}
