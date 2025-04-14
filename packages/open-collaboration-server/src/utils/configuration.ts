// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs';
import * as path from 'path';
import { inject, injectable, optional, postConstruct } from 'inversify';
import { parse as parseYaml } from 'yaml';

export interface Configuration {

    /**
     * Get a string value for the given configuration key.
     * The key must be provided in kebab-case.
     */
    getValue(key: string, type?: 'string'): string | undefined;

    /**
     * Get a number value for the given configuration key.
     * The key must be provided in kebab-case.
     */
    getValue(key: string, type: 'number'): number | undefined;

    /**
     * Get a boolean value for the given configuration key.
     * The key must be provided in kebab-case.
     */
    getValue(key: string, type: 'boolean'): boolean | undefined;

}

export const Configuration = Symbol('Configuration');
export const ConfigurationFile = Symbol('ConfigurationFile');

export type ConfigurationValue = string | number | boolean;

@injectable()
export class DefaultConfiguration implements Configuration {

    @inject(ConfigurationFile)@optional() protected configurationFile: string | undefined;

    protected configuration: Record<string, unknown> = {};

    @postConstruct()
    protected initialize() {
        if (this.configurationFile) {
            const ext = path.extname(this.configurationFile).toLowerCase();
            const configContent = fs.readFileSync(this.configurationFile, 'utf8');
            let config: unknown;
            if (ext === '.yml' || ext === '.yaml') {
                config = parseYaml(configContent);
            } else {
                config = JSON.parse(configContent);
            }
            if (typeof config === 'object' && config !== null) {
                this.configuration = config as Record<string, unknown>;
            }
        }
    }

    getValue(key: string, type?: 'string'): string | undefined;
    getValue(key: string, type: 'number'): number | undefined;
    getValue(key: string, type: 'boolean'): boolean | undefined;
    getValue(key: string, type?: 'string' | 'number' | 'boolean'): ConfigurationValue | undefined {
        let value: ConfigurationValue | undefined = this.getFromEnv(key);
        if (!value) {
            value = this.getFromConfig(key);
        }

        return this.convertToType(value, type);
    }

    protected convertToType(value: ConfigurationValue | undefined, type?: 'string' | 'number' | 'boolean'): ConfigurationValue | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (type === 'string' || type === undefined) {
            return String(value);
        } else if (type === 'number') {
            if (typeof value === 'string') {
                const parsed = parseInt(value, 10);
                if (!isNaN(parsed)) {
                    return parsed;
                }
            } else if (typeof value === 'number') {
                return value;
            }
        } else if (type === 'boolean') {
            if (typeof value === 'string') {
                const lower = value.toLowerCase();
                switch (lower) {
                    case 'true':
                        return true;
                    case 'false':
                        return false;
                }
            } else if (typeof value === 'boolean') {
                return value;
            }
        }
        return undefined;
    }

    protected getFromEnv(key: string): string | undefined {
        return process.env[toEnvKey(key)];
    }

    protected getFromConfig(key: string): ConfigurationValue | undefined {
        return this.getFromConfigObject(this.configuration, toObjKey(key));
    }

    private getFromConfigObject(object: Record<string, unknown>, key: string): ConfigurationValue | undefined {
        let value = object[key];
        if (isConfigValue(value)) {
            return value;
        }

        const segments = key.split('.');
        for (let i = segments.length - 1; i >= 1; i--) {
            const key = segments.slice(0, i).join('.');
            value = object[key];
            if (typeof value === 'object' && value !== null) {
                return this.getFromConfigObject(value as Record<string, unknown>, segments.slice(i).join('.'));
            }
        }
        return undefined;
    }

}

/**
 * Converts a kebab-case key to a SNAKE_CASE key.
 */
function toEnvKey(key: string): string {
    return key.replace(/-/g, '_').toUpperCase();
}

/**
 * Converts a kebab-case key to a dot.separated.key.
 */
function toObjKey(key: string): string {
    return key.replace(/-/g, '.');
}

function isConfigValue(value: unknown): value is ConfigurationValue {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
