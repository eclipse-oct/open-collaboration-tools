// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Container, ContainerModule } from 'inversify';
import { CollaborationServer } from './collaboration-server.js';
import { CredentialsManager } from './credentials-manager.js';
import { MessageRelay } from './message-relay.js';
import { PeerFactory, PeerImpl } from './peer.js';
import { RoomManager } from './room-manager.js';
import { PeerInfo } from './types.js';
import { UserManager } from './user-manager.js';
import { ConsoleLogger, Logger } from './utils/logging.js';
import { SimpleLoginEndpoint } from './auth-endpoints/simple-login-endpoint.js';
import { AuthEndpoint } from './auth-endpoints/auth-endpoint.js';
import { GitHubOAuthEndpoint, GoogleOAuthEndpoint  } from './auth-endpoints/oauth-endpoint.js';
import { Configuration, DefaultConfiguration } from './utils/configuration.js';
import { PeerManager } from './peer-manager.js';
import { KeycloakOAuthEndpoint } from './auth-endpoints/keycloak-endpoint.js';

/**
 * This is the default dependency injection container module for the Open Collaboration Server.
 * You can override the default bindings by providing a custom container module for your own server.
 */
export default new ContainerModule(bind => {
    bind(Logger).to(ConsoleLogger).inSingletonScope();
    bind(DefaultConfiguration).toSelf().inSingletonScope();
    bind(Configuration).toService(DefaultConfiguration);
    bind(CollaborationServer).toSelf().inSingletonScope();
    bind(RoomManager).toSelf().inSingletonScope();
    bind(CredentialsManager).toSelf().inSingletonScope();
    bind(UserManager).toSelf().inSingletonScope();
    bind(MessageRelay).toSelf().inSingletonScope();
    bind(PeerImpl).toSelf().inTransientScope();
    bind(PeerFactory).toFactory(context => (peerInfo: PeerInfo) => {
        const child = new Container();
        child.parent = context.container;
        child.bind(PeerInfo).toConstantValue(peerInfo);
        return child.get(PeerImpl);
    });
    bind(PeerManager).toSelf().inSingletonScope();

    bind(SimpleLoginEndpoint).toSelf().inSingletonScope();
    bind(AuthEndpoint).toService(SimpleLoginEndpoint);
    bind(GitHubOAuthEndpoint).toSelf().inSingletonScope();
    bind(AuthEndpoint).toService(GitHubOAuthEndpoint);
    bind(GoogleOAuthEndpoint).toSelf().inSingletonScope();
    bind(AuthEndpoint).toService(GoogleOAuthEndpoint);
    bind(KeycloakOAuthEndpoint).toSelf().inSingletonScope();
    bind(AuthEndpoint).toService(KeycloakOAuthEndpoint);
});
