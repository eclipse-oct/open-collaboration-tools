// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test } from 'vitest';
import { getJoinRoomId } from '../../src/utils/join-uri.js';

describe('Join room URI', () => {
    test('returns the decoded invitation code for the join path', () => {
        const invitationCode = 'https://api.example.com/#room123';
        const uri = {
            path: '/join',
            query: `room=${encodeURIComponent(invitationCode)}`
        };

        expect(getJoinRoomId(uri)).toBe(invitationCode);
    });

    test('rejects a missing or empty room query parameter', () => {
        expect(getJoinRoomId({ path: '/join', query: '' })).toBeUndefined();
        expect(getJoinRoomId({ path: '/join', query: 'room=' })).toBeUndefined();
    });

    test('rejects unsupported paths', () => {
        expect(getJoinRoomId({ path: '/create', query: 'room=room123' })).toBeUndefined();
    });
});
