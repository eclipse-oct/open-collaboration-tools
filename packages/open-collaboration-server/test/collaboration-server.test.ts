// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test, afterEach } from 'vitest';
import { CollaborationServer } from '../src/collaboration-server.js';
import { Configuration, DefaultConfiguration } from '../src/utils/configuration.js';

class TestableCollaborationServer extends CollaborationServer {
    constructor(configuration: Configuration) {
        super();
        this.configuration = configuration;
    }

    getSocketIoOptionsForTest() {
        return this.getSocketIoOptions();
    }
}

describe('CollaborationServer socket.io ping configuration', () => {
    afterEach(() => {
        delete process.env.OCT_PING_INTERVAL;
        delete process.env.OCT_PING_TIMEOUT;
    });

    test('defaults to socket.io defaults when unset', () => {
        const server = new TestableCollaborationServer(new DefaultConfiguration());

        const options = server.getSocketIoOptionsForTest();

        expect(options.pingInterval).toBe(25000);
        expect(options.pingTimeout).toBe(20000);
    });

    test('reads overrides from OCT_PING_INTERVAL / OCT_PING_TIMEOUT', () => {
        process.env.OCT_PING_INTERVAL = '5000';
        process.env.OCT_PING_TIMEOUT = '3000';
        const server = new TestableCollaborationServer(new DefaultConfiguration());

        const options = server.getSocketIoOptionsForTest();

        expect(options.pingInterval).toBe(5000);
        expect(options.pingTimeout).toBe(3000);
    });
});
