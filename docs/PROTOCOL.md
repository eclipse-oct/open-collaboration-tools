
## Architecture at a glance

- **The server is a pure relay.** All peer traffic (host or guest) goes over a single transport connection (Socket.IO by default) per peer. The server (`open-collaboration-server`) routes opaque messages between peers via `MessageRelay`; it never reads message payloads. Direct peer-to-peer transports (e.g. WebRTC) are not currently implemented.
- **Payloads are end-to-end encrypted.** Every peer generates an ephemeral asymmetric keypair when it connects (`Encryption.generateKeyPair()`) and publishes only its public key to the server/room. Message bodies are encrypted per-recipient; the server can only see the envelope (message name and origin/target), not the content.
- **There are two distinct tokens.** A *user* JWT (from `/api/login/*`) authenticates the person against the server's HTTP API. A separate, short-lived *room* JWT (a `RoomClaim`, minted by `/api/session/create` or `/api/session/join/:roomId`) authenticates one connection to one room, and is what's actually presented on the transport connection (`x-oct-jwt` header).
- **There is exactly one shared Yjs document (`Y.Doc`) per room**, for its entire lifetime. Individual files are modeled as named `Y.Text` instances inside that one doc, keyed by their workspace-relative path. There is no protocol concept of "closing" a shared file — see [Opening Shared Documents](#opening-shared-documents) below.

The three message-passing primitives used throughout the protocol (defined in `src/messaging/messages.ts`):

| Kind | Delivery | Reply |
|---|---|---|
| `RequestType` | one target peer | awaited response |
| `NotificationType` | one target peer | none |
| `BroadcastType` | every other peer in the room | none |

## Connection establishment

This section describes what a client — host or guest — must do, in order, to go from "nothing" to a live, usable `ProtocolBroadcastConnection` (see `src/connection.ts`). Both roles share the same login and compatibility steps, implemented by `ConnectionProvider` in `src/connection-provider.ts`.

### 0. Compatibility check and authentication (shared by host and guest)

Both `ConnectionProvider.createRoom()` and `ConnectionProvider.joinRoom()` start with the same preamble:

1. **`ensureCompatibility()`** — `GET /api/meta` returns the server's protocol version; the client checks it against its own via `compatibleVersions()` and throws `IncompatibleProtocolVersions` if they don't match.
2. **`validate()`** — if the client already holds a user token (or uses cookie auth), `POST /api/login/validate` checks whether it's still valid.
3. **`login()`** (only if not valid) — a three-step handshake:
   - `POST /api/login/initial` returns a `pollToken` and `AuthMetadata` (the list of configured `AuthProvider`s — form-based or web/OAuth-based, PKCE-capable as of the generic OAuth provider).
   - The client's injected `authenticationHandler(pollToken, authMetadata)` callback drives the actual UI (or, for a headless client, just forwards the data to whatever is upstream) and must eventually cause the user to complete auth against one of the providers.
   - The client polls `POST /api/login/poll/:pollToken` until the server returns a signed **user JWT** (`LoginPollResponse.loginToken`), which is cached on the `ConnectionProvider` for subsequent calls.

Only after this preamble succeeds does either role proceed to its room-specific step below.

### 1. Host: creating a room

1. `POST /api/session/create` (authenticated with the user JWT) → the server (`RoomManager.prepareRoom`) generates a room id and mints a **room JWT** (`RoomClaim { room, user, host: true, roomClock: 0 }`). Response: `CreateRoomResponse { roomId, roomToken, loginToken? }`.
2. The client calls `ConnectionProvider.connect(roomToken)` — **no `host` peer is passed**. This:
   - fetches `/api/meta` again to negotiate a transport,
   - generates a fresh encryption keypair,
   - opens the transport with headers `x-oct-jwt` (the room token), `x-oct-public-key`, `x-oct-client`, `x-oct-compression`.
3. Server-side, `CollaborationServer.connectChannel()` verifies the room JWT, builds a `Peer` for this connection, and calls `RoomManager.join(peer, room)`. Because `peer.host === true`, this **creates** the `Room` object server-side (there was none before). The server then sends the peer a `peer/info` notification containing its own `Peer` object (id, encryption/compression metadata, etc.).
4. Client-side, because no `host` was passed to `connect()`, the connection's internal readiness gate resolves **immediately** at construction (`ProtocolBroadcastConnectionImpl` calls `ready()` in its constructor when `options.host` is absent) — a fresh room has no other peers to encrypt for yet, so there's nothing to wait on.
5. Receiving `peer/info` resolves the host's own identity. The host must, at minimum, register:
   - `connection.peer.onJoinRequest(user => ...)` — answered later, once a guest tries to join (step 4 of the guest flow).
   - `connection.room.onJoin(peer => ...)` — fired when a guest's `room/joined` broadcast arrives; **the host is the only party expected to react** by building an `InitData { protocol, host, guests, capabilities, permissions, workspace }` object and sending it directly to the new peer via `connection.peer.init(peerId, initData)`.

A host is otherwise operational as soon as the transport connects — there is no separate "am I ready" barrier beyond the socket being open, and no workspace state is pushed proactively; it is only ever sent in response to a specific guest joining.

### 2. Guest: joining a room

1. `POST /api/session/join/:roomId` → server looks up the room and calls `RoomManager.requestJoin()`, which sends a **`peer/join` request** to the *host's* live connection and returns `JoinRoomInitialResponse { pollToken, roomId }` to the guest. The guest is not yet connected to anything at this point — this is still plain HTTP against the server's API.
2. **The host decides.** The host's `onJoinRequest` handler runs app-specific accept/reject logic and returns either `JoinResponse { workspace }` (accept) or `undefined` (reject).
3. **The guest polls** `POST /api/session/poll/:pollToken` until a terminal result:
   - Rejected/timed out → a failure `JoinRoomPollResponse { failure: true, code }`, surfaced to the guest as a `ServerError`.
   - Accepted → the server mints a new **room JWT** for the guest, bumps the room's clock, and returns `JoinRoomResponse { roomId, roomToken, workspace, host }` — note that the guest already has the *workspace* metadata and the host's `Peer` descriptor **before it opens any transport connection**.
4. The guest calls `ConnectionProvider.connect(roomToken, host)` — **this time passing the `host` peer it just received**. This matters: the connection constructor registers the host's public key immediately (`onDidJoinRoom(host)`), but does **not** call `ready()` — the connection stays gated until the corresponding `peer/init` arrives.
5. Server-side, `RoomManager.join()` for a non-host peer pushes it into `room.guests` and **broadcasts `room/joined`** to everyone already in the room (host and other guests), then sends the new peer its own `peer/info`.
6. The guest receives `peer/info` (resolves its own identity) and, separately, the host's `peer/init` notification sent in host-flow step 5. Receiving `peer/init`:
   - populates the connection's known-peers map with `[host, ...guests]` and **only then calls `ready()`** — this is what actually unblocks the guest's ability to send requests/notifications/broadcasts.
   - at the application level, populates the local peer list, applies initial permissions, and (in a full editor client) mounts a virtual filesystem backed by the host.
7. A guest should consider itself fully operational only once **both** its own identity (`peer/info`) and the room's init data (`peer/init`) have arrived — not merely once the socket is open.

> **Known discrepancy — `host` must be passed to `connect()` on guest join.** `ConnectionProvider.connect(roomToken, host)`'s second argument controls whether the connection's readiness gate waits for `peer/init` (host passed) or resolves immediately at construction (host omitted). The VS Code extension passes the host peer it received in `JoinRoomResponse.host`; the service process currently calls `connect(resp.roomToken)` without it (`open-collaboration-service-process/src/message-handler.ts`, `joinRoom`). In practice this is masked because outgoing broadcasts/requests silently have nothing to encrypt against until a peer key exists, but the two clients reach "ready" through different signals and would fail differently (immediate "no public key found for target" vs. a queued, later-resolving send) if a guest ever needed to talk to the host before `peer/init` arrives. New clients should always pass `host` when joining, to match the VS Code behavior and the connection's intended contract.

### Notes on transport and readiness

- `connect()` is used identically for host and guest except for the `host` argument; both derive the actual transport from `/api/meta`'s advertised `transports` list matched against the client's configured providers.
- The Yjs CRDT sync channel (`sync/dataUpdate`, `sync/awarenessUpdate`, etc., see below) is wired up eagerly by clients (typically in the same constructor that sets up the connection), but every outgoing send on the connection internally awaits the same readiness gate described above, so early Yjs sync traffic simply queues rather than being lost.
- `room/leave` is the only message that travels **unencrypted** (it's a server-directed control message, not peer-to-peer content).

## Opening shared documents

### Protocol-level contract

**No `editor/*` message ever carries document content.** Content reaches a peer by exactly two routes: the generic, path-agnostic Yjs sync channel, and an out-of-band `fileSystem/readFile` request against the host's real filesystem.

- `Editor.Open` (`editor/open`, **notification**, targeted) — "I want to view/edit this path." Sent by a guest to the host. It carries only a path, and expects no direct reply.
- `Editor.Close` (`editor/close`, **broadcast**) — defined in the protocol but **not implemented by any current client** (grep-verified across vscode, monaco, service-process, and the agent package). Shared `Y.Text` instances are therefore never removed from the room's `Y.Doc`; once a path has been opened by anyone, it stays in the shared document for the lifetime of the room.
- `Editor.ProposeChanges` / `Editor.CloseProposal` (`editor/createDiff` / `editor/closeProposal`, both broadcasts) — an optional diff/merge-review layer on top of the above, used by VS Code and Monaco only; not implemented by the service process or the agent package.
- `Sync.DataUpdate` / `Sync.DataNotify` (`sync/dataUpdate` broadcast, `sync/dataNotify` targeted notification) — the actual Yjs CRDT state-vector and update exchange, doc-wide (not per file). A peer that needs another peer's current state sends a state-vector query; whoever has newer state replies with an encoded diff, addressed only to the requester.
- `FileSystem.ReadFile` (`fileSystem/readFile`, **request**) — a plain, out-of-band RPC against the host's real filesystem. This is how a guest obtains initial content for a path that is not yet populated in the shared `Y.Doc`. "Not yet populated" means *absent from `Y.Doc.share` **or** present but empty*: `getText()` registers a path in `share` while it is still empty, so membership alone is not a signal that content exists.

The flow for a guest opening a path the host has not shared yet:

1. The guest reads the content over `fileSystem/readFile` (in VS Code, from the collaboration filesystem provider, as part of opening the document) and displays it.
2. The guest declares that content to the CRDT layer (`YjsNormalizedTextDocument.attachLocalDocument`), which marks the document *diverged*: the local text is real, the shared `Y.Text` is empty.
3. The guest sends `Editor.Open` to the host. The host materializes the path and seeds the `Y.Text` — but **only if it is empty**; a non-empty shared document may hold unsaved guest edits, and re-seeding would discard them and invalidate every relative position (making peer selections jump).
4. The seeding update reaches the guest as "insert the whole file at offset 0". Because the document is marked diverged, it is *reconciled* — a whole-document diff against the local text, compared in LF space, since the local document may use CRLF and the shared one never does — rather than applied as a delta. Both sides normally already agree, so this is usually a no-op; applying it as a delta is what would otherwise duplicate the file's content.

From then on, content rides entirely on the ordinary Yjs sync channel. Note that `Editor.Open` never answers with content itself — it is a notification, and the bytes arrive separately.

Clients with no filesystem of their own take the other route: the agent package never calls `fileSystem/readFile`, and instead sends `Editor.Open` and waits for the seeding update to arrive over Yjs (`DocumentSync.openAndWaitForContent`), skipping that first whole-file insert locally.

