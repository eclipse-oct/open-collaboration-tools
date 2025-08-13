// ******************************************************************************
// Copyright 2025 TypeFox GmbH, n3therNet
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { AuthProvider } from 'open-collaboration-protocol';
import { Strategy } from 'passport';
import { OAuthEndpoint, ThirdParty } from './oauth-endpoint.js';
import OAuth2Strategy, { VerifyCallback } from 'passport-oauth2';
import { injectable, postConstruct } from 'inversify';

@injectable()
export class AuthentikOAuthEndpoint extends OAuthEndpoint {

    protected override id: string = 'authentik';

    protected override path: string = '/api/login/authentik';

    protected override redirectPath: string = '/api/login/authentik-callback';

    protected label: string = 'Authentik';

    protected host?: string;
    protected clientID?: string;
    protected clientSecret?: string;
    protected userNameClaim?: string;

    @postConstruct()
    init() {
        this.host = this.configuration.getValue('oct-oauth-authentik-url');
        this.clientID = this.configuration.getValue('oct-oauth-authentik-clientid');
        this.clientSecret = this.configuration.getValue('oct-oauth-authentik-clientsecret');
        this.userNameClaim = this.configuration.getValue('oct-oauth-authentik-usernameclaim');
        this.label = this.configuration.getValue('oct-oauth-authentik-clientlabel') ?? 'Authentik';

        super.initialize();
    }

    getProtocolProvider(): AuthProvider {
        return {
            endpoint: this.path,
            name: this.label,
            type: 'web',
            label: {
                code: '',
                message: this.label,
                params: []
            },
            group: ThirdParty
        };
    }

    shouldActivate(): boolean {
        return !!this.host && !!this.clientID;
    }

    getStrategy(host: string, port: number): Strategy {
        return new AuthentikStrategy({
            authorizationURL: `${this.host}/application/o/authorize/`,
            tokenURL: `${this.host}/application/o/token/`,
            userInfoURL: `${this.host}/application/o/userinfo/`,
            clientID: this.clientID!,
            clientSecret: this.clientSecret ?? '',
            scope: ['openid', 'email', 'profile'],
            callbackURL: this.createRedirectUrl(host, port, this.redirectPath),
        }, (accessToken: string, refreshToken: string, profile: any, done: VerifyCallback) => {
            const userInfo = {
                name: profile[this.userNameClaim ?? 'preferred_username'],
                email: profile.email,
                authProvider: this.label,
            };
            done(undefined, userInfo);
        });

    }

}

type AuthentikStrategyOptions = OAuth2Strategy.StrategyOptions & {
    userInfoURL: string;
}

class AuthentikStrategy extends OAuth2Strategy {

    constructor(protected options: AuthentikStrategyOptions, verify: OAuth2Strategy.VerifyFunction) {
        super(options, verify);
    }

    override async userProfile(accessToken: string, done: (err?: unknown, profile?: any) => void): Promise<void> {
        fetch(this.options.userInfoURL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        }).then(async response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch user profile: ${response.statusText}`);
            }
            done(undefined, await response.json());
        }).catch(err => done(err));

    }
}
