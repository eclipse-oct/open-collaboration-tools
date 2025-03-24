// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as monaco from 'monaco-editor';
import { monacoCollab } from './monaco-api.js';
import { User } from 'open-collaboration-protocol';

const value = '';

// /* set from `myEditor.getModel()`: */ `function hello() {
// 	alert('Hello Blah!');
// }`;

const container = document.getElementById('container');
if (container) {
    const myEditor = monaco.editor.create(container, {
        value,
        language: 'javascript'
    });

    const monacoCollabApi = monacoCollab({
        serverUrl: 'http://0.0.0.0:8100',
        callbacks: {
            onUserRequestsAccess: (user: User) => {
                console.log('User requests access', user);
                return Promise.resolve(true);
            }
        }
    });

    // on click of button with id create create room, call createRoom, take the value from response and set it in textfield with id token
    const createRoomButton = document.getElementById('create');
    createRoomButton?.addEventListener('click', () => {
        monacoCollabApi.createRoom().then(token => {
            if (token) {
                monacoCollabApi.setEditor(myEditor);
                (document.getElementById('token') as HTMLInputElement).value = token ?? '';
            }
        });
    });

    // on click of join room button take value from textfield with id room and call joinRoom
    const joinRoomButton = document.getElementById('join');
    joinRoomButton?.addEventListener('click', () => {
        const roomToken = (document.getElementById('room') as HTMLInputElement).value;
        monacoCollabApi.joinRoom(roomToken).then(state => {
            if (state) {
                monacoCollabApi.setEditor(myEditor);
                monacoCollabApi.onUsersChanged(() => {
                    monacoCollabApi.getUserData().then(userData => {
                        const host = userData?.others.find(u => u.peer.host);
                        if (host && monacoCollabApi.getFollowedUser() === undefined) {
                            monacoCollabApi.followUser(host.peer.id);
                        }
                    });
                });
            }
            console.log('Joined room');
        });
    });

    // on click of button with id login call login
    const loginButton = document.getElementById('login');
    loginButton?.addEventListener('click', () => {
        monacoCollabApi.login().then((userAuthToken?: string) => {
            let loginText = 'Failed to login';
            if (userAuthToken) {
                loginText = 'Successfully logged in';
            }
            document.getElementById('user')!.innerText = loginText;
        });
    });
}
