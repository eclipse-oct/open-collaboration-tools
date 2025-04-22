# Open Collaboration Tools

Open Collaboration Tools is a collection of open source tools, libraries and extensions for live-sharing of IDE contents, designed to boost remote teamwork with open technologies.

This is how it works: one person starts a collaboration session as host and invites others to join. The IDE extension distributes the contents of the hostʼs workspace and highlights text selections and cursor positions of other participants. In parallel, they get together in their favorite meeting or chat app for immediate discussion. All participants see what the others are looking at and and what changes they propose in real-time. This way of remote collaboration reduces confusion and maximizes productivity.

What's special about Open Collaboration Tools is that it's fully open source under the MIT license, and that it offers libraries to extend the approach on multiple levels: custom editors, custom IDE integrations, or even web applications.

For more information about this project, please [read the announcement](https://www.typefox.io/blog/open-collaboration-tools-announcement/).

## Public Instance

A public instance of the collaboration server is available at [open-collab.tools](https://www.open-collab.tools/).

[TypeFox](https://www.typefox.io/) offers this service with the intent to demonstrate the capabilities of the project and to support open source communities with it. However, we recommend all companies who wish to adopt this technology to deploy their own instance of it, secured with their existing access restrictions.

Usage of the public instance is bound to its [Terms of Use](https://www.open-collab.tools/tos/). Please read them carefully and use our [Discussions](https://github.com/eclipse-oct/open-collaboration-tools/discussions) for any questions.

## IDE Extensions

### Extension for VS Code

- [Open Collaboration Tools on Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=typefox.open-collaboration-tools)
- [Open Collaboration Tools on Open VSX](https://open-vsx.org/extension/typefox/open-collaboration-tools)

### Extension for Eclipse Theia

- [@theia/collaboration package on npm](https://www.npmjs.com/package/@theia/collaboration)

## Build

Build all packages:

```shell
npm i
npm run build
```

Launch the server application:

```shell
npm run start
```

## Deployment

A container image named [oct-server-dev](https://github.com/eclipse-oct/open-collaboration-tools/pkgs/container/open-collaboration-tools%2Foct-server-dev) is available for simple deployment. It does not require any additional infrastructure services. However, the server uses WebSocket connections and holds session data in memory, so horizontal scaling is not yet supported.

Build the container image:

```shell
docker compose build
```

Launch the server from inside the container

```shell
docker compose up -d
```
