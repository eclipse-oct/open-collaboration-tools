// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { AuthProvider } from 'open-collaboration-protocol';
import { Strategy } from 'passport';
import { OAuthEndpoint, ThirdParty } from './oauth-endpoint';
import OAuth2Strategy, { VerifyCallback } from 'passport-oauth2';
import { injectable, postConstruct } from 'inversify';

@injectable()
export class KeycloakOAuthEndpoint extends OAuthEndpoint {

    protected override id: string = 'keycloak';

    protected override path: string = '/api/login/keycloak';

    protected override redirectPath: string = '/api/login/keycloak-callback';

    protected label: string = 'Keycloak';

    protected host?: string;
    protected realm?: string;
    protected clientID?: string;
    protected clientSecret?: string;
    protected userNameClaim?: string;

    protected keycloakBaseUrl: string;

    @postConstruct()
    init() {
        this.host = this.configuration.getValue('keycloak-host');
        this.realm = this.configuration.getValue('keycloak-realm');
        this.clientID = this.configuration.getValue('keycloak-client-id');
        this.clientSecret = this.configuration.getValue('keycloak-client-secret');
        this.userNameClaim = this.configuration.getValue('keycloak-username-claim');
        this.label = this.configuration.getValue('keycloak-client-label') ?? 'Keycloak';

        this.keycloakBaseUrl = `${this.host}/realms/${this.realm}`;
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
        return !!this.host && !!this.realm && !!this.clientID;
    }

    getStrategy(host: string, port: number): Strategy {
        return new KeycloakStrategy({
            authorizationURL: `${this.keycloakBaseUrl}/protocol/openid-connect/auth`,
            tokenURL: `${this.keycloakBaseUrl}/protocol/openid-connect/token`,
            userInfoURL: `${this.keycloakBaseUrl}/protocol/openid-connect/userinfo`,
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

type KeycloakStrategyOptions = OAuth2Strategy.StrategyOptions & {
    userInfoURL: string;
}

class KeycloakStrategy extends OAuth2Strategy {

    constructor(protected options: KeycloakStrategyOptions, verify: OAuth2Strategy.VerifyFunction) {
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
