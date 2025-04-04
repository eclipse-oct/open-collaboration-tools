# Open Collaboration Tools

Open Collaboration Tools is a collection of open source tools, libraries and extensions for live-sharing of IDE contents, designed to boost remote teamwork with open technologies.

This is how it works: one person starts a collaboration session as host and invites others to join. The IDE extension distributes the contents of the hostʼs workspace and highlights text selections and cursor positions of other participants. In parallel, they get together in their favorite meeting or chat app for immediate discussion. All participants see what the others are looking at and and what changes they propose in real-time. This way of remote collaboration reduces confusion and maximizes productivity.

What's special about Open Collaboration Tools is that it's fully open source under the MIT license, and that it offers libraries to extend the approach on multiple levels: custom editors, custom IDE integrations, or even web applications.

For more information about this project, please [read the announcement](https://www.typefox.io/blog/open-collaboration-tools-announcement/).

## Server Configuration

This extension needs a server instance to which all participants of a collaboration session connect. The server URL is configured with the setting `oct.serverUrl`. Its default is set to `https://api.open-collab.tools/`, which is a public instance operated by [TypeFox](https://www.typefox.io/). TypeFox offers this service with the intent to demonstrate the capabilities of the project and to support open source communities with it. However, we recommend all companies who wish to adopt this technology to deploy their own instance of it, secured with their existing access restrictions.

Usage of the public instance is bound to its [Terms of Use](https://www.open-collab.tools/tos/). Please read them carefully and use our [Discussions](https://github.com/eclipse-oct/open-collaboration-tools/discussions) for any questions.

## Using the Extension
This extension contributes support for the [Open Collaboration Protocol](https://open-collab.tools).

### Quickstart

The extension adds a new "Share" item to the Status bar at the bottom of vscode, which allows managing your current sessions.

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/bf5769ab-508b-4a6a-a91e-48e9efa8d4a6" alt="share-icon" width="300"/>

### Hosting a session

1. Click on the share item in the status bar
2. A quickpick will open at the top where you will select "Create New Collaboration Session"

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/ae09888e-e22f-424e-b863-b5d5bdd628de" alt="share popup" width="600"/>

3. If you are not already authenticated with the configured server, VS Code will try to open the authentication page in your browser. Follow the steps to authenticate yourself.
4. When the authentication was successful, a message will appear in the bottom right with an invite code. Share that with whoever you wish to join your session.

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/c74d1618-9846-4919-8342-716f91c77f9a" alt="share popup" width="400"/>

5. Should you need to copy the token again, click the "Sharing" item in the bottom toolbar again. A quickpick will open allowing you to copy the token or close the current session.
6. When a user requests to join, a message will appear at the bottom prompting you to allow or decline the join request.

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/dcae527f-ccfe-466d-a27a-9bf37c978165" alt="join request" width="400"/>


### Joining

1. After you aquired an invite code, click on the share item in the status bar and select

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/ae09888e-e22f-424e-b863-b5d5bdd628de" alt="share popup" width="600"/>

2. A quickpick will open prompting you to input the invite code you acquired previously.
3. If you are not already authenticated with the configured server, VS Code will try to open the authentication page in your browser. Follow the steps to authenticate yourself.
4. That's it! After that VSCode will connect to the hosts session
5. If you want to leave the session, click the "Connected" item in the status bar and select "Close Current Session" to leave the session.

### Session UI

<img src="https://github.com/eclipse-oct/open-collaboration-tools/assets/34068281/096c5ddd-026d-455c-9608-5c0febfca6d8" alt="share popup" width="400"/>

After joining or hosting a session, you will find a new "Current Collaboration Session" widget in the explorer tab.

This widget lists all joined users and their respecive cursor colors.

Through the follow icon, you can jump to another user and automatically follow them when they change their active file.
