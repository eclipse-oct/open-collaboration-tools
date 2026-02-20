// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Messenger, VsCodeApi } from 'vscode-messenger-webview';
import {
    ChatMessage,
    getHistory,
    messageReceived,
} from '../messages';
import '../../../../../node_modules/baukasten-ui/dist/baukasten-base.css';
import '../../../../../node_modules/baukasten-ui/dist/baukasten-vscode.css';
import './styles.css';
import { MessageInput } from './message-input';
import { getColorCss } from './utils';

declare const acquireVsCodeApi: () => VsCodeApi;

const vscodeApi = acquireVsCodeApi();
const messenger = new Messenger(vscodeApi);
messenger.start();

window.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('root');
    if (container) {
        const root = createRoot(container);
        root.render(<App />);
    }
});

const SCROLL_THRESHOLD_PX = 80;

let inSetupStage = true;

function App() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const messagesRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messenger
            .sendRequest(getHistory, { type: 'extension' })
            .then((history) => {
                setMessages(history);
            });

        const onMessage =  messenger.onNotification(
            messageReceived,
            (message) => {
                inSetupStage = false;
                setMessages((prev) => [...prev, message]);
            },
        );

        return () => onMessage.dispose();
    }, []);

    React.useEffect(() => {
        if (messagesRef.current) {
            const isAtBottom =
                messagesRef.current.scrollHeight -
                    messagesRef.current.scrollTop <=
                messagesRef.current.clientHeight + SCROLL_THRESHOLD_PX;
            // only scroll to bottom if the message is ours or scroll was already at bottom
            if (
                inSetupStage ||
                messages[messages.length - 1]?.user === 'me' ||
                isAtBottom
            ) {
                messagesRef.current.scroll({
                    top: messagesRef.current.scrollHeight,
                    behavior: inSetupStage ? 'instant' : 'smooth',
                });
            }
        }
    }, [messages]);

    return (
        <div className="chat-container">
            <h2 className="title">Session Chat</h2>
            <div className="messages-container" ref={messagesRef}>
                {messages.map((msg, idx) => (
                    <div key={idx} className="message">
                        <span style={{ color: getColorCss(msg.color) }}>
                            {msg.user}{msg.isDirect ? '*' : ''}:
                        </span>
                        <pre>{msg.message}</pre>
                    </div>
                ))}
            </div>
            <MessageInput messenger={messenger} setMessages={setMessages} />
        </div>
    );
}
