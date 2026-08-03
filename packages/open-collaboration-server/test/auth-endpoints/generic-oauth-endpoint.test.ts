// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import OAuth2Strategy from 'passport-oauth2';
import { PKCEOAuth2Strategy, PKCEOAuth2Options } from '../../src/auth-endpoints/generic-oauth-endpoint.js';

const verify: OAuth2Strategy.VerifyFunction = (_accessToken, _refreshToken, _profile, done) => done(null, {});

function createStrategy(pkceEnabled: boolean): PKCEOAuth2Strategy {
    const options: PKCEOAuth2Options = {
        authorizationURL: 'https://example.com/oauth/authorize',
        tokenURL: 'https://example.com/oauth/token',
        clientID: 'client-id',
        clientSecret: 'client-secret',
        callbackURL: 'https://oct.example.com/api/login/oauth-callback',
        pkceEnabled
    };
    return new PKCEOAuth2Strategy(options, verify);
}

describe('Generic OAuth PKCE strategy', () => {
    test('does not add PKCE parameters when disabled', () => {
        const strategy = createStrategy(false);

        expect(strategy.authorizationParams({ state: 'state' })).toEqual({});
        expect(strategy.tokenParams({ state: 'state' })).toEqual({});
    });

    test('binds an S256 verifier to the OAuth state', () => {
        const strategy = createStrategy(true);

        const authorizationParams = strategy.authorizationParams({ state: 'state' }) as {
            code_challenge: string;
            code_challenge_method: string;
        };
        const tokenParams = strategy.tokenParams({ state: 'state' }) as { code_verifier: string };

        expect(authorizationParams.code_challenge_method).toBe('S256');
        expect(createHash('sha256').update(tokenParams.code_verifier).digest('base64url'))
            .toBe(authorizationParams.code_challenge);
    });

    test('requires a non-empty OAuth state when enabled', () => {
        const strategy = createStrategy(true);

        expect(() => strategy.authorizationParams({})).toThrow('PKCE requires a non-empty OAuth state');
        expect(() => strategy.tokenParams({ state: '' })).toThrow('PKCE requires a non-empty OAuth state');
    });

    test('consumes each verifier only once', () => {
        const strategy = createStrategy(true);
        strategy.authorizationParams({ state: 'state' });

        expect(strategy.tokenParams({ state: 'state' })).toHaveProperty('code_verifier');
        expect(() => strategy.tokenParams({ state: 'state' })).toThrow('Missing or expired PKCE verifier for OAuth state');
    });
});
