// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { l10n } from 'vscode';
import { Info } from 'open-collaboration-protocol';

export function localizeInfo(info: Info): string {
    switch (info.code) {
        case Info.Codes.AuthInternalError:
            return l10n.t('Internal authentication server error');
        case Info.Codes.AuthTimeout:
            return l10n.t('Authentication timed out');
        case Info.Codes.AwaitingServerResponse:
            return l10n.t('Awaiting server response');
        case Info.Codes.IncompatibleProtocolVersions:
            return l10n.t('Incompatible protocol versions: client {0}, server {1}', ...info.params);
        case Info.Codes.InvalidServerVersion:
            return l10n.t('Invalid protocol version returned by server: {0}', ...info.params);
        case Info.Codes.JoinRejected:
            return l10n.t('Join request has been rejected');
        case Info.Codes.JoinRequestNotFound:
            return l10n.t('Join request not found');
        case Info.Codes.JoinTimeout:
            return l10n.t('Join request timed out');
        case Info.Codes.PerformingLogin:
            return l10n.t('Performing login');
        case Info.Codes.RoomNotFound:
            return l10n.t('Session not found');
        case Info.Codes.WaitingForHost:
            return l10n.t('Waiting for host to accept join request');
        case Info.Codes.UnverifiedLoginLabel:
            return l10n.t('Unverified');
        case Info.Codes.GithubLabel:
            return l10n.t('GitHub');
        case Info.Codes.GoogleLabel:
            return l10n.t('Google');
        case Info.Codes.BuiltinsGroup:
            return l10n.t('Built-in');
        case Info.Codes.ThirdParty:
            return l10n.t('Third-party');
        case Info.Codes.EmailLabel:
            return l10n.t('Email');
        case Info.Codes.EmailPlaceholder:
            return l10n.t('Your email that will be shown to the host when joining the session');
        case Info.Codes.UsernameLabel:
            return l10n.t('Username');
        case Info.Codes.UsernamePlaceholder:
            return l10n.t('Your user name that will be shown to all session participants');
    }
    return info.message;
}
