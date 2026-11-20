# Versioned document edits in the service-process client protocol

Status: proposed · Owner: _unassigned_ · Started: 2026-11-20

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
sends when opening the document and goes up by one with every change of the buffer, whether the
user made it or it came from an edit of the service process. The client is the only party that
increments it, so there is no shared counter to agree on.

### Messages (new; legacy messages stay unchanged)

Use single object parameters rather than positional ones. `messages.ts` already documents that
vscode-jsonrpc enforces parameter arity (`CloseSessionRequest` / `RequestType0`), so adding an
optional positional parameter to an existing message risks rejecting legacy clients.

| Direction | Message | Kind | Payload |
|---|---|---|---|
| client → service | `document/open` | notification | `{ path, text, version }` |
| client → service | `document/didChange` | notification | `{ path, version, changes: TextDocumentInsert[] }`, where `version` is the version *after* the change |
| service → client | `document/applyEdit` | request | `{ path, baseVersion, changes: TextDocumentInsert[] }` → `{ applied: boolean }` |
| service → client | `document/getContent` | request | `{ path }` → `{ text, version }` (recovery only, see below) |

Names are placeholders; settle them in step 1.

Rules for `document/applyEdit`. These are the adapter contract, translated:

1. The client applies the changes atomically, and only if its current version equals `baseVersion`.
   Otherwise it applies nothing and answers `{ applied: false }`.
2. If it applies them, it **first** sends the matching `document/didChange` (version
   `baseVersion + 1`) and **then** answers `{ applied: true }`. The stdio stream is ordered, so the
   service process sees the echo before the result, which is what `YjsTextDocumentSync` relies on to
   tell its own edit apart from an identical user edit.
3. Offsets are UTF-16 code units of the buffer as the client holds it (the current convention; state
   it explicitly). Line endings are the client's own.

### Service-process side

- **Negotiation per document:** a document opened with `document/open` uses versioned mode, and one
  opened with legacy `awareness/openDocument` keeps the current `ClientDocument` behaviour. This
  needs no global handshake, and a client can migrate one editor type at a time.
- A `VersionedClientDocument` adapter:
  - keeps a mirror of the client buffer and its version, updated from `document/didChange`;
  - `getText()` returns the mirror;
  - `applyChanges()` sends `document/applyEdit` with `baseVersion` = the mirror's version and
    resolves with `applied`. The echo arrives through `didChange` → `sync.onDidChangeContent()`
    before the response, so the sync's existing logic applies unchanged.
- **Gap detection:** a `didChange` whose version is not `mirror.version + 1` means a change was lost.
  Call `document/getContent`, replace the mirror, and call `sync.refresh()`. The shared text is
  authoritative, so the pump then repairs the buffer with minimal edits.
- **No timeout-as-rejection.** If `applyEdit` never answers, do not resolve `false`. A late
  `didChange` for an edit the sync believes was rejected would be written to Yjs as a *local*
  change and duplicate remote text. Instead, after a timeout, log an error and recover through
  `document/getContent` as for a gap.
- Selections: `UpdateTextSelection` from the client addresses the buffer as last reported, which is
  correct as long as the client sends it after the corresponding `didChange`. Outgoing selections
  may address a version the client has already moved past. That is acceptable at first, because
  `onDidSync` re-sends them once the sync catches up. See open questions.

## Steps

1. **Settle the protocol.** Agree on message names, payloads and the ordering rule with the owners
   of the native clients (the IntelliJ integration in `eclipse-oct/oct-intellij`, plus any Eclipse
   client). Check vscode-jsonrpc's arity behaviour for object-parameter messages. Write the
   protocol into the doc comments in `messages.ts` and a "Document synchronization" section in the
   service-process `Readme.md`.
2. **Message types** in `messages.ts`, exported from the package entry point (the package's `main`
   is `lib/messages.js`, which is what native-client tests and bindings consume).
3. **`VersionedClientDocument`** in `collaboration-instance.ts` next to `ClientDocument`, plus the
   handlers in `message-handler.ts`. Route `document/didChange` to the document. Keep the legacy
   path untouched.
4. **Recovery:** gap detection, the `applyEdit` timeout, and `document/getContent` followed by
   `sync.refresh()`.
5. **Tests** in `packages/open-collaboration-service-process/test/`:
   - Extend the fake `Client` in `service.process.test.ts` with a versioned document that honours
     `baseVersion`.
   - The race: the client changes its buffer between receiving `applyEdit` and applying it. Both
     peers must converge, with the user's text where it was typed.
   - The echo: the user makes exactly the change of an in-flight edit, which is then rejected.
   - Gap recovery, and a legacy client in the same session still working.
6. **Docs:** update the bullet in `docs/product-specs/session-and-peer-sync.md` so that the
   guarantee holds for versioned service-process clients and the limitation names only legacy
   clients. Update `docs/ARCHITECTURE.md` if it describes the client protocol.
7. **Rollout:** release the service process with both modes, then update the native clients. Decide
   on a deprecation window for the legacy messages; do not remove them in this plan.

## Open questions

- Who implements the client side in `oct-intellij` (and Eclipse), and in which release?
- Should outgoing `UpdateTextSelection` carry a version so that clients can drop stale selections,
  or is the re-send on `onDidSync` enough?
- Does a client need a `document/close` notification as well? Today `ClientDocument`s are never
  disposed before the session ends, which matters more once each one holds a mirror and pending
  requests.
- Does the protocol change warrant an ADR (client protocol versioning and compatibility policy)?

## Progress log

- 2026-11-20 — Plan written after reviewing `389e36e` ("Improve editor diff syncing"), which
  introduced `YjsTextDocumentSync` and documented the service-process limitation.
