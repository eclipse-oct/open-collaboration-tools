// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Messenger, VsCodeApi } from 'vscode-messenger-webview';
import { ChatMessage, getHistory, messageReceived, sendMessage } from '../messages';
import './styles.css';
import '../../../../../node_modules/baukasten-ui/dist/baukasten-base.css';
import '../../../../../node_modules/baukasten-ui/dist/baukasten-vscode.css';
import { Button, TextArea } from 'baukasten-ui';

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
    const [input, setInput] = useState('');
    const messagesRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Listen for incoming chat messages

        messenger.sendRequest(getHistory, { type: 'extension' }).then((history) => {
            setMessages(history);
        });

        const disposable = messenger.onNotification(messageReceived, (message) => {
            inSetupStage = false;
            setMessages(prev => [...prev, message]);
        });
        return () => disposable.dispose();
    }, []);

    const sendChatMessage = () => {
        inSetupStage = false;
        const trimmed = input.trim();
        if (trimmed) {
            // For demo, use 'me' as senderId. In real app, use actual user id.
            messenger.sendNotification(sendMessage, { type: 'extension' }, { message: trimmed });
            setMessages(prev => [...prev, { user: 'me', message: trimmed }]);
            setInput('');
        }
    };

    React.useEffect(() => {
        if (messagesRef.current) {
            const isAtBottom = (messagesRef.current.scrollHeight - messagesRef.current.scrollTop)
                <= (messagesRef.current.clientHeight + SCROLL_THRESHOLD_PX);
            // only scroll to bottom if the message is ours or scroll was already at bottom
            if(inSetupStage || messages[messages.length -1]?.user === 'me' || isAtBottom) {
                messagesRef.current.scroll({
                    top: messagesRef.current.scrollHeight,
                    behavior: inSetupStage ? 'instant' : 'smooth'
                });
            }

        }
    }, [messages]);

    return (
        <div className='chat-container'>
            <h2 className='title'>Session Chat</h2>
            <div className='messages-container' ref={messagesRef}>
                {messages.map((msg, idx) => (
                    <div key={idx} className='message'>
                        <span style={{ color: getColorCss(msg.color) }}>{msg.user}:</span>
                        <pre>{msg.message}</pre>
                    </div>
                ))}
            </div>
            <div className='inputArea'>
                <TextArea
                    value={input}
                    resize='none'
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                        if(e.key === 'Enter' && e.ctrlKey) {
                            e.preventDefault();
                            sendChatMessage();
                        }
                    }}
                    placeholder="Type a message..."
                />
                <Button onClick={() => sendChatMessage()} >Send</Button>
            </div>
        </div>
    );
}

function getColorCss(color: string | undefined): string {
    if(!color) {
        return 'var(--vscode-foreground)';
    }

    if (color.startsWith('#') || color.startsWith('rgb(')) {
        return color;
    }

    const parts = color.split('.');
    return `var(--vscode-oct-user\\.${parts[parts.length - 1]})`;
}
