// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { NotificationType, RequestType } from 'vscode-messenger-common';
import { PeerWithColor } from '../collaboration-instance';

export type ChatMessage = {message: string, user: string, color?: string}

export const sendMessage: NotificationType<{message: string, target?: string}> = { method: 'chat/sendMessage' };

export const messageReceived: NotificationType<ChatMessage> = { method: 'chat/messageReceived' };

export const getHistory: RequestType<void, ChatMessage[]> = { method: 'chat/getHistory' };

export const getUsers: RequestType<void, PeerWithColor[]> = { method: 'chat/getUsers' };

export const usersChanged: NotificationType<PeerWithColor[]> = { method: 'chat/usersChanged' };
