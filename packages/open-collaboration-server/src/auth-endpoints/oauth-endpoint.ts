// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable, postConstruct } from 'inversify';
import { type Express } from 'express';
import { AuthProvider, Emitter, Event, Info } from 'open-collaboration-protocol';
import { AuthEndpoint, AuthSuccessEvent, UserInfo } from './auth-endpoint';
import passport from 'passport';
import { Strategy as GithubStrategy } from 'passport-github';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Logger, LoggerSymbol } from '../utils/logging';
import { Configuration } from '../utils/configuration';
import { URL } from 'url';

export const oauthProviders = Symbol('oauthProviders');

const ThirdParty: Info = {
    code: Info.Codes.ThirdParty,
    message: 'Third-party',
    params: []
};

@injectable()
export abstract class OAuthEndpoint implements AuthEndpoint {

    protected loginRedirectRequests = new Map<string, string>();

    @inject(LoggerSymbol) protected logger: Logger;

    @inject(Configuration) protected configuration: Configuration;

    protected abstract id: string;
    protected abstract path: string
    protected abstract redirectPath: string
    protected scope?: string;
    protected baseURL?: string;

    private authSuccessEmitter = new Emitter<AuthSuccessEvent>();
    onDidAuthenticate: Event<AuthSuccessEvent> = this.authSuccessEmitter.event;

    abstract getProtocolProvider(): AuthProvider;

    @postConstruct()
    initialize() {
        this.baseURL = this.configuration.getValue('oct-base-url');
    }

    abstract shouldActivate(): boolean;
    abstract getStrategy(host: string, port: number): passport.Strategy;

    onStart(app: Express, hostname: string, port: number): void {
        passport.use(this.id, this.getStrategy(hostname, port));

        app.get(this.path, async (req, res) => {
            const token = req.query.token;
            if (!token) {
                this.logger.error('missing token parameter in request');
                res.status(400);
                res.send('Error: Missing token parameter in request');
                return;
            }
            if(req.query.redirect) {
                this.loginRedirectRequests.set(token.toString(), req.query.redirect.toString());
            }
            passport.authenticate(this.id, { state: `${token}`, scope: this.scope })(req, res);
        });

        const loginSuccessURL = this.configuration.getValue('oct-login-success-url');
        const redirectUriWhitelist = this.configuration.getValue('oct-redirect-url-whitelist')?.split(',');
        app.get(this.redirectPath, async (req, res) => {
            const token = (req.query.state as string);
            if (!token) {
                this.logger.error('missing token in request state');
                res.status(400);
                res.send('Error: Missing token in request state');
                return;
            }
            passport.authenticate(this.id, { state: token, scope: this.scope }, async (err: any, userInfo?: UserInfo) => {
                if (err || !userInfo) {
                    this.logger.error('Error retrieving user info', err);
                    res.status(400);
                    res.send('Error retrieving user info');
                    return;
                }
                try {
                    await Promise.all(this.authSuccessEmitter.fire({ token, userInfo }));
                } catch (err) {
                    this.logger.error('Error during login', err);
                    res.status(500);
                    res.send('Internal server error occured during Login. Please try again');
                    return;
                }

                const redirectRequest = this.loginRedirectRequests.get(token);
                if(redirectRequest) {
                    this.loginRedirectRequests.delete(token);
                    if(!redirectUriWhitelist?.includes(redirectRequest)) {
                        this.logger.error(`Redirect URI ${redirectRequest} not in whitelist`);
                        res.status(400);
                        res.send('Error: Redirect URL not in whitelist');
                    } else {
                        const url = URL.canParse(redirectRequest) ? new URL(redirectRequest) : undefined;
                        if(!url) {
                            res.status(400);
                            res.send('Error: Invalid redirect URL');
                            return;
                        }
                        url.searchParams.append('token', token);
                        res.redirect(url.toString());
                    }
                } else if (loginSuccessURL) {
                    res.redirect(loginSuccessURL);
                } else {
                    res.status(200);
                    res.send('Login Successful. You can close this page');
                }

            })(req, res);
        });

    }

    protected createRedirectUrl(host: string, port: number, path: string): string {
        const baseURL = this.baseURL ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
        return new URL(path, baseURL).toString();
    }
}

@injectable()
export class GitHubOAuthEndpoint extends OAuthEndpoint {
    protected id = 'github';
    protected path = '/api/login/github';
    protected redirectPath = '/api/login/github-callback';

    shouldActivate(): boolean {
        return Boolean(this.configuration.getValue('oct-oauth-github-clientid') && this.configuration.getValue('oct-oauth-github-clientsecret'));
    }

    override getProtocolProvider(): AuthProvider {
        return {
            type: 'web',
            name: 'github',
            endpoint: this.path,
            label: {
                code: Info.Codes.GithubLabel,
                message: 'Github',
                params: []
            },
            group: ThirdParty
        };
    }

    override getStrategy(hostname: string, port: number): passport.Strategy {
        return new GithubStrategy({
            clientID: this.configuration.getValue('oct-oauth-github-clientid')!,
            clientSecret: this.configuration.getValue('oct-oauth-github-clientsecret')!,
            callbackURL: this.createRedirectUrl(hostname, port, this.redirectPath),
        }, (accessToken, refreshToken, profile, done) => {
            const userInfo: UserInfo = {
                name: profile.displayName,
                email: profile.emails?.[0]?.value,
                authProvider: 'Github'
            };
            done(undefined, userInfo);
        });
    }
}

@injectable()
export class GoogleOAuthEndpoint extends OAuthEndpoint {
    protected id = 'google';
    protected path = '/api/login/google';
    protected redirectPath = '/api/login/google-callback';
    protected override scope = 'email profile';

    shouldActivate(): boolean {
        return Boolean(this.configuration.getValue('oct-oauth-google-clientid') && this.configuration.getValue('oct-oauth-google-clientsecret'));
    }

    override getProtocolProvider(): AuthProvider {
        return {
            type: 'web',
            name: 'google',
            endpoint: this.path,
            label: {
                code: Info.Codes.GoogleLabel,
                message: 'Google',
                params: []
            },
            group: ThirdParty
        };
    }

    override getStrategy(hostname: string, port: number): passport.Strategy {
        return new GoogleStrategy({
            clientID: this.configuration.getValue('oct-oauth-google-clientid')!,
            clientSecret: this.configuration.getValue('oct-oauth-google-clientsecret')!,
            callbackURL: this.createRedirectUrl(hostname, port, this.redirectPath),
        }, (accessToken, refreshToken, profile, done) => {
            const userInfo: UserInfo = {
                name: profile.displayName,
                email: profile.emails?.find(mail => mail.verified)?.value,
                authProvider: 'Google'
            };
            done(undefined, userInfo);
        });
    }
}
