// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable, postConstruct } from 'inversify';
import { Configuration } from './configuration.js';

export enum LogLevel {
    none = 0,
    error = 1,
    warn = 2,
    info = 3,
    debug = 4
}

export interface Logger {

    logLevel: LogLevel;

    error(message: string, ...params: unknown[]): void;
    createErrorAndLog(message: string, ...params: unknown[]): Error;
    warn(message: string, ...params: unknown[]): void;
    info(message: string, ...params: unknown[]): void;
    debug(message: string, ...params: unknown[]): void;

}

export const Logger = Symbol('Logger');

@injectable()
export class ConsoleLogger implements Logger {

    @inject(Configuration) protected configuration: Configuration;

    public logLevel: LogLevel = LogLevel.info;

    @postConstruct()
    protected initialize() {
        const logLevel = this.checkLogLevel(this.configuration.getValue('log-level'));
        if (logLevel) {
            this.logLevel = logLevel;
        }
    }

    protected checkLogLevel(logLevel?: string | unknown): LogLevel | undefined {
        if (!logLevel) {
            return undefined;
        }
        switch (logLevel) {
            case 'none':
            case '0':
                return LogLevel.none;
            case 'error':
            case '1':
                return LogLevel.error;
            case 'warn':
            case '2':
                return LogLevel.warn;
            case 'info':
            case '3':
                return LogLevel.info;
            case 'debug':
            case '4':
                return LogLevel.debug;
            default:
                this.warn(`Invalid log level: ${logLevel}`);
                return undefined;
        }
    }

    error(message: string, ...params: unknown[]) {
        if (this.logLevel >= LogLevel.error) {
            console.error(message, ...params);
        }
    }

    createErrorAndLog(message: string, ...params: unknown[]) {
        if (this.logLevel >= LogLevel.error) {
            this.error(message, ...params);
        }
        return new Error(message);
    }

    warn(message: string, ...params: unknown[]) {
        if (this.logLevel >= LogLevel.warn) {
            console.warn(message, ...params);
        }
    }

    info(message: string, ...params: unknown[]) {
        if (this.logLevel >= LogLevel.info) {
            console.log(message, ...params);
        }
    }

    debug(message: string, ...params: unknown[]) {
        if (this.logLevel >= LogLevel.debug) {
            console.debug(message, ...params);
        }
    }

}
