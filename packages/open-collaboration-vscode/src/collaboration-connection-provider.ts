// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { ConnectionProvider, SocketIoTransportProvider } from 'open-collaboration-protocol';
import { ExtensionContext } from './inversify';
import { packageVersion } from './utils/package';

export const OCT_USER_TOKEN = 'oct.userToken';

export const Fetch = Symbol('Fetch');

@injectable()
export class CollaborationConnectionProvider {

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    @inject(Fetch)
    private fetch: typeof fetch;

    async createConnection(userToken?: string): Promise<ConnectionProvider | undefined> {
        let serverUrl = vscode.workspace.getConfiguration().get<string>('oct.serverUrl');
        userToken ??= await this.context.secrets.get(OCT_USER_TOKEN);

        if (userToken) {
            let url;
            if (userToken.includes('@@')) {
                [userToken, url] = userToken.split('@@');
                serverUrl = url.includes('://') ? url : `http://${url}`;
            } else if (userToken.includes('@')) {
                [userToken, url] = userToken.split('@');
                serverUrl = url.includes('://') ? url : `https://${url}`;
            }
        }

        if (serverUrl) {
            return new ConnectionProvider({
                url: serverUrl,
                client: `OCT_CODE_${vscode.env.appName.replace(/\s+/, '_')}@${packageVersion}`,
                opener: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
                transports: [SocketIoTransportProvider],
                userToken,
                fetch: this.fetch
            });
        }
        return undefined;
    }
}
