// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { SemVer } from 'semver';

export const VERSION = '0.3.1';
export const SEM_VERSION = new SemVer(VERSION);

/**
 * Returns whether the client protocol version is compatible with the server protocol version.
 * The client and server are compatible if they either share the same major version or if both are in the `0.x` range and they share the same minor version.
 *
 * After the first major version, minor versions only indicate backwards-compatible changes.
 * In the `0.x` range, minor versions indicate backwards-incompatible changes.
 * Patch versions are ignored for compatibility checks.
 *
 * @param incoming The protocol version of the server or of an incoming message.
 * @param own The protocol version of the client.
 */
export function compatibleVersions(incoming: SemVer, own: SemVer = SEM_VERSION): boolean {
    if (own.major !== incoming.major) {
        return false;
    } else if (own.major === 0 && incoming.major === 0) {
        return own.minor === incoming.minor;
    } else {
        return true;
    }
}
