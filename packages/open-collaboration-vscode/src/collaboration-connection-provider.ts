// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { AuthProviderMetadata, ConnectionProvider, FormAuthProviderCongifuration, SocketIoTransportProvider } from 'open-collaboration-protocol';
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
        const serverUrl = vscode.workspace.getConfiguration().get<string>('oct.serverUrl');
        userToken ??= await this.context.secrets.get(OCT_USER_TOKEN);

        if (serverUrl) {
            return new ConnectionProvider({
                url: serverUrl,
                client: `OCT_CODE_${vscode.env.appName.replace(/\s+/, '_')}@${packageVersion}`,
                authenticationHandler: async (token, authMetadata) => {
                    if(!authMetadata.providers?.length && authMetadata.loginPageUrl) {
                        vscode.env.openExternal(vscode.Uri.parse(authMetadata.loginPageUrl));
                        return;
                    }
                    const provider = await vscode.window.showQuickPick(authMetadata.providers, {title: vscode.l10n.t('Select authentication method')});
                    if(provider) {
                        switch(provider.type) {
                            case 'form':
                                this.handleFormAuth(token, provider as FormAuthProviderCongifuration, serverUrl);
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
        return undefined;
    }

    private async handleFormAuth(token: string, provider: FormAuthProviderCongifuration, serverUrl: string) {
        const fields = provider.fields;
        const values:  Record<string, string> = {
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

        const endpointUrl = vscode.Uri.parse(serverUrl).with({path: provider.endpoint});
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
        const endpointUrl = vscode.Uri.parse(serverUrl).with({path: provider.endpoint, query: `token=${token}`});

        vscode.env.openExternal(endpointUrl);

    }
}

