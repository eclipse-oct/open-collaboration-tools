# Versioned document edits in the service-process client protocol

Status: in progress (service process done, IntelliJ client and rollout open) · Owner: _unassigned_ · Started: 2026-11-20

## Problem

`YjsTextDocumentSync` (`packages/open-collaboration-yjs/src/yjs-text-sync.ts`) is safe against
concurrent typing only if its `TextDocumentAdapter` behaves like VS Code:

- `getText()` returns the real editor buffer,
- `applyChanges()` resolves `false` when the buffer changed since the edit was computed,
- every change of the buffer, the applied edit included, is reported back before `applyChanges()`
  resolves.

The service-process client protocol (`packages/open-collaboration-service-process/src/messages.ts`)
cannot provide any of this. `UpdateDocumentContent` is a fire-and-forget notification in both
directions, so `ClientDocument` (`src/collaboration-instance.ts`) returns its own model from
`getText()` and treats every edit as applied the moment it is sent.

Failure case: the service process sends an edit, and the user types before the native IDE applies
it. The user's change addresses the document *without* our edit, but the service process applies it
to the document *with* it. When the two are close, the user's text lands in the wrong place, and
the IDE and the session stay diverged permanently. The provider's 10 s Yjs resync does not help,
because it only reconciles `Y.Doc`s between peers, never the IDE buffer with the service process.

`docs/product-specs/session-and-peer-sync.md` currently states this limitation ("Not promised for
clients of the service process").

### What the IntelliJ client does today

`eclipse-oct/oct-intellij` is the only known native client. Its editor code
(`src/main/kotlin/org/typefox/oct/editor/`) shows how the limitation surfaces, and what the client
side of this plan has to replace:

- `EditorManager.updateDocument` applies a change list front to back with one `replaceString` per
  change. The changes address the buffer as it was before any of them, so every change after the
  first lands at a shifted offset. `diffText` routinely produces several changes per edit.
- `EditorDocumentListener` suppresses reporting while it applies remote edits (`sendUpdates = false`),
  and after *every* change it fetches `awareness/getDocumentContent` (the `Y.Text`) and, if it
  differs, replaces the whole document with `setText`, again unreported. This repairs the misplaced
  changes above, but it can drop what the user just typed, moves the caret, and breaks undo.
- A listener is attached per *editor*, so a split view of one file reports each change twice.
  `editorReleased` detaches the listener, but the service process keeps the document and keeps
  sending edits to it. The host also opens documents without an editor (`guestOpenedEditor`).

## Goal

Make a native client a fully supported `TextDocumentAdapter`, so that `YjsTextDocumentSync` handles
races for it exactly as it does for VS Code (retry, echo detection, rebasing) without any
service-process-specific conflict logic. Existing clients that do not implement the new messages
keep working as they do today.

Non-goals: changing the OCP wire protocol between peers or the server (this is purely
client ↔ service process over stdio), and operational transformation on the client side.

## Design

### Versions

Each open document has an integer **version** owned by the client. It starts at the value the client
sends when opening the document and goes up by exactly one with every change of the buffer that the
client reports, whether the user made it or it came from an edit of the service process. The client
is the only party that increments it, so there is no shared counter to agree on.

The version belongs to the *document*, not to an editor: one counter and one change listener per
document, however many editors show it. It is the client's own counter. IntelliJ's
`Document.modificationStamp` does not qualify, as it does not go up by one per change.

### Messages (new; legacy messages stay unchanged)

Use single object parameters rather than positional ones. `messages.ts` already documents that
vscode-jsonrpc enforces parameter arity (`CloseSessionRequest` / `RequestType0`), so adding an
optional positional parameter to an existing message risks rejecting legacy clients.

| Direction | Message | Kind | Payload |
|---|---|---|---|
| client → service | `document/open` | notification | `{ path, openId, text, version, eol? }` |
| client → service | `document/close` | notification | `{ path }` |
| client → service | `document/didChange` | notification | `{ path, version, changes: TextDocumentInsert[] }`, where `version` is the version *after* the change |
| client → service | `document/didChangeSelection` | notification | `{ path, version, selections: ClientTextSelection[] }` |
| service → client | `document/applyEdit` | request | `{ path, openId, baseVersion, changes: TextDocumentInsert[] }` → `{ result: 'applied' \| 'outdated' \| 'notOpen' }` |
| service → client | `document/getBuffer` | request | `{ path, openId }` → `{ text, version }` or `null` if not open (recovery only, see below) |

The names are settled as listed. `document/getBuffer` deliberately avoids the name of
the existing `awareness/getDocumentContent`, which runs the other way (client → service) and returns
the shared text or the host's file, not the client's buffer.

`eol` is `'\n'` or `'\r\n'` and is what the service process uses for text it inserts. Without it,
the service process guesses from the buffer, as `ClientDocument` does today. IntelliJ documents
always use `'\n'`.

#### Rules for `document/didChange`

1. All changes of one notification address the buffer as it was before any of them, are sorted, and
   do not overlap (the contract of `YjsTextDocumentSync.onDidChangeContent`).
2. A change the user makes is reported as soon as it happens, before any later message about the
   document (selection, answer to a request).
3. Offsets are UTF-16 code units of the buffer as the client holds it. Inserted text is reported as
   it was actually inserted, after any line-ending conversion of the client.

#### Rules for `document/applyEdit`

These are the adapter contract, translated:

1. The changes address the buffer at `baseVersion`, all of them the buffer as it was before any of
   them, sorted and not overlapping.
2. The client applies them only if its current version equals `baseVersion`, and then all of them
   atomically: in one write action, back to front, so that each change still addresses the original
   buffer. Otherwise it applies nothing and answers `outdated`.
3. An applied edit is reported as **exactly one** `document/didChange` with version
   `baseVersion + 1`, carrying the changes as applied. Not one per change: `YjsTextDocumentSync`
   recognises its own edit by comparing the whole buffer before and after a reported change, so an
   edit split into several notifications is taken for a local change and written back to the shared
   text, duplicating it.
4. The client **first** sends that `document/didChange` and **then** answers `applied`. The stdio
   stream is ordered, so the service process sees the echo before the result, which is what
   `YjsTextDocumentSync` relies on to tell its own edit apart from an identical user edit.
5. For a path the client does not have open, it answers `notOpen`.

#### Ordering rule

The client handles `document/applyEdit` and `document/getBuffer` for a document **in the order it
received them**, on the same thread that changes the buffer (in IntelliJ: the EDT, inside the write
action), and sends every resulting `document/didChange` before the answer. The recovery below
depends on this: the answer to `getBuffer` reflects every `applyEdit` sent before it, applied or
rejected, and the client never applies an edit after it has answered a later `getBuffer`.

#### Rules for `document/didChangeSelection`

`version` is the version of the buffer the offsets address. The client reads the offsets and the
version together, at a moment when every change has been reported. In IntelliJ the caret moves while
a document change is being processed, possibly before the change listener has reported it, so
selections are read after the write action (e.g. deferred with `invokeLater`), not in the caret
listener itself.

### Service-process side

- **Negotiation per document:** a document opened with `document/open` uses versioned mode, and one
  opened with legacy `awareness/openDocument` keeps the current `ClientDocument` behaviour. This
  needs no global handshake, and a client can migrate one editor type at a time.
- The new methods are registered explicitly in `MessageHandler`. Unregistered methods fall through to
  the catch-all handlers, which forward them to the OCP connection and fail on an object parameter
  with "missing target".
- A `VersionedClientDocument` adapter:
  - keeps a mirror of the client buffer and its version, updated from `document/didChange`;
  - `getText()` returns the mirror, `getEol()` the `eol` from `document/open`;
  - `applyChanges()` sends `document/applyEdit` with `baseVersion` = the mirror's version and
    resolves `true` for `applied`, `false` for `outdated`. The echo arrives through
    `didChange` → `sync.onDidChangeContent()` before the answer, so the sync's existing logic
    applies unchanged. `notOpen` disposes the document, as `document/close` does.
- **`document/open` for a path that is already open** replaces the document: the old one is disposed
  as on `document/close`, then the new one is created as on a first open.
- **`document/close`** disposes the sync and the mirror. A pending `applyEdit` is settled by throwing
  (see below), and its late answer is ignored.
- **Selections:** a `document/didChangeSelection` at the mirror's version is used as it is. One that
  is ahead (it overtook its `didChange`, which the rules forbid but which costs nothing to tolerate) is
  held until the mirror reaches that version. One that is behind is dropped; the next caret move sends
  a fresh one. Outgoing selections may address a version the client has already moved past. That is
  acceptable at first, because `onDidSync` re-sends them once the sync catches up. See open questions.

### Recovery

Two things can make the mirror untrustworthy. Both can only happen through a client bug or a hung
client, never on a working ordered stdio stream. Recovery is a safety net, and every occurrence is
logged as an error.

**Settling a pending edit after recovery: throw, never `false`.** `YjsTextDocumentSync.pump()` treats
an `applyChanges()` that throws as failed. It then neither writes a received echo to the shared text
as a local change (as it would after `false`) nor counts it as confirmed (as after `true`). It reads
the buffer anew and computes the next edit from there. That is correct whether the echo was our edit
or an identical user edit, because in both cases the mirror and the shared text already hold the
text. Resolving `false` instead would duplicate the text if the echo was our edit.

**Gap.** A `didChange` whose version is not `mirror.version + 1`:

1. Mark the mirror invalid and send `document/getBuffer`. Drop every `didChange` until the answer
   arrives: by the ordering rule, they all address versions up to and including the answer's.
2. On the answer `{ text, version: V }`, replace the mirror, call `sync.refresh()`, and settle a
   pending `applyEdit` by throwing. Accept `didChange`s from `V + 1` on.
3. The shared text is authoritative, so the pump repairs the buffer with minimal edits. A user change
   that got lost in the gap is reverted in the editor; the lost notification is the only record of it.

**Timeout.** An `applyEdit` without an answer after a timeout (a few seconds, configurable):

1. Log a warning and send `document/getBuffer`. Keep processing `didChange`s normally, since they are
   still contiguous.
2. If the `applyEdit` answer arrives first, it is handled normally, and the `getBuffer` answer is
   only a consistency check. This is the expected case for a slow client: an IntelliJ EDT blocked by
   a modal dialog or a long write action answers both late, in order.
3. If the `getBuffer` answer arrives while the `applyEdit` is still pending, the client lost the
   request. Compare the answer with the mirror. If they differ, replace the mirror and call
   `sync.refresh()`, as for a gap. Then settle the pending edit by throwing, and ignore its answer
   should it still arrive.
4. If `getBuffer` does not answer either, the client is unresponsive. Log an error and leave the
   document stalled; there is nothing to recover against.

## Steps

1. **Settle the protocol.** Agree on message names, payloads, the `applyEdit` rules and the ordering
   rule with the owners of the native clients (the IntelliJ integration in `eclipse-oct/oct-intellij`,
   plus any Eclipse client). Check vscode-jsonrpc's arity behaviour for object-parameter messages,
   and that lsp4j sends a single-parameter `@JsonNotification` / `@JsonRequest` as a by-name object.
   Write the protocol into the doc comments in `messages.ts` and a "Document synchronization" section
   in the service-process `Readme.md`, including the threading rule for clients.
2. **Message types** in `messages.ts`, exported from the package entry point (the package's `main`
   is `lib/messages.js`, which is what native-client tests and bindings consume).
3. **`VersionedClientDocument`** in `collaboration-instance.ts` next to `ClientDocument`, plus explicit
   handlers in `message-handler.ts` for all new client → service messages. Route `document/didChange`
   and `document/didChangeSelection` to the document. Keep the legacy path untouched.
4. **Recovery:** gap detection, the `applyEdit` timeout, `document/getBuffer`, and settling a pending
   edit by throwing.
5. **Tests** in `packages/open-collaboration-service-process/test/`:
   - Extend the fake `Client` in `service.process.test.ts` with a versioned document that follows the
     rules above: honours `baseVersion`, applies back to front, reports one `didChange` per edit, and
     handles requests in order.
   - The race: the client changes its buffer between receiving `applyEdit` and applying it. Both
     peers must converge, with the user's text where it was typed.
   - A multi-change edit (a remote change that `diffText` splits into several changes) arrives intact.
   - The echo: the user makes exactly the change of an in-flight edit, which is then rejected.
   - A slow client that answers `applyEdit` after the timeout: no duplicated text.
   - A client that drops an `applyEdit`: recovery through `getBuffer`, then convergence.
   - Gap recovery.
   - `document/close`, and `notOpen` for an edit that crosses a close.
   - A selection that overtakes its `didChange` is applied at the right offset.
   - A legacy client in the same session still working.
6. **IntelliJ client** (in `oct-intellij`, released together with the service process version it
   pins):
   - One change listener and one version counter per `Document`, not per editor. Documents opened
     without an editor (`guestOpenedEditor`) are tracked as well. `document/close` when the last
     reason to track the document goes away.
   - `document/applyEdit`: on the EDT, in one write action, compare the version, apply back to front
     while the listener collects instead of sending, then send one `didChange` and complete the
     future after the write action.
   - `document/getBuffer`: answered on the EDT, queued behind any pending `applyEdit`.
   - Remove the `sendUpdates` suppression and the `getDocumentContent` + `setText` resync for
     versioned documents.
   - Send selections deferred, with the version, through `document/didChangeSelection`.
7. **Docs:** update the bullet in `docs/product-specs/session-and-peer-sync.md` so that the
   guarantee holds for versioned service-process clients and the limitation names only legacy
   clients. Update `docs/ARCHITECTURE.md` and `docs/PROTOCOL.md` if they describe the client protocol.
8. **Rollout:** release the service process with both modes, then the IntelliJ plugin pinned to that
   release. IntelliJ bundles the service process binary at a pinned version
   (`octServiceProcessVersion` in its `build.gradle.kts`), so a new client never meets an old service
   process; the legacy messages only matter for third-party clients. Decided after review: remove
   them in the same release rather than keep a deprecation window, see the progress log.

## Alternatives considered

- **Content hash instead of a version** in `applyEdit`: same design, but it hashes the buffer on every
  edit and cannot detect a lost `didChange`.
- **Client rebases instead of rejecting** (in IntelliJ, cheap with `RangeMarker`s): no retries, but the
  applied edit no longer equals the computed one, so echo detection needs an explicit edit id and
  changes to `YjsTextDocumentSync`, and every client has to get tie-breaking right. A possible later
  optimisation if rejections turn out to be frequent.
- **Two-sided OT between client and service process** (Jupiter model): proven, but every client
  implements transforms, and the service process replaces `YjsTextDocumentSync` with its own logic.
- **Yjs in the client** (`yrs` via JNI, `y-octo`): removes the process boundary from the race, but
  needs a native binding per platform and a port of `YjsTextDocumentSync`, which defeats the purpose
  of the service process.
- **Report applied edits without rejecting:** the misplaced edit does not match what the sync
  expects, so it is written to the shared text as a local change and spreads to every peer.
- **Overwrite the editor when it differs** (IntelliJ's current `setText` resync): loses user input,
  moves the caret, breaks undo.

## Open questions

- In which `oct-intellij` (and Eclipse) release does the client side ship?
- Should outgoing `UpdateTextSelection` carry a version so that clients can drop stale selections,
  or is the re-send on `onDidSync` enough?
- Does the protocol change warrant an ADR (client protocol versioning and compatibility policy)?

## Progress log

- 2026-11-20 — Plan written after reviewing `389e36e` ("Improve editor diff syncing"), which
  introduced `YjsTextDocumentSync` and documented the service-process limitation. This branch is
  rebased onto it.
- 2026-11-20 — Revised after reviewing the IntelliJ client: one `didChange` per applied edit,
  back-to-front application, one version per document, `document/close` and `notOpen`, versioned
  client selections, and recovery through in-order `getBuffer` that settles a pending edit by
  throwing. Added the IntelliJ client step and the alternatives considered.
- 2026-11-20 — Steps 1–5 and 7 done. Protocol settled as written (the IntelliJ and Eclipse owners are
  notified on the PR rather than beforehand). Deviations from the design above:
  - `VersionedClientDocument` lives in its own file, `src/versioned-client-document.ts`, and talks to
    the client through a two-method interface, so it is unit-tested over a JSON-RPC pipe without a
    server (`test/versioned-client-document.test.ts`, fake client in `test/fake-versioned-client.ts`).
    `service.process.test.ts` covers the race end to end with a versioned host and a legacy guest.
  - The timeout is the `--edit-timeout` CLI option (default 5000 ms). It also bounds the wait for
    `getBuffer`, after which an error is logged and the document stays stalled.
  - Besides gaps, recovery also starts for a `didChange` whose changes do not fit the mirror, an
    `applied` that arrives without its `didChange`, and an `outdated` for the latest reported version.
  - An edit the sync computes while a recovery is running is never sent; it resolves `false` once the
    mirror is replaced. `document/close` resolves a pending edit with `false` instead of throwing, since
    the sync is disposed and throwing would only log a spurious error.
  - Once a client has sent any `document/open`, the host's service process no longer creates a legacy
    document when a guest opens a file the client has not opened. It only seeds the shared text; the
    client syncs it with `document/open` (e.g. on `editorOpened`). Without this, the service process
    would push `awareness/updateDocument` to a versioned client.
  - Legacy `awareness/updateDocument` for a versioned document is ignored with an error; legacy
    `awareness/updateTextSelection` keeps working for it.
  Remaining: step 6 (IntelliJ client) and step 8 (rollout).
- 2026-11-20 — Added `openId` to `document/open`, `document/applyEdit` and `document/getBuffer`
  after review. An `applyEdit` queued at the client while it reopened the same path at the same
  version passed the version check, and the new opening took its echo for a user change once its own
  edit was rejected, duplicating text. The client answers `notOpen` / `null` for a stale `openId`.
  Notifications from the client need no id: they are ordered with `document/open` on the same stream.
- 2026-11-27 — Removed the legacy messages (`awareness/openDocument`, `awareness/updateDocument`,
  client → service `awareness/updateTextSelection`) and `ClientDocument`, superseding the "keep the
  legacy path" parts of steps 3, 5 and 8 and the two legacy bullets of the 2026-11-20 entry. Native
  clients bundle a pinned service process, so none meets a version with the other protocol, and
  inferring the mode from the first `document/open` let a guest's open create a legacy document
  for a versioned host. `service.process.test.ts` now runs two versioned clients. Further review fixes:
  - A `getBuffer` that fails is retried (250 ms, 1 s, 4 s); after that the document is closed, which
    settles its pending edit and ends the recovery, instead of stalling forever. A `getBuffer` that
    is never answered is still waited for.
  - After an edit timeout, a `getBuffer` answer older than the mirror starts a recovery instead of
    rolling the mirror back.
  - The host seeds a file a guest opened first with normalized line endings, like every other seed.
  - `document/*` notifications with missing or positional params are logged and ignored;
    `document/open` after the session closed is ignored; `--edit-timeout` rejects non-integers.
