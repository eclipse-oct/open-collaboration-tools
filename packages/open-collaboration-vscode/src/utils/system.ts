// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';

export function isWeb(): boolean {
    return !(typeof process === 'object' && Boolean(process.versions.node)) && vscode.env.uiKind === vscode.UIKind.Web;
}

/**
 * Returns a promise that resolves after the specified number of milliseconds.
 * @param ms The number of milliseconds to wait before resolving the promise. Default is 500 ms.
 */
export function timeout(ms = 500): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), ms);
    });
}