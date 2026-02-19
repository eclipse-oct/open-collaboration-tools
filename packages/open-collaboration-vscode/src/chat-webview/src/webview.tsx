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
    getUsers,
    messageReceived,
    sendMessage,
    usersChanged,
} from '../messages';
import '../../../../../node_modules/baukasten-ui/dist/baukasten-base.css';
import '../../../../../node_modules/baukasten-ui/dist/baukasten-vscode.css';
import './styles.css';
import { Button, ButtonGroup, Menu, MenuItem, TextArea } from 'baukasten-ui';
import { PeerWithColor } from '../../collaboration-instance';

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
const MAX_INPUT_ROWS = 4;

let inSetupStage = true;

function App() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [users, setUsers] = useState<PeerWithColor[]>([]);
    const [input, setInput] = useState('');
    const [directMessageOpen, setDirectMessageOpen] = useState(false);
    const messagesRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Listen for incoming chat messages

        messenger
            .sendRequest(getHistory, { type: 'extension' })
            .then((history) => {
                setMessages(history);
            });

        messenger.sendRequest(getUsers, { type: 'extension' }).then((users) => {
            setUsers(users);
        });

        const onMessage =  messenger.onNotification(
            messageReceived,
            (message) => {
                inSetupStage = false;
                setMessages((prev) => [...prev, message]);
            },
        );

        const onUsersChanged = messenger.onNotification(
            usersChanged,
            (users) => {
                setUsers(users);
            },
        );

        return () =>{
            onMessage.dispose();
            onUsersChanged.dispose();
        };
    }, []);

    const sendChatMessage = (target?: string) => {
        inSetupStage = false;
        const trimmed = input.trim();
        if (trimmed) {
            // For demo, use 'me' as senderId. In real app, use actual user id.
            messenger.sendNotification(
                sendMessage,
                { type: 'extension' },
                { message: trimmed, target },
            );
            setMessages((prev) => [...prev, { user: 'me', message: trimmed, isDirect: !!target }]);
            setInput('');
        }
    };

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
            <div className="inputArea">
                <TextArea
                    className="messageInput"
                    value={input}
                    resize="none"
                    rows={Math.min(
                        MAX_INPUT_ROWS,
                        input.split('\n').length || 1,
                    )}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setInput(e.target.value)
                    }
                    onKeyDown={(
                        e: React.KeyboardEvent<HTMLTextAreaElement>,
                    ) => {
                        if (e.key === 'Enter' && e.ctrlKey) {
                            e.preventDefault();
                            sendChatMessage();
                        } else if (e.key === 'Enter' && e.altKey) {
                            e.preventDefault();
                            setDirectMessageOpen(true);
                        }
                    }}
                    placeholder="Type a message..."
                ></TextArea>
                <ButtonGroup className="sendButtonGroup">
                    <Button
                        className="sendButton"
                        onClick={() => sendChatMessage()}
                    >
                        Send
                    </Button>
                    { users.length > 0 && <ButtonGroup.Dropdown
                        variant="primary"
                        open={directMessageOpen}
                        onOpenChange={setDirectMessageOpen}
                        content={
                            <Menu>
                                {users.map((user) => (
                                    <MenuItem
                                        key={user.id}
                                        onClick={() =>
                                            sendChatMessage(user.id)
                                        }
                                    >
                                        <span>to {user.name}</span>
                                    </MenuItem>
                                ))}
                            </Menu>
                        }
                    />}
                </ButtonGroup>
            </div>
        </div>
    );
}

function getColorCss(color: string | undefined): string {
    if (!color) {
        return 'var(--vscode-foreground)';
    }

    if (color.startsWith('#') || color.startsWith('rgb(')) {
        return color;
    }

    const parts = color.split('.');
    return `var(--vscode-oct-user\\.${parts[parts.length - 1]})`;
}
