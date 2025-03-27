// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { AuthProvider, ConnectionProvider, FormAuthProvider, SocketIoTransportProvider, WebAuthProvider } from 'open-collaboration-protocol';
import { packageVersion } from './utils/package';
import { SecretStorage } from './secret-storage';
import { localizeInfo } from './utils/l10n';

export const Fetch = Symbol('Fetch');

interface AuthQuickPickItem extends vscode.QuickPickItem {
    provider: AuthProvider;
}

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
                const hasAuthProviders = Boolean(authMetadata.providers.length);
                if (!hasAuthProviders && authMetadata.loginPageUrl) {
                    if (authMetadata.loginPageUrl) {
                        return await vscode.env.openExternal(vscode.Uri.parse(authMetadata.loginPageUrl));
                    } else {
                        vscode.window.showErrorMessage(vscode.l10n.t('No authentication method provided by the server.'));
                        return false;
                    }
                }
                const quickPickItems: AuthQuickPickItem[] = this.enhanceQuickPickGroups(authMetadata.providers.map(provider => ({
                    label: localizeInfo(provider.label),
                    description: provider.details && localizeInfo(provider.details),
                    provider
                })));
                const item = await vscode.window.showQuickPick(quickPickItems, {
                    title: vscode.l10n.t('Select Authentication Method')
                });
                if (item) {
                    switch (item.provider.type) {
                        case 'form':
                            return this.handleFormAuth(token, item.provider, serverUrl);
                        case 'web':
                            return this.handleWebAuth(token, item.provider, serverUrl);
                    }
                }
                return false;
            },
            transports: [SocketIoTransportProvider],
            userToken,
            fetch: this.fetch
        });
    }

    private enhanceQuickPickGroups(items: AuthQuickPickItem[]): AuthQuickPickItem[] {
        const groups = new Map<string, AuthQuickPickItem[]>();
        for (const item of items) {
            const group = localizeInfo(item.provider.group);
            if (!groups.has(group)) {
                groups.set(group, []);
            }
            groups.get(group)!.push(item);
        }
        const result: AuthQuickPickItem[] = [];
        for (const [group, items] of groups) {
            result.push({
                label: group,
                kind: vscode.QuickPickItemKind.Separator,
                provider: undefined!
            });
            result.push(...items);
        }
        return result;
    }

    private async handleFormAuth(token: string, provider: FormAuthProvider, serverUrl: string): Promise<boolean> {
        const fields = provider.fields;
        const values: Record<string, string> = {
            token
        };

        for (const field of fields) {
            let placeHolder: string;
            if (field.placeHolder) {
                placeHolder = localizeInfo(field.placeHolder);
            } else {
                placeHolder = localizeInfo(field.label);
            }
            placeHolder += field.required ? '' : ` (${vscode.l10n.t('optional')})`;
            const value = await vscode.window.showInputBox({
                prompt: localizeInfo(field.label),
                placeHolder,
            });
            // Test for thruthyness to also test for empty string
            if (value) {
                values[field.name] = value;
            } else if (field.required) {
                vscode.window.showErrorMessage(vscode.l10n.t('The {0} field is required. Login aborted.', localizeInfo(field.label)));
                return false;
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
        if (response.ok) {
            vscode.window.showInformationMessage(vscode.l10n.t('Login successful.'));
        } else {
            vscode.window.showErrorMessage(vscode.l10n.t('Login failed.'));
        }
        return response.ok;
    }

    private async handleWebAuth(token: string, provider: WebAuthProvider, serverUrl: string): Promise<boolean> {
        const endpointUrl = vscode.Uri.parse(serverUrl).with({ path: provider.endpoint, query: `token=${token}` });
        return await vscode.env.openExternal(endpointUrl);
    }
}
