// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { AuthProviderMetadata, ConnectionProvider, FormAuthProviderConfiguration, SocketIoTransportProvider } from 'open-collaboration-protocol';
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
            authenticationHandler: async (token, authMetadata) => {
                if (!authMetadata.providers?.length && authMetadata.loginPageUrl) {
                    vscode.env.openExternal(vscode.Uri.parse(authMetadata.loginPageUrl));
                    return;
                }
                const provider = await vscode.window.showQuickPick(authMetadata.providers, { title: vscode.l10n.t('Select authentication method') });
                if (provider) {
                    switch (provider.type) {
                        case 'form':
                            this.handleFormAuth(token, provider as FormAuthProviderConfiguration, serverUrl);
                            break;
                        case 'oauth':
                            this.handleOauthAuth(token, provider, serverUrl);
                            break;
                    }
                }
            },
            transports: [SocketIoTransportProvider],
            userToken,
            fetch: this.fetch
        });
    }

    private async handleFormAuth(token: string, provider: FormAuthProviderConfiguration, serverUrl: string) {
        const fields = provider.fields;
        const values: Record<string, string> = {
            token
        };

        for (const field of fields) {
            const value = await vscode.window.showInputBox({
                prompt: field,
            });
            if (value !== undefined) {
                values[field] = value;
            }
        }

        const endpointUrl = vscode.Uri.parse(serverUrl).with({ path: provider.endpoint });
        const response = await this.fetch(endpointUrl.toString(), {
            method: 'POST',
            body: JSON.stringify(values),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        vscode.window.showInformationMessage(response.ok ? vscode.l10n.t('Login successful') : vscode.l10n.t('Login failed'));
    }

    private handleOauthAuth(token: string, provider: AuthProviderMetadata, serverUrl: string) {
        const endpointUrl = vscode.Uri.parse(serverUrl).with({ path: provider.endpoint, query: `token=${token}` });

        vscode.env.openExternal(endpointUrl);
    }
}
