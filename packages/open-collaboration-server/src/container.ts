// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Container, ContainerModule } from 'inversify';
import { CollaborationServer } from './collaboration-server';
import { CredentialsManager } from './credentials-manager';
import { MessageRelay } from './message-relay';
import { PeerFactory, PeerImpl } from './peer';
import { RoomManager } from './room-manager';
import { PeerInfo } from './types';
import { UserManager } from './user-manager';
import { ConsoleLogger, LogLevel, LogLevelSymbol, LoggerSymbol } from './utils/logging';
import { SimpleLoginEndpoint } from './auth-endpoints/simple-login-endpoint';
import { AuthEndpoint } from './auth-endpoints/auth-endpoint';
import { GitHubOAuthEndpoint, GoogleOAuthEndpoint, GitlabOAuthEndpoint } from './auth-endpoints/oauth-endpoint';
import { Configuration, DefaultConfiguration } from './utils/configuration';
import { PeerManager } from './peer-manager';

export default new ContainerModule(bind => {
    bind(LoggerSymbol).to(ConsoleLogger).inSingletonScope();
    bind(LogLevelSymbol).toConstantValue(LogLevel.info);
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
    bind(GitlabOAuthEndpoint).toSelf().inSingletonScope();
    bind(AuthEndpoint).toService(GitlabOAuthEndpoint);
});
