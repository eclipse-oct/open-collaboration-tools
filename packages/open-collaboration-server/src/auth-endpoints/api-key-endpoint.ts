import { inject, injectable, postConstruct } from 'inversify';
import { type Express } from 'express';
import { Emitter, FormAuthProvider, Info } from 'open-collaboration-protocol';
import { AuthEndpoint, AuthSuccessEvent } from './auth-endpoint.js';
import { Logger } from '../utils/logging.js';
import { Configuration } from '../utils/configuration.js';
import { customAlphabet } from 'nanoid';

@injectable()
export class ApiKeyAuthEndpoint implements AuthEndpoint {

    protected static readonly ENDPOINT = '/api/login/apikey';

    @inject(Logger) protected logger: Logger;

    @inject(Configuration) protected configuration: Configuration;

    private authSuccessEmitter = new Emitter<AuthSuccessEvent>();
    onDidAuthenticate = this.authSuccessEmitter.event;

    private apiKey: string = '';

    @postConstruct()
    protected initialize(): void {
        const configuredKey = this.configuration.getValue('oct-api-key');
        if (configuredKey) {
            this.apiKey = configuredKey;
            this.logger.info('API key authentication enabled (key provided via configuration)');
        } else {
            this.apiKey = this.generateApiKey();
            this.logger.info(`API key authentication enabled (auto-generated key): ${this.apiKey}`);
        }
    }

    shouldActivate(): boolean {
        return true;
    }

    getProtocolProvider(): FormAuthProvider {
        return {
            type: 'form',
            name: 'apikey',
            endpoint: ApiKeyAuthEndpoint.ENDPOINT,
            label: {
                code: 'ApiKeyLoginLabel',
                message: 'API Key',
                params: []
            },
            details: {
                code: 'ApiKeyLoginDetails',
                message: 'Login with a server API key for non-interactive use',
                params: []
            },
            group: {
                code: Info.Codes.BuiltinsGroup,
                message: 'Builtins',
                params: []
            },
            fields: [
                {
                    name: 'apiKey',
                    label: {
                        code: 'ApiKeyLabel',
                        message: 'API Key',
                        params: []
                    },
                    required: true,
                    placeHolder: {
                        code: 'ApiKeyPlaceholder',
                        message: 'The server API key',
                        params: []
                    }
                }
            ]
        };
    }

    onStart(app: Express, _hostname: string, _port: number): void {
        app.post(ApiKeyAuthEndpoint.ENDPOINT, async (req, res) => {
            try {
                const token = req.body.token as string;
                const apiKey = req.body.apiKey as string;
                if (!token || !apiKey) {
                    res.status(400);
                    res.send('Missing token or apiKey');
                    return;
                }
                if (apiKey !== this.apiKey) {
                    res.status(403);
                    res.send('Invalid API key');
                    return;
                }
                await Promise.all(this.authSuccessEmitter.fire({
                    token,
                    userInfo: { name: 'API Key User', authProvider: 'API Key' }
                }));
                res.send('Ok');
            } catch (err) {
                this.logger.error('Failed to perform API key login', err);
                res.status(400);
                res.send('Failed to perform API key login');
            }
        });
    }

    private generateApiKey(): string {
        let alphabet = '';
        for (let digit = 48; digit <= 57; digit++) {
            alphabet += String.fromCharCode(digit);
        }
        for (let letter = 65; letter <= 90; letter++) {
            alphabet += String.fromCharCode(letter);
        }
        for (let letter = 97; letter <= 122; letter++) {
            alphabet += String.fromCharCode(letter);
        }
        const generate = customAlphabet(alphabet, 48);
        return generate();
    }
}
