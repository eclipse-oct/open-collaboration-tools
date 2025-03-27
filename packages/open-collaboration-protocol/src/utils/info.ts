// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { isObject } from './types';

export interface Info {
    code: string;
    params: string[];
    message: string;
}

export namespace Info {
    export function is(arg: unknown): arg is Info {
        return isObject<Info>(arg)
            && typeof arg.code === 'string'
            && typeof arg.message === 'string'
            && Array.isArray(arg.params)
            && arg.params.every(param => typeof param === 'string');
    }
    export namespace Codes {
        export const PerformingLogin = 'PerformingLogin';
        export const InvalidServerVersion = 'InvalidServerVersion';
        export const IncompatibleProtocolVersions = 'IncompatibleProtocolVersions';
        export const AwaitingServerResponse = 'AwaitingServerResponse';
        export const AuthTimeout = 'AuthTimeout';
        export const AuthInternalError = 'AuthInternalError';
        export const RoomNotFound = 'RoomNotFound';
        export const JoinRequestNotFound = 'JoinRequestNotFound';
        export const JoinTimeout = 'JoinTimeout';
        export const JoinRejected = 'JoinRejected';
        export const WaitingForHost = 'WaitingForHost';
        export const UnverifiedLoginLabel = 'UnverifiedLoginLabel';
        export const BuiltinsGroup = 'BuiltinsGroup';
        export const UsernameLabel = 'UsernameLabel';
        export const UsernamePlaceholder = 'UsernamePlaceholder';
        export const EmailLabel = 'EmailLabel';
        export const EmailPlaceholder = 'EmailPlaceholder';
        export const ThirdParty = 'ThirdParty';
        export const GithubLabel = 'GithubLabel';
        export const GoogleLabel = 'GoogleLabel';
    }
}
