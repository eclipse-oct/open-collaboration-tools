# Architecture

One protocol, several clients, and a relay server that cannot read what it relays.

A collaboration session has one **host** — the peer whose workspace is shared — and any number of
**guests**. All of them connect to a server that routes messages between them; the server assigns
rooms and peers and enforces access, but session content passes through it encrypted.

## Package layering

Packages depend on each other by published version range (`"open-collaboration-protocol": "~0.3.3"`),
not `workspace:*`. Three tiers, verified against the manifests:

```
tier 0   open-collaboration-protocol          (no internal dependencies)
              ▲                    ▲
tier 1   open-collaboration-yjs    open-collaboration-server
              ▲
tier 2   open-collaboration-vscode · -monaco · -service-process · -agent
```

Rules that follow, and that `test/architecture.test.ts` enforces:

- `open-collaboration-protocol` depends on no other package in this repo. It is the only thing every
  client and the server agree on.
- `open-collaboration-server` depends on the protocol and nothing else internal. In particular it
  must never depend on `open-collaboration-yjs`: the server does not know what a document is.
- Clients never import each other. A VS Code concern that a Monaco client would also need belongs in
  the protocol or Yjs layer, not in a sibling client.
- Cross-package imports go through package names, never relative paths into another package.

## Module index

| Package | Purpose | Key public symbols |
|---|---|---|
| `open-collaboration-protocol` | The wire protocol: message shapes, encoding, compression, encryption, transports, and the connection abstraction every client builds on. | `ConnectionProvider`, `AbstractBroadcastConnection`, `Encryption`, `Encoding`, `Compression`, `SocketIoTransportProvider`, `initializeProtocol` |
| `open-collaboration-yjs` | Binds the protocol's sync channel to Yjs documents and awareness, so peers converge on document state without a server arbitrating order. | `OpenCollaborationYjsProvider`, `YjsNormalizedTextDocument`, `LOCAL_ORIGIN` |
| `open-collaboration-server` | Express 5 + Inversify relay: rooms, peers, credentials, and pluggable auth endpoints. | `CollaborationServer`, `RoomManager`, `PeerManager`, `MessageRelay`, `CredentialsManager`, `AuthEndpoint` |
| `open-collaboration-vscode` | The VS Code extension, published as `typefox.open-collaboration-tools`. Owns the virtual file system, follow mode, chat, and the room view. | `activate`, `CollaborationInstance`, `CollaborationFileSystemProvider`, `CollaborationRoomService` |
| `open-collaboration-monaco` | Connects a single Monaco editor to a session; its `example` entry backs the playground served by `npm run dev`. | `MonacoCollabApi`, `monacoCollab` |
| `open-collaboration-service-process` | A stdio JSON-RPC process so non-TypeScript IDEs can join a session without reimplementing the protocol. | `MessageHandler`, `CollaborationInstance` |
| `open-collaboration-agent` | CLI that joins a room as an AI participant, bridging the Agent Client Protocol to a session. | `startCLIAgent`, `ACPBridge` |

## Invariants

These hold across the repo. Breaking one is an architectural change, not a refactor.

1. **The server never sees plaintext session content.** Peer payloads are encoded, compressed, and
   symmetrically encrypted before they reach the transport; the room's symmetric key is wrapped for
   each peer with that peer's public key. `MessageRelay` moves opaque bytes and resolves request IDs.
   Nothing on the server may inspect, log, transform, or persist message content. See
   [ADR-0001](adr/0001-end-to-end-encrypted-relay.md).
2. **Session state lives in server process memory.** Rooms and peers are held by `RoomManager` and
   `PeerManager` in-process, so a restart ends live sessions and the server does not scale
   horizontally. See [ADR-0002](adr/0002-in-memory-session-state.md).
3. **Convergence is CRDT-based, never server-arbitrated.** Because the server cannot read content, it
   cannot order or transform operations; peers converge on their own through Yjs. See
   [ADR-0003](adr/0003-yjs-for-document-convergence.md).
4. **`initializeProtocol` runs before any protocol use.** Every entry point injects a crypto
   implementation at startup — the server's `app.ts`, the extension's `extension.ts` and
   `extension-web.ts`, the service process's `process.ts`, the agent's `agent.ts`, and Monaco's
   `monaco-api.ts`. Node hosts pass `crypto.webcrypto`. Protocol code must not reach for a global
   crypto object itself, and a new client must add this call or fail at first use.

## Session lifecycle

1. A client authenticates against the server and receives a JWT. Auth is pluggable: simple login,
   API key, GitHub, Google, Keycloak, Authentik, and a generic OAuth endpoint, all bound as
   `AuthEndpoint` in `inversify-module.ts`.
2. The host calls `POST /api/session/create` and gets a room ID and room token; guests join with
   `POST /api/session/join/:room` and poll for the host's decision.
3. Whether a guest is admitted is the host's call, governed by the extension's `oct.joinAcceptMode`
   (`prompt`, `allowlist`, or `auto`).
4. Once joined, peers exchange encrypted messages over a socket.io transport. Document content and
   awareness flow through the Yjs provider; the file system a guest sees is served by the host.
5. What a joining peer is promised at each of these steps is specified in
   [product-specs/session-and-peer-sync.md](product-specs/session-and-peer-sync.md).

## Build topology

`tsc -b tsconfig.build.json` builds the TypeScript project references; `npm run build --workspaces`
then runs each package's own build. `open-collaboration-vscode` is deliberately absent from the
project references — it is bundled by esbuild and typechecked by its own `check-types` script. It is
also the only package without `"type": "module"`, which is why extensionless relative imports are
correct there and nowhere else.
