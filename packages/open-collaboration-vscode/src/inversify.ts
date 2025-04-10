// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { Container } from 'inversify';
import { CollaborationInstance, CollaborationInstanceFactory, CollaborationInstanceOptions } from './collaboration-instance.js';

export const ExtensionContext = Symbol('ExtensionContext');

export function createContainer(context: vscode.ExtensionContext) {
    const container = new Container({
        autoBindInjectable: true,
        defaultScope: 'Singleton'
    });
    container.bind(ExtensionContext).toConstantValue(context);
    container.bind(CollaborationInstanceFactory).toFactory(ctx => (options: CollaborationInstanceOptions) => {
        if (CollaborationInstance.Current) {
            throw new Error('Only one collaboration instance can be active at a time');
        }
        const child = ctx.container.createChild();
        child.bind(CollaborationInstance).toSelf();
        child.bind(CollaborationInstanceOptions).toConstantValue(options);
        return child.get(CollaborationInstance);
    });
    return container;
}
