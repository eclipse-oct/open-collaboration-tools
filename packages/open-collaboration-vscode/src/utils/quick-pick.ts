// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';

export interface QuickPickItem<T> extends vscode.QuickPickItem {
    key: T;
}

export interface QuickPickOptions<T> {
    /**
	 * Optional placeholder shown in the filter textbox when no filter has been entered.
	 */
    placeholder?: string;
    /**
     * Buttons for actions in the UI.
     */
    buttons?: readonly vscode.QuickInputButton[];

    /**
     * An event signaling when a button in the title bar was triggered.
     * This event does not fire for buttons on a {@link QuickPickItem}.
     */
    readonly onDidTriggerButton?: () => vscode.Event<vscode.QuickInputButton>;

    /**
     * An event signaling when a button in a particular {@link QuickPickItem} was triggered.
     * This event does not fire for buttons in the title bar.
     */
    readonly onDidTriggerItemButton?: () => vscode.QuickPickItemButtonEvent<QuickPickItem<T>>;

    /**
     * If the filter text should also be matched against the description of the items. Defaults to false.
     */
    matchOnDescription?: boolean;

    /**
     * If the filter text should also be matched against the detail of the items. Defaults to false.
     */
    matchOnDetail?: boolean;

    /**
     * An optional flag to maintain the scroll position of the quick pick when the quick pick items are updated. Defaults to false.
     */
    keepScrollPosition?: boolean;
}

export function showQuickPick<T>(quickPick: Array<QuickPickItem<T>>, options?: QuickPickOptions<T>): Promise<T | undefined>;
export function showQuickPick<T>(quickPick: vscode.QuickPick<QuickPickItem<T>>): Promise<T | undefined>;
export function showQuickPick<T>(quickPick: vscode.QuickPick<QuickPickItem<T>> | Array<QuickPickItem<T>>, options?: QuickPickOptions<T>): Promise<T | undefined> {
    if (Array.isArray(quickPick)) {
        const items = quickPick;
        quickPick = vscode.window.createQuickPick<QuickPickItem<T>>();
        quickPick.items = items;
        if (options) {
            quickPick.placeholder = options.placeholder;
            quickPick.buttons = options.buttons ?? [];
            if (options.onDidTriggerButton)
                quickPick.onDidTriggerButton(options.onDidTriggerButton);
            if (options.onDidTriggerItemButton)
                quickPick.onDidTriggerItemButton(options.onDidTriggerItemButton);
            quickPick.matchOnDescription = options.matchOnDescription ?? false;
            quickPick.matchOnDetail = options.matchOnDetail ?? false;
            quickPick.keepScrollPosition = options.keepScrollPosition ?? false;
        }
    }
    const pick = quickPick;
    return new Promise((resolve) => {
        pick.show();
        pick.onDidAccept(() => {
            resolve(pick.activeItems[0].key);
            pick.hide();
        });
        pick.onDidHide(() => {
            resolve(undefined);
        });
    });
}
