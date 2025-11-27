// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { AuthProvider } from 'open-collaboration-protocol';
import { Strategy } from 'passport';
import { OAuthEndpoint } from './oauth-endpoint.js';
import { injectable, postConstruct } from 'inversify';
import OAuth2Strategy, { VerifyCallback } from 'passport-oauth2';

@injectable()
export class GenericOAuthEndpoint extends OAuthEndpoint {

    protected override id: string = 'generic-oauth';
    protected override path: string = '/api/login/oauth';
    protected override redirectPath: string =  '/api/login/oauth-callback';

    protected label: string;
    protected authURL?: string;
    protected tokenURL?: string;
    protected userInfoUrl?: string;
    protected clientID?: string;
    protected clientSecret?: string;
    protected userNameClaim: string;
    protected userEmailClaim: string;

    @postConstruct()
    init() {
        super.initialize();

        this.label = this.configuration.getValue('oct-oauth-clientlabel') ?? 'Generic OAuth';
        this.authURL = this.configuration.getValue('oct-oauth-url');
        this.tokenURL = this.configuration.getValue('oct-oauth-token-url');
        this.userInfoUrl = this.configuration.getValue('oct-oauth-userinfo-url');
        this.clientID = this.configuration.getValue('oct-oauth-clientid');
        this.clientSecret = this.configuration.getValue('oct-oauth-clientsecret');
        this.userNameClaim = this.configuration.getValue('oct-oauth-usernameclaim') ?? 'username';
        this.userEmailClaim = this.configuration.getValue('oct-oauth-emailclaim') ?? 'email';
    }

    override getProtocolProvider(): AuthProvider {
        return {
            endpoint: this.path,
            name: this.label,
            type: 'web',
            label: {
                code: '',
                message: this.label,
                params: []
            },
            group: {code: 'third-party', message: 'Third Party', params: []}
        };
    }
    override shouldActivate(): boolean {
        return !!this.authURL && !!this.tokenURL && !!this.clientID;
    }
    override getStrategy(host: string, port: number): Strategy {
        const options: ODICOptions = {
            authorizationURL: this.authURL!,
            tokenURL: this.tokenURL!,
            clientID: this.clientID!,
            clientSecret: this.clientSecret ?? '',
            userInfoURL: this.userInfoUrl!,
            callbackURL: this.createRedirectUrl(host, port, this.redirectPath),
        };

        const verify = (accessToken: any, _: any, profile: any, done: VerifyCallback) => {
            const userInfo = {
                name: profile ? profile[this.userNameClaim] : accessToken[this.userNameClaim],
                email: profile ? profile[this.userEmailClaim] : accessToken[this.userEmailClaim],
                authProvider: this.label,
            };
            done(undefined, userInfo);
        };
        return this.userInfoUrl ? new OIDCStrategy(options, verify) : new OAuth2Strategy(options, verify);
    }

}

export type ODICOptions = OAuth2Strategy.StrategyOptions & {
    userInfoURL: string;
}

export class OIDCStrategy extends OAuth2Strategy {

    constructor(protected options: ODICOptions, verify: OAuth2Strategy.VerifyFunction) {
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

