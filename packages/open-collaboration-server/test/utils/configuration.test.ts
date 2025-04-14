// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Container } from 'inversify';
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { Configuration, DefaultConfiguration, ConfigurationFile } from '../../src/utils/configuration.js';
import { stringify as stringifyYaml } from 'yaml';

describe('Configuration Service (env variables)', () => {
    let container: Container;

    beforeEach(() => {
        container = new Container();
        container.bind(Configuration).to(DefaultConfiguration);
    });

    afterEach(() => {
        // Clean up environment variables after each test
        delete process.env.TEST_CONFIG_VALUE;
        delete process.env.TEST_CONFIG_NUMBER;
        delete process.env.TEST_CONFIG_BOOLEAN;
    });

    test('should get string value from environment', () => {
        const config = container.get<DefaultConfiguration>(Configuration);
        process.env.TEST_CONFIG_VALUE = 'test-value';
        const value = config.getValue('test-config-value', 'string');
        expect(value).toBe('test-value');
    });

    test('should get number value from environment', () => {
        const config = container.get<DefaultConfiguration>(Configuration);
        process.env.TEST_CONFIG_NUMBER = '42';
        const value = config.getValue('test-config-number', 'number');
        expect(value).toBe(42);
    });

    test('should get boolean value from environment', () => {
        const config = container.get<DefaultConfiguration>(Configuration);
        process.env.TEST_CONFIG_BOOLEAN = 'true';
        const value = config.getValue('test-config-boolean', 'boolean');
        expect(value).toBe(true);
    });

    test('should return undefined for non-existent environment variable', () => {
        const config = container.get<DefaultConfiguration>(Configuration);
        const value = config.getValue('non-existent-value', 'string');
        expect(value).toBeUndefined();
    });

    test('should handle invalid number conversion', () => {
        const config = container.get<DefaultConfiguration>(Configuration);
        process.env.TEST_CONFIG_NUMBER = 'not-a-number';
        const value = config.getValue('test-config-number', 'number');
        expect(value).toBeUndefined();
    });

    test('should handle invalid boolean conversion', () => {
        const config = container.get<DefaultConfiguration>(Configuration);
        process.env.TEST_CONFIG_BOOLEAN = 'not-a-boolean';
        const value = config.getValue('test-config-boolean', 'boolean');
        expect(value).toBeUndefined();
    });
});

describe('Configuration Service (config file)', () => {
    let container: Container;
    let tempFile: string;

    type ConfigFormat = 'json' | 'yaml';
    const formats: ConfigFormat[] = ['json', 'yaml'];

    async function createTempConfigFile(content: Record<string, unknown>, format: ConfigFormat): Promise<string> {
        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oct-config-test-'));
        const filePath = path.join(tempDir, `config.${format}`);
        const serialized = format === 'json'
            ? JSON.stringify(content, null, 2)
            : stringifyYaml(content);
        await fs.promises.writeFile(filePath, serialized);
        return filePath;
    }

    beforeEach(() => {
        container = new Container();
        container.bind(Configuration).to(DefaultConfiguration);
    });

    afterEach(async () => {
        if (tempFile) {
            const tempDir = path.dirname(tempFile);
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
    });

    for (const format of formats) {
        describe(`with ${format.toUpperCase()} format`, () => {
            test('should read string value', async () => {
                tempFile = await createTempConfigFile({
                    'test.config.value': 'test-value'
                }, format);
                container.bind(ConfigurationFile).toConstantValue(tempFile);

                const config = container.get<DefaultConfiguration>(Configuration);
                const value = config.getValue('test-config-value', 'string');
                expect(value).toBe('test-value');
            });

            test('should read number value', async () => {
                tempFile = await createTempConfigFile({
                    'test.config.number': 42
                }, format);
                container.bind(ConfigurationFile).toConstantValue(tempFile);

                const config = container.get<DefaultConfiguration>(Configuration);
                const value = config.getValue('test-config-number', 'number');
                expect(value).toBe(42);
            });

            test('should read boolean value', async () => {
                tempFile = await createTempConfigFile({
                    'test.config.boolean': true
                }, format);
                container.bind(ConfigurationFile).toConstantValue(tempFile);

                const config = container.get<DefaultConfiguration>(Configuration);
                const value = config.getValue('test-config-boolean', 'boolean');
                expect(value).toBe(true);
            });

            test('should handle nested configuration', async () => {
                tempFile = await createTempConfigFile({
                    'test': {
                        'nested': {
                            'value': 'nested-value'
                        }
                    }
                }, format);
                container.bind(ConfigurationFile).toConstantValue(tempFile);

                const config = container.get<DefaultConfiguration>(Configuration);
                const value = config.getValue('test-nested-value', 'string');
                expect(value).toBe('nested-value');
            });

            test('should handle partially nested configuration', async () => {
                tempFile = await createTempConfigFile({
                    'test.nested': {
                        'value': 'nested-value'
                    }
                }, format);
                container.bind(ConfigurationFile).toConstantValue(tempFile);

                const config = container.get<DefaultConfiguration>(Configuration);
                const value = config.getValue('test-nested-value', 'string');
                expect(value).toBe('nested-value');
            });
        });
    }
});
