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
import { createHash, randomBytes } from 'node:crypto';

const PKCE_VERIFIER_TTL = 10 * 60 * 1000;

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
    protected pkceEnabled: boolean;

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
        this.pkceEnabled = this.configuration.getValue('oct-oauth-pkce', 'boolean') ?? false;
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
            pkceEnabled: this.pkceEnabled,
        };

        const verify = (accessToken: any, _: any, profile: any, done: VerifyCallback) => {
            const userInfo = {
                name: profile ? profile[this.userNameClaim] : accessToken[this.userNameClaim],
                email: profile ? profile[this.userEmailClaim] : accessToken[this.userEmailClaim],
                authProvider: this.label,
            };
            done(undefined, userInfo);
        };
        return this.userInfoUrl ? new OIDCStrategy(options, verify) : new PKCEOAuth2Strategy(options, verify);
    }

    override getName(): string {
        return this.label;
    }
}

export type ODICOptions = OAuth2Strategy.StrategyOptions & {
    userInfoURL: string;
    pkceEnabled?: boolean;
}

export type PKCEOAuth2Options = OAuth2Strategy.StrategyOptions & {
    pkceEnabled?: boolean;
}

type PKCEVerifier = {
    value: string;
    timeout: NodeJS.Timeout;
}

export class PKCEOAuth2Strategy extends OAuth2Strategy {

    protected readonly pkceVerifiers = new Map<string, PKCEVerifier>();

    constructor(protected options: PKCEOAuth2Options, verify: OAuth2Strategy.VerifyFunction) {
        super(options, verify);
    }

    override authorizationParams(options: Record<string, unknown>): object {
        if (!this.options.pkceEnabled) {
            return {};
        }
        const state = this.getState(options);
        const value = randomBytes(32).toString('base64url');
        const previousVerifier = this.pkceVerifiers.get(state);
        if (previousVerifier) {
            clearTimeout(previousVerifier.timeout);
        }
        const timeout = setTimeout(() => this.pkceVerifiers.delete(state), PKCE_VERIFIER_TTL);
        timeout.unref();
        this.pkceVerifiers.set(state, { value, timeout });
        return {
            code_challenge: createHash('sha256').update(value).digest('base64url'),
            code_challenge_method: 'S256'
        };
    }

    override tokenParams(options: Record<string, unknown>): object {
        if (!this.options.pkceEnabled) {
            return {};
        }
        const state = this.getState(options);
        const verifier = this.pkceVerifiers.get(state);
        if (!verifier) {
            throw new Error('Missing or expired PKCE verifier for OAuth state');
        }
        this.pkceVerifiers.delete(state);
        clearTimeout(verifier.timeout);
        return { code_verifier: verifier.value };
    }

    protected getState(options: Record<string, unknown>): string {
        if (typeof options.state !== 'string' || options.state.length === 0) {
            throw new Error('PKCE requires a non-empty OAuth state');
        }
        return options.state;
    }
}

export class OIDCStrategy extends PKCEOAuth2Strategy {

    constructor(protected override options: ODICOptions, verify: OAuth2Strategy.VerifyFunction) {
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

