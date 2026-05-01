// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { ProtocolBroadcastConnection } from 'open-collaboration-protocol';
import * as vscode from 'vscode';
import type { NotifyHandler, RequestHandler, SharedService, SharedServiceProxy } from 'vsls/vscode';

const REQUEST_PREFIX = '$oct.vsls.service.request';
const HOST_NOTIFY_PREFIX = '$oct.vsls.service.notify.host';
const GUEST_NOTIFY_PREFIX = '$oct.vsls.service.notify.guest';
const NOOP_CANCELLATION_TOKEN: vscode.CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({
        dispose() {
            // no-op
        },
    }),
};

function encodePart(value: string): string {
    return encodeURIComponent(value);
}

function requestMethod(serviceName: string, name: string): string {
    return `${REQUEST_PREFIX}:${encodePart(serviceName)}:${encodePart(name)}`;
}

function hostNotifyMethod(serviceName: string, name: string): string {
    return `${HOST_NOTIFY_PREFIX}:${encodePart(serviceName)}:${encodePart(name)}`;
}

function guestNotifyMethod(serviceName: string, name: string): string {
    return `${GUEST_NOTIFY_PREFIX}:${encodePart(serviceName)}:${encodePart(name)}`;
}

export class OctSharedService implements SharedService {

    private readonly onDidChangeIsServiceAvailableEmitter = new vscode.EventEmitter<boolean>();
    readonly onDidChangeIsServiceAvailable = this.onDidChangeIsServiceAvailableEmitter.event;

    private available: boolean;
    private readonly requestHandlers = new Map<string, RequestHandler>();
    private readonly notifyHandlers = new Map<string, NotifyHandler[]>();
    private readonly notifyMethodRegistered = new Set<string>();

    constructor(
        private readonly connection: ProtocolBroadcastConnection,
        private readonly serviceName: string,
        initialAvailability: boolean,
    ) {
        this.available = initialAvailability;
    }

    get isServiceAvailable(): boolean {
        return this.available;
    }

    setAvailable(available: boolean): void {
        if (this.available === available) {
            return;
        }
        this.available = available;
        this.onDidChangeIsServiceAvailableEmitter.fire(available);
    }

    deactivate(): void {
        this.setAvailable(false);
        this.requestHandlers.clear();
        this.notifyHandlers.clear();
    }

    onRequest(name: string, handler: RequestHandler): void {
        const method = requestMethod(this.serviceName, name);
        this.requestHandlers.set(name, handler);
        this.connection.onRequest(method, async (_origin, ...parameters) => {
            if (!this.available) {
                throw new Error(`Shared service '${this.serviceName}' is not available.`);
            }
            const requestHandler = this.requestHandlers.get(name);
            if (!requestHandler) {
                throw new Error(`No request handler registered for '${name}'.`);
            }
            return requestHandler(parameters, NOOP_CANCELLATION_TOKEN);
        });
    }

    onNotify(name: string, handler: NotifyHandler): void {
        const method = hostNotifyMethod(this.serviceName, name);
        const handlers = this.notifyHandlers.get(name) ?? [];
        handlers.push(handler);
        this.notifyHandlers.set(name, handlers);

        if (!this.notifyMethodRegistered.has(name)) {
            this.notifyMethodRegistered.add(name);
            this.connection.onNotification(method, (_origin, args) => {
                const listeners = this.notifyHandlers.get(name) ?? [];
                for (const listener of listeners) {
                    listener(args as object);
                }
            });
        }
    }

    notify(name: string, args: object): void {
        if (!this.available) {
            return;
        }
        void this.connection.sendBroadcast(guestNotifyMethod(this.serviceName, name), args);
    }
}

export class OctSharedServiceProxy implements SharedServiceProxy {

    private readonly onDidChangeIsServiceAvailableEmitter = new vscode.EventEmitter<boolean>();
    readonly onDidChangeIsServiceAvailable = this.onDidChangeIsServiceAvailableEmitter.event;

    private available: boolean;
    private hostPeerId: string | undefined;
    private readonly notifyHandlers = new Map<string, NotifyHandler[]>();
    private readonly notifyMethodRegistered = new Set<string>();

    constructor(
        private readonly connection: ProtocolBroadcastConnection,
        private readonly serviceName: string,
        hostPeerId: string | undefined,
        initialAvailability: boolean,
    ) {
        this.hostPeerId = hostPeerId;
        this.available = initialAvailability;
    }

    get isServiceAvailable(): boolean {
        return this.available;
    }

    setHostPeerId(hostPeerId: string | undefined): void {
        this.hostPeerId = hostPeerId;
        this.setAvailable(this.available && Boolean(hostPeerId));
    }

    setAvailable(available: boolean): void {
        const normalized = available && Boolean(this.hostPeerId);
        if (this.available === normalized) {
            return;
        }
        this.available = normalized;
        this.onDidChangeIsServiceAvailableEmitter.fire(this.available);
    }

    onNotify(name: string, handler: NotifyHandler): void {
        const method = guestNotifyMethod(this.serviceName, name);
        const handlers = this.notifyHandlers.get(name) ?? [];
        handlers.push(handler);
        this.notifyHandlers.set(name, handlers);

        if (!this.notifyMethodRegistered.has(name)) {
            this.notifyMethodRegistered.add(name);
            this.connection.onBroadcast(method, (_origin, args) => {
                const listeners = this.notifyHandlers.get(name) ?? [];
                for (const listener of listeners) {
                    listener(args as object);
                }
            });
        }
    }

    async request(name: string, args: any[], _cancellation?: vscode.CancellationToken): Promise<any> {
        if (!this.available || !this.hostPeerId) {
            throw new Error(`Shared service '${this.serviceName}' is not available.`);
        }
        return this.connection.sendRequest(requestMethod(this.serviceName, name), this.hostPeerId, ...args);
    }

    notify(name: string, args: object): void {
        if (!this.available || !this.hostPeerId) {
            return;
        }
        void this.connection.sendNotification(hostNotifyMethod(this.serviceName, name), this.hostPeerId, args);
    }
}
