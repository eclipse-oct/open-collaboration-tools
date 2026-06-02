// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************
import * as React from 'react';
import { ChatMessage, getUsers, isWriting, sendMessage, usersChanged } from '../messages';
import { Messenger } from 'vscode-messenger-webview';
import { Button, ButtonGroup, Menu, MenuItem, TextArea } from 'baukasten-ui';
import { useState } from 'react';
import { PeerWithColor } from '../../collaboration-instance';
import { getColorCss } from './utils';
import { throttle } from 'lodash';

const MAX_INPUT_ROWS = 4;

const WRITING_NOTIFICATION_DEBOUNCE_MS = 2000;
const WRITING_NOTIFICATION_SEND_THROTTLE_MS = 1000;

export type MessageInputProps = {
    messenger: Messenger;
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
};

export function MessageInput({ messenger, setMessages }: MessageInputProps) {
    const [input, setInput] = useState('');
    const [directMessageOpen, setDirectMessageOpen] = useState(false);
    const [users, setUsers] = useState<PeerWithColor[]>([]);
    const [usersWriting, setUsersWriting] = useState<Record<string, NodeJS.Timeout>>({});

    React.useEffect(() => {

        messenger.sendRequest(getUsers, { type: 'extension' }).then((users) => {
            setUsers(users);
        });

        const onUsersChanged = messenger.onNotification(
            usersChanged,
            (users) => {
                setUsers(users);
            },
        );

        const onIsWriting = messenger.onNotification(
            isWriting,
            (userId) => {
                if(!userId) {
                    return;
                }

                setUsersWriting((prev) => {
                    if (prev[userId]) {
                        clearTimeout(prev[userId]);
                    }
                    const timeout = setTimeout(() => {
                        setUsersWriting((prev) => {
                            const newState = { ...prev };
                            delete newState[userId];
                            return newState;
                        });
                    }, WRITING_NOTIFICATION_DEBOUNCE_MS);
                    return { ...prev, [userId]: timeout };
                });
            });

        return () => {
            onUsersChanged.dispose();
            onIsWriting.dispose();
        };
    }, []);

    const sendChatMessage = React.useCallback(
        (target?: string) => {
            const trimmed = input.trim();
            if (trimmed) {
                // For demo, use 'me' as senderId. In real app, use actual user id.
                messenger.sendNotification(
                    sendMessage,
                    { type: 'extension' },
                    { message: trimmed, target },
                );
                setMessages((prev) => [
                    ...prev,
                    { user: 'me', message: trimmed, isDirect: !!target },
                ]);
                setInput('');
            }
        },
        [input, messenger],
    );

    const sendWritingNotification = React.useCallback(throttle(() => {
        messenger.sendNotification(isWriting, { type: 'extension' });
    }, WRITING_NOTIFICATION_SEND_THROTTLE_MS), [messenger]);

    return (
        <div className="messageInputContainer">
            <div className='inputArea'>
                {Object.keys(usersWriting).length > 0 && (
                    <div className="writingIndicator">
                        {Object.keys(usersWriting).map((userId) => {
                            const user = users.find((u) => u.id === userId);
                            return user ? user.name : 'Unknown';
                        }).join(', ')}
                        {Object.keys(usersWriting).length === 1 ? ' is writing...' : ' are writing...'}
                    </div>
                )}
                <TextArea
                    className="messageInput"
                    value={input}
                    resize="none"
                    rows={Math.min(MAX_INPUT_ROWS, input.split('\n').length || 1)}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                        setInput(e.target.value);
                        sendWritingNotification();
                    }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
            </div>
            <ButtonGroup className="sendButtonGroup">
                <Button
                    className="sendButton"
                    onClick={() => sendChatMessage()}
                >
                    Send
                </Button>
                {users.length > 0 && (
                    <ButtonGroup.Dropdown
                        variant="primary"
                        open={directMessageOpen}
                        onOpenChange={setDirectMessageOpen}
                        content={
                            <Menu>
                                {users.map((user) => (
                                    <MenuItem
                                        key={user.id}
                                        onClick={() => sendChatMessage(user.id)}
                                    >
                                        to{' '}
                                        <span
                                            style={{
                                                color: getColorCss(user.color),
                                            }}
                                        >
                                            {user.name}
                                        </span>
                                    </MenuItem>
                                ))}
                            </Menu>
                        }
                    />
                )}
            </ButtonGroup>
        </div>
    );
}
