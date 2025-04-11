// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { injectable } from 'inversify';
import { CollaborationInstance } from './collaboration-instance.js';

@injectable()
export class ContextKeyService {

    set(key: string, value: any) {
        vscode.commands.executeCommand(
            'setContext',
            key,
            value
        );
    }

    setConnection(instance: CollaborationInstance | undefined): void {
        this.set('oct.connection', !!instance);
        this.set('oct.roomId', instance?.roomId);
    }

    setFollowing(following: boolean): void {
        this.set('oct.following', following);
    }

}
