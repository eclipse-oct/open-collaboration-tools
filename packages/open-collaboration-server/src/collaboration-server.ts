// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable, multiInject } from 'inversify';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import express from 'express';
import { SocketIoChannel, TransportChannel } from './channel.js';
import { PeerFactory } from './peer.js';
import { RoomJoinInfo, RoomManager, isRoomClaim } from './room-manager.js';
import { UserManager } from './user-manager.js';
import { CredentialsManager } from './credentials-manager.js';
import { User } from './types.js';
import { CreateRoomResponse, InfoMessage, JoinRoomInitialResponse, JoinRoomPollResponse, JoinRoomResponse, ProtocolServerMetaData, LoginInitialResponse, LoginValidateResponse, LoginPollResponse } from 'open-collaboration-protocol';
import { AuthEndpoint } from './auth-endpoints/auth-endpoint.js';
import { Logger } from './utils/logging.js';
import { VERSION } from 'open-collaboration-protocol';
import { Configuration } from './utils/configuration.js';
import { PeerManager } from './peer-manager.js';
import cookieParser from 'cookie-parser';
// resolves __filename
export const getLocalFilename = (referenceUrl: string | URL) => {
    return fileURLToPath(referenceUrl);
};

// resolves __dirname
export const getLocalDirectory = (referenceUrl: string | URL) => {
    return path.dirname(getLocalFilename(referenceUrl));
};

export interface CollaborationServerOptions {
    port: number;
    hostname: string;
}

@injectable()
export class CollaborationServer {

    @inject(RoomManager)
    protected readonly roomManager: RoomManager;

    @inject(UserManager)
    protected readonly userManager: UserManager;

    @inject(CredentialsManager)
    protected readonly credentials: CredentialsManager;

    @inject(PeerFactory)
    protected readonly peerFactory: PeerFactory;

    @inject(PeerManager)
    protected readonly peerManager: PeerManager;

    @inject(Logger) protected logger: Logger;

    @inject(Configuration) protected configuration: Configuration;

    @multiInject(AuthEndpoint)
    protected readonly authEndpoints: AuthEndpoint[];

    startServer(opts: CollaborationServerOptions): void {
        this.logger.debug('Starting Open Collaboration Server ...');

        const app = this.setupApiRoute();
        const httpServer = http.createServer(app);
        // const wsServer = new ws.Server({
        //     path: '/websocket',
        //     server: httpServer
        // });
        // wsServer.on('connection', async (socket, req) => {
        //     try {
        //         const query = req.url?.split('?')[1] ?? '';
        //         const headers = query.split('&').reduce((acc, cur) => {
        //             const [key, value] = cur.split('=');
        //             if (typeof key === 'string' && typeof value === 'string') {
        //                 acc[decodeURIComponent(key.trim())] = decodeURIComponent(value.trim());
        //             }
        //             return acc;
        //         }, {} as Record<string, string>);
        //         await this.connectChannel(headers, new WebSocketChannel(socket));
        //     } catch (error) {
        //         socket.close(undefined, 'Failed to join room');
        //         this.logger.error('Web socket connection failed', error);
        //     }
        // });
        const io = new Server(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });
        io.on('connection', async socket => {
            const headers = socket.request.headers as Record<string, string>;
            try {
                await this.connectChannel(headers, new SocketIoChannel(socket));
            } catch (error) {
                socket.disconnect(true);
                this.logger.error('Socket IO connection failed', error);
            }
        });
        httpServer.listen(Number(opts.port), String(opts.hostname));

        for (const authEndpoint of this.authEndpoints) {
            if (authEndpoint.shouldActivate()) {
                authEndpoint.onStart(app, String(opts.hostname), Number(opts.port));
                authEndpoint.onDidAuthenticate(async event => {
                    try {
                        await this.credentials.confirmUser(event.token, event.userInfo);
                    } catch (err) {
                        this.logger.error('Failed to confirm user', err);
                        throw new Error('Failed to confirm user');
                    }
                });
            }
        }

        this.logger.info(`Open Collaboration Server listening on ${opts.hostname}:${opts.port}`);
    }

    protected async connectChannel(headers: Record<string, string | undefined>, channel: TransportChannel): Promise<void> {
        const jwt = headers['x-oct-jwt'];
        if (!jwt) {
            throw this.logger.createErrorAndLog('No JWT auth token set');
        }
        const publicKey = headers['x-oct-public-key'];
        if (!publicKey) {
            throw this.logger.createErrorAndLog('No encryption key set');
        }
        let compression = headers['x-oct-compression']?.split(',');
        if (compression === undefined || compression.length === 0) {
            compression = ['none'];
        }
        const client = headers['x-oct-client'] ?? 'unknown';
        const roomClaim = await this.credentials.verifyJwt(jwt, isRoomClaim);
        const existingPeer = this.peerManager.getPeer(jwt);
        if (existingPeer) {
            // If a peer with the same JWT already exists, we just update the channel
            // This indicates that a client has reconnected
            existingPeer.channel.transport = channel;
        } else {
            const peer = this.peerFactory({
                jwt,
                user: roomClaim.user,
                host: roomClaim.host ?? false,
                channel,
                client,
                publicKey,
                supportedCompression: compression
            });
            this.peerManager.register(peer);
            await this.roomManager.join(peer, roomClaim.room);
        }
    }

    protected async getUserFromAuth(req: express.Request): Promise<User | undefined> {
        const auth = (req.headers['x-oct-jwt'] ?? req.cookies?.['oct-jwt']) as string;
        try {
            const user = await this.credentials.getUser(auth);
            return user;
        } catch {
            return undefined;
        }
    }

    protected setupApiRoute(): express.Express {
        const app = express();
        app.use(express.json());
        app.use(cookieParser());

        const allowedOrigins = this.configuration.getValue('oct-cors-allowed-origins')?.split(',') ?? '*';
        app.use((req, res, next) => {
            if(req.headers?.origin && allowedOrigins !== '*' && !allowedOrigins.includes(req.headers.origin)) {
                res.status(403);
                res.send('Origin not allowed');
                return;
            }
            res.header('Access-Control-Allow-Origin', req.headers.origin ?? '*');
            res.header('Access-Control-Allow-Credentials', 'true');
            res.header('Access-Control-Allow-Headers', '*');
            next();
        });
        app.use(async (req, res, next) => {
            if (req.method === 'POST' && req.url.startsWith('/api/session/')) {
                const user = await this.getUserFromAuth(req);
                if (!user) {
                    res.status(403);
                    res.send('Forbidden resource');
                } else {
                    next();
                }
            } else {
                next();
            }
        });
        app.use(express.static(path.resolve(getLocalDirectory(import.meta.url), '../src/static')));
        const loginPageUrlConfig = this.configuration.getValue('oct-login-page-url') ?? '';

        app.post('/api/login/initial', async (req, res) => {
            try {
                const token = await this.credentials.startAuth();
                let loginPage: string;
                try {
                    const loginPageURL = new URL(loginPageUrlConfig);
                    loginPageURL.searchParams.set('token', token);
                    loginPage = loginPageURL.toString();
                } catch (_error) {
                    loginPage = `/login.html?token=${encodeURIComponent(token)}`;
                }
                // Ensure that we don't send inactive auth providers to the client
                const activeAuthProviders = this.authEndpoints.filter(e => e.shouldActivate());
                const result: LoginInitialResponse = {
                    pollToken: token,
                    auth: {
                        loginPageUrl: loginPage,
                        providers: activeAuthProviders.map(endpoint => endpoint.getProtocolProvider()),
                        defaultSuccessUrl: this.configuration.getValue('oct-login-success-url') ?? ''
                    }
                };
                res.status(200);
                res.send(result);
            } catch (error) {
                this.logger.error('Error occurred during login', error);
                res.status(400);
                res.send('Failed to login');
            }
        });
        app.post('/api/login/validate', async (req, res) => {
            const user = await this.getUserFromAuth(req);
            const result: LoginValidateResponse = {
                valid: !!user
            };
            res.status(200);
            res.send(result);
        });
        // for preflight requests
        app.options('/api/login/poll/:token', (req, res) => {
            res.header('Access-Control-Allow-Headers', 'content-type');
            res.header('Access-Control-Allow-Methods', 'POST');
            res.send();
        });
        app.post('/api/login/poll/:token', async (req, res) => {
            try {
                const authTimeoutResponse: InfoMessage = {
                    code: 'AuthTimeout',
                    params: [],
                    message: 'Authentication timed out'
                };
                const token = req.params.token;
                const delayedAuth = await this.credentials.getAuth(token);
                if (!delayedAuth) {
                    res.status(400);
                    res.send(authTimeoutResponse);
                    return;
                }

                const sendToken = (token: string) => {
                    const result: LoginPollResponse = {
                        loginToken: token
                    };
                    res.status(200);
                    res.send(result);
                };

                const addCookieHeader = (token: string) => {
                    res.cookie('oct-jwt', token, {
                        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
                        httpOnly: true,
                        secure: true,
                        sameSite: 'none'
                    });
                    res.header('Access-Control-Allow-Credentials', 'true');
                    res.header('Access-Control-Allow-Origin', req.headers.origin ?? '*');
                };

                if (delayedAuth.jwt) {
                    req.query?.useCookie && addCookieHeader(delayedAuth.jwt);
                    sendToken(delayedAuth.jwt);
                    delayedAuth.dispose();
                } else {
                    const end = async (value?: string | Error | undefined) => {
                        clearTimeout(timeout);
                        update.dispose();
                        failure.dispose();
                        if (value === undefined) {
                            // No content
                            res.status(204);
                            res.send({});
                        } else if (typeof value === 'string') {
                            req.query?.useCookie && addCookieHeader(value);
                            sendToken(value);
                        } else {
                            res.status(400);
                            res.send(authTimeoutResponse);
                            delayedAuth.dispose();
                        }
                    };
                    const timeout = setTimeout(() => {
                        end(undefined);
                    }, 30_000);
                    const update = delayedAuth.onUpdate(jwt => end(jwt));
                    const failure = delayedAuth.onFail(err => end(err));
                }
            } catch (error) {
                this.logger.error('Error occurred during login token confirmation', error);
                res.status(500);
                res.send({
                    code: 'AuthInternalError',
                    params: [],
                    message: 'Internal authentication server error'
                });
            }
        });
        app.get('/api/meta', async (_, res) => {
            const data: ProtocolServerMetaData = {
                owner: this.configuration.getValue('oct-server-owner') ?? 'Unknown',
                version: VERSION,
                transports: [
                    // 'websocket',
                    'socket.io'
                ],
            };
            res.send(data);
        });
        // only required for when using cookie based authentication
        app.get('/api/logout', async (req, res) => {
            const user = await this.getUserFromAuth(req);
            if (user) {
                res.clearCookie('oct-jwt', {sameSite: 'none', secure: true, httpOnly: true});
                res.status(200);
                res.send('Logged out');
            } else {
                res.status(400);
                res.send('no auth token cookie set or user for token not found');
            }
        });
        app.post('/api/session/join/:room', async (req, res) => {
            try {
                const roomId = req.params.room;
                const user = await this.getUserFromAuth(req);
                const room = this.roomManager.getRoomById(roomId);
                if (!room) {
                    this.logger.warn(`User tried joining non-existing room with id '${roomId}'`);
                    res.status(404);
                    const roomNotFound: InfoMessage = {
                        code: 'RoomNotFound',
                        params: [],
                        message: 'Room not found'
                    };
                    res.send(roomNotFound);
                    return;
                }
                const result = await this.roomManager.requestJoin(room, user!);
                res.status(200);
                const response: JoinRoomInitialResponse = {
                    pollToken: result,
                    roomId: roomId
                };
                res.send(response);
            } catch (error) {
                this.logger.error('Error occurred while joining a room', error);
                res.status(500);
                res.send('An internal server error occurred');
            }
        });
        app.post('/api/session/poll/:token', async (req, res) => {
            try {
                const joinToken = req.params.token;
                const poll = this.roomManager.pollJoin(joinToken);
                if (!poll) {
                    res.status(404);
                    const joinNotFound: InfoMessage = {
                        code: 'JoinRequestNotFound',
                        params: [],
                        message: 'Join request not found or requested timed out'
                    };
                    res.send(joinNotFound);
                    return;
                }

                if (poll.result) {
                    res.status(200);
                    res.send(poll.result);
                    if (JoinRoomPollResponse.is(poll.result)) {
                        poll.result = undefined;
                    }
                    // Don't dispose the result here, as it might be used for polling
                    // It will be disposed after 5 minutes anyway
                    return;
                }

                const end = async (value?: JoinRoomResponse | RoomJoinInfo) => {
                    clearTimeout(timeout);
                    update.dispose();
                    if (value === undefined) {
                        // No content
                        res.status(204);
                        res.send({});
                    } else {
                        res.status(200);
                        res.send(value);
                        if ('failure' in value) {
                            poll.result = undefined;
                        }
                    }
                };
                const timeout = setTimeout(() => {
                    end(undefined);
                }, 30_000);
                const update = poll.onUpdate(response => end(response));
            } catch (error) {
                this.logger.error('Error occurred while joining a room', error);
                res.status(500);
                res.send('An internal server error occurred');
            }
        });
        app.post('/api/session/create', async (req, res) => {
            try {
                const user = await this.getUserFromAuth(req);
                const room = await this.roomManager.prepareRoom(user!);
                const response: CreateRoomResponse = {
                    roomId: room.id,
                    roomToken: room.jwt
                };
                res.send(response);
            } catch (error) {
                this.logger.error('Error occurred when creating a room', error);
                res.status(400);
                res.send('Failed to create room');
            }
        });
        return app;
    }

}
