// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as packageJson from '../../package.json';

export { packageJson };
export const packageVersion: string = packageJson.version;
export const userColors: string[] = packageJson.contributes.colors
    .map((color: any) => color.id)
    .filter((id: string) => id.startsWith('oct.user.'));
