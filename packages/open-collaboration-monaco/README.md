# open-collaboration-monaco

A TypeScript library that enables real-time collaborative editing in Monaco Editor.

## Overview

This package provides a seamless integration between Monaco Editor and real-time collaboration features, allowing multiple users to edit code simultaneously with features like:
- Real-time cursor and selection sharing
- User presence indicators
- User following
- Room-based collaboration

## Installation

```bash
npm install open-collaboration-monaco
```

## API Reference

### Methods

#### Room Management
- `createRoom()`: Creates a new collaboration room and returns the room token
- `joinRoom(roomToken)`: Joins an existing room using the provided token

#### User Management
- `login()`: Authenticates the user and returns the user token
- `isLoggedIn()`: Checks if the user is currently authenticated
- `getUserData()`: Retrieves the current user's data

#### Editor Integration
- `setEditor(editor)`: Connects a Monaco Editor instance to the collaboration features

#### Collaboration Features
- `onUsersChanged(evt)`: Registers a callback for user presence changes
- `followUser(id?)`: Sets the user to follow (pass undefined to stop following)
- `getFollowedUser()`: Returns the ID of the currently followed user

## Configuration Options

The `MonacoCollabApi` constructor accepts the following options:

### Required Options

- `serverUrl`: The URL of your collaboration server. This is where the API will connect to for real-time communication.
- `callbacks`: An object containing callback functions for various events. See the Callbacks section below for details.

### Optional Options

- `userToken`: If you already have a user authentication token, you can provide it here to skip the login process.
- `roomToken`: If you want to join a specific room immediately, provide the room token here.
- `loginPageOpener`: A custom function to handle the opening of the login page. This is useful if you need to customize how the login flow works in your application.

## Usage Example

```typescript
import { MonacoCollabApi } from 'open-collaboration-monaco';

// Initialize the API
const collabApi = new MonacoCollabApi({
    serverUrl: 'https://your-collab-server.com',
    callbacks: {
        onUserRequestsAccess: ...
    },
    loginPageOpener: (url, token) => {
        // Custom login page handling
        window.open(url, '_blank');
    }
});

// Create or join a room
const roomToken = await collabApi.createRoom();

// Set up your Monaco editor
const editor = monaco.editor.create(/* ... */);
collabApi.setEditor(editor);

// Handle user changes
collabApi.onUsersChanged((event) => {
    console.log('Users in room:', event.users);
});
```

## License

MIT License - see LICENSE file for details