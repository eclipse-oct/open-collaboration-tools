// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { CryptoModule, setCryptoModule } from './utils/crypto.js';

export type InitializationConfig = {
    cryptoModule: CryptoModule
};

export const initializeProtocol = (config: InitializationConfig) => {
    setCryptoModule(config.cryptoModule);
};
