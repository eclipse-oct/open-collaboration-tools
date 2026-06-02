# Libr Live Collaboration Extension

Libr Live is a set of plugins and extensions for sharing an editor view, designed to support guided teamwork, pair programming, and remote collaboration. 

This is how it works: one person starts a collaboration session as host and invites others to join. The extension distributes the contents of the hostʼs workspace and highlights text selections and cursor positions of other participants. In parallel, they get together in their preferred meeting or chat app for immediate discussion. All participants see what the others are looking at and what changes they propose as they happen. This way of remote collaboration reduces confusion and maximizes productivity.

## Using the Extension
This extension supports the collaboration protocol used by the Libr Live services.

### Quickstart

The extension adds a new "Share" item to the status bar at the bottom of the editor, which allows managing your current sessions.

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/bf5769ab-508b-4a6a-a91e-48e9efa8d4a6" alt="share-icon" width="300"/>

### Hosting a session

1. Click on the share item in the status bar
2. A quickpick will open at the top where you will select "Create New Collaboration Session"

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/ae09888e-e22f-424e-b863-b5d5bdd628de" alt="share popup" width="600"/>

3. If you are not already authenticated with the configured server, the editor will try to open the authentication page in your browser. Follow the steps to authenticate yourself.
4. When the authentication was successful, a message will appear in the bottom right with an invite code. Share that with whoever you wish to join your session.

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/c74d1618-9846-4919-8342-716f91c77f9a" alt="share popup" width="400"/>

5. Should you need to copy the token again, click the "Sharing" item in the bottom toolbar again. A quickpick will open allowing you to copy the token or close the current session.
6. When a user requests to join, a message will appear at the bottom prompting you to allow or decline the join request.

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/dcae527f-ccfe-466d-a27a-9bf37c978165" alt="join request" width="400"/>


### Joining

1. After you aquired an invite code, click on the share item in the status bar and select

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/ae09888e-e22f-424e-b863-b5d5bdd628de" alt="share popup" width="600"/>

2. A quickpick will open prompting you to input the invite code you acquired previously.
3. If you are not already authenticated with the configured server, the editor will try to open the authentication page in your browser. Follow the steps to authenticate yourself.
4. That's it! After that the editor will connect to the host session.
5. If you want to leave the session, click the "Connected" item in the status bar and select "Close Current Session" to leave the session.

### Session UI

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/096c5ddd-026d-455c-9608-5c0febfca6d8" alt="share popup" width="400"/>

After joining or hosting a session, you will find a new "Current Collaboration Session" widget in the side panel.

This widget lists all joined users and their respective cursor colors.

Through the follow icon, you can jump to another user and automatically follow them when they change their active file.
