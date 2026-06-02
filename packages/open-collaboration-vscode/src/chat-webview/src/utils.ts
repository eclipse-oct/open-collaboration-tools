// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

export function getColorCss(color: string | undefined): string {
    if (!color) {
        return 'var(--vscode-foreground)';
    }

    if (color.startsWith('#') || color.startsWith('rgb(')) {
        return color;
    }

    const parts = color.split('.');
    return `var(--vscode-oct-user\\.${parts[parts.length - 1]})`;
}
