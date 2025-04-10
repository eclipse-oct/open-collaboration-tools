// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Info } from './info.js';

export class ServerError extends Error {

    code: string;
    params: string[];

    constructor(info: Info) {
        super(info.message);
        this.code = info.code;
        this.params = info.params;
    }

}

export function stringifyError(error: unknown, localization?: (info: Info) => string): string {
    if (error instanceof ServerError || Info.is(error)) {
        if (localization) {
            return localization(error);
        }
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
