# Session and peer sync

**Intent** — When someone joins a live collaboration session, they should immediately see the same
thing everyone else sees: who else is in the room, and the host's workspace as it stands right now.
A guest who joins late is not a second-class participant — the session state they receive is
complete, not merely whatever happened to be broadcast after they arrived. This capability is where
the project's recent regressions have clustered, so its promises are stated here rather than left to
be re-derived from the code.

## Behaviour contract

- **A joining peer learns about every peer already in the room.** The `initData` a joining guest
  receives lists all current participants, whenever they joined — not just the host, and not just
  peers who joined after them. Enforced by
  `packages/open-collaboration-service-process/test/service.process.test.ts`
  ("a second guest's initData.guests includes the first guest").

- **A document a guest opens reflects the host's current state of that document.** "Current state"
  means what the host has right now — including unsaved editor content — not only what is on disk. A
  guest opening a file the host has never opened gets the host's real file content; a guest opening a
  file the host is editing gets the edited content. It is never empty. Enforced by
  `packages/open-collaboration-service-process/test/service.process.test.ts`
  ("guest opening a document the host has not seen yet seeds it from the host's real file content"),
  which covers the on-disk half.

- **Each document edit is sent once, by the peer that made it.** A peer applies an update it
  receives with the sender's peer id as the Yjs transaction origin and does not send it on, so the
  origin names the author. An edit a peer makes in response to a received update is its own and is
  sent right away. An update a peer misses is repaired by the provider's `resyncTimer`, which
  defaults to 10 seconds; setting it to `0` or less turns the repair off, and `dispose()` stops it.
  Enforced by `packages/open-collaboration-yjs/test/yjs-provider.test.ts`.

- **An edit typed while a remote change is arriving lands where the user typed it.** In the VS Code
  extension a remote change reaches the editor asynchronously, and the editor rejects it if the user
  typed in the meantime. The change is then recomputed for the editor's new content, and the user's
  edit is rebased onto the shared document, so neither is lost or misplaced, and a remote change is
  never sent back as if it were local. The editor is only ever changed by minimal edits, never by
  replacing the whole document. Enforced by `packages/open-collaboration-yjs/test/yjs-text-sync.test.ts`
  against a fake editor; the VS Code wiring in `CollaborationInstance.getDocumentSync` is unverified.
  The same holds for clients of the service process that open documents with `document/open`: they
  reject an edit that no longer fits their buffer and report applied edits back. Enforced by
  `packages/open-collaboration-service-process/test/versioned-client-document.test.ts` and
  `service.process.test.ts` ("a versioned client and a legacy client converge, ...").
  Not promised for documents opened with the legacy `awareness/openDocument`: a change is taken as
  applied the moment it is sent to the client.

- **What a guest types before the host has shared the document is kept.** Such edits are held back
  until the host's content arrives and are then rebased onto it, even if that content differs from
  what the guest started with. They reach the other peers as soon as they are written, without
  waiting for a resync. If the host does not share the document within 5 seconds, the client
  logs an error instead of staying silent. Enforced by
  `packages/open-collaboration-yjs/test/yjs-text-sync.test.ts` and, for the delivery to other peers,
  `packages/open-collaboration-yjs/test/yjs-provider.test.ts`.
- **Files matching `oct.files.exclude` are never shared with guests.** The default is `**/.env`;
  users may add patterns. Excluded files are withheld from the guest's file system view and their
  contents are never sent. (unverified — no test covers this today; it is the first test to write
  here. Implemented in `packages/open-collaboration-vscode/src/collaboration-instance.ts`.)

## Deliberately not promised

- **Session durability.** Rooms live in server memory; a server restart ends the session and peers
  must rejoin. See [ADR-0002](../adr/0002-in-memory-session-state.md).
- **A server-arbitrated "correct" document state.** Convergence is CRDT-based, so the merged result
  of concurrent edits is whatever Yjs produces. There is no authority that resolves conflicts a
  particular way. See [ADR-0003](../adr/0003-yjs-for-document-convergence.md).
- **Server-side visibility into session content.** Nothing about a session's contents can be read,
  logged, or recovered from the server. See [ADR-0001](../adr/0001-end-to-end-encrypted-relay.md).

## Surface

- `initData` / `InitData` — the payload a joining peer receives, carrying room participants.
- `oct.files.exclude` — user setting; glob patterns withheld from guests.
- `oct.joinAcceptMode` — `prompt` | `allowlist` | `auto`; governs whether a guest is admitted at all.
- `CollaborationInstance` — holds a peer's view of the session in the VS Code extension.
- `RoomManager`, `PeerManager` — server-side room membership.

## Pointers

- [ADR-0001](../adr/0001-end-to-end-encrypted-relay.md), [ADR-0002](../adr/0002-in-memory-session-state.md),
  [ADR-0003](../adr/0003-yjs-for-document-convergence.md)
- [../ARCHITECTURE.md](../ARCHITECTURE.md) — session lifecycle

## Open questions

- How promptly a leaving peer must be reported to the others was raised during this spec's interview
  and deliberately left unpinned. There is a test covering immediate notification on
  `CloseSessionRequest`, but whether that timing is a promise or an implementation detail is
  undecided.
