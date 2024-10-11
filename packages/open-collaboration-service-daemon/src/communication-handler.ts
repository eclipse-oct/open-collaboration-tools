// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { Emitter } from 'open-collaboration-protocol';
import { FromDaeomonMessage, ToDaemonMessage } from './messages';

export class StdioCommunicationHandler {
    protected readonly onMessageEmitter: Emitter<ToDaemonMessage> = new Emitter<ToDaemonMessage>();
    onMessage = this.onMessageEmitter.event;

    constructor() {
        process.stdin.on('data', (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString('utf-8'));
                this.onMessageEmitter.fire(message);
            } catch (error: any) {
                this.sendMessage({ kind: 'error', message: error?.message });
            }
        });
    }

    sendMessage(message: FromDaeomonMessage): void {
        const messageJson = JSON.stringify(message);
        process.stdout.write(messageJson, 'utf8');
    }
}