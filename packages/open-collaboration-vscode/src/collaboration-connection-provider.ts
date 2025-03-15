// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { ConnectionProvider, SocketIoTransportProvider } from 'open-collaboration-protocol';
import { packageVersion } from './utils/package';
import { SecretStorage } from './secret-storage';

export const Fetch = Symbol('Fetch');

@injectable()
export class CollaborationConnectionProvider {

    @inject(SecretStorage)
    private secretStorage: SecretStorage;

    @inject(Fetch)
    private fetch: typeof fetch;

    async createConnection(serverUrl: string): Promise<ConnectionProvider> {
        const userToken = await this.secretStorage.retrieveUserToken(serverUrl);
        return new ConnectionProvider({
            url: serverUrl,
            client: `OCT_CODE_${vscode.env.appName.replace(/\s+/, '_')}@${packageVersion}`,
            opener: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
            transports: [SocketIoTransportProvider],
            userToken,
            fetch: this.fetch
        });
    }
}
