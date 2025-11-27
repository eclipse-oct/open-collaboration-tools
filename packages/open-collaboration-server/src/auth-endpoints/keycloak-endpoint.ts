// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { AuthProvider } from 'open-collaboration-protocol';
import { Strategy } from 'passport';
import { OAuthEndpoint, ThirdParty } from './oauth-endpoint.js';
import { VerifyCallback } from 'passport-oauth2';
import { injectable, postConstruct } from 'inversify';
import { OIDCStrategy } from './generic-oauth-endpoint.js';

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
        this.host = this.configuration.getValue('oct-oauth-keycloak-url');
        this.realm = this.configuration.getValue('oct-oauth-keycloak-realm');
        this.clientID = this.configuration.getValue('oct-oauth-keycloak-clientid');
        this.clientSecret = this.configuration.getValue('oct-oauth-keycloak-clientsecret');
        this.userNameClaim = this.configuration.getValue('oct-oauth-keycloak-usernameclaim');
        this.label = this.configuration.getValue('oct-oauth-keycloak-clientlabel') ?? 'Keycloak';

        this.keycloakBaseUrl = `${this.host}/realms/${this.realm}`;
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
        return !!this.host && !!this.realm && !!this.clientID;
    }

    getStrategy(host: string, port: number): Strategy {
        return new OIDCStrategy({
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

