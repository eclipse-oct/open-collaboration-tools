# Open Collaboration Service Process

Open Collaboration Tools is a collection of open source tools, libraries and extensions for live-sharing of IDE contents, designed to boost remote teamwork with open technologies. For more information about this project, please [read the announcement](https://www.typefox.io/blog/open-collaboration-tools-announcement/).

This package is a standalone Node.js application, which helps to simplify integration of OCT with non-TypeScript environments, by providing a stdin/stdout based [JSON-RPC](https://www.jsonrpc.org/) API.

It takes over encryption, session lifecycle management, and includes Yjs integration for collision-free real-time editing of documents,
so client applications do not need to implement these complex features themselves.

The artifact needs to be cjs to be able to be bundled and made into an SEA because of socket.io's dynamic requires.

## Usage

### Starting the Service Process

Start the process by either using [Node.js](https://nodejs.org) to call `process.js` or use a prebuilt executable:

```sh
node ./lib/process.js --server-address http://localhost:8100 --auth-token <your-auth-token>
```

- `--server-address` (**required**): The address of the collaboration server to connect to (e.g., `https://api.open-collab.tools`).
- `--auth-token` (**optional**): The authentication token to use for the session, if saved by the application from a previous login
- `--edit-timeout` (**optional**): How long, in milliseconds, to wait for the answer to a `document/applyEdit` before the client's buffer is read anew with `document/getBuffer`. Defaults to 5000.

### Communication Protocol

All communication happens via JSON-RPC 2.0 messages over stdin/stdout.
See [messages.ts](src/messages.ts) for service process specific awareness or lifecycle messages. Other messages follow the open-collaboration-protocol.

For specific examples see `service.process.test.ts` or the [IntellIJ integration](https://github.com/eclipse-oct/oct-intellij)

### Sending and Receiving Binary Data

- For efficient document and file transfer, binary data is supported.
- Use the `BinaryData` type for parameters or results that contain binary content.
- Binary data is encoded as base64-encoded [MessagePack](https://msgpack.org/) in the `data` field of a `BinaryData` object.

#### Example: Sending Binary Data

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "awareness/getDocumentContent",
  "params": ["path/to/file"]
}
```

The response will be:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "type": "binaryData",
    "data": "<base64-encoded-messagepack>"
  }
}
```

Or sending Binary Data as a Parameter:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "fileSystem/writeFile",
  "params": [
    {
      "type": "binaryData",
      "data": "<base64-encoded-messagepack>"
    }
  ]
}
```

## Document synchronization

A client opens every text document it wants to edit collaboratively. There are two modes, chosen per
document by the message that opens it:

- **Versioned** (`document/open`): the service process only applies an edit that still fits the
  client's buffer, and recognises the edit when the client reports it back. Edits the user types
  while a remote change is on its way land where they were typed. Use this mode for new clients.
- **Legacy** (`awareness/openDocument`, `awareness/updateDocument`): changes are sent to the client
  without confirmation and taken as applied the moment they are sent. If the user types before the
  client has applied one, the client and the session diverge.

All versioned messages take a single object parameter, sent by name. The types are in
[messages.ts](src/messages.ts).

| Direction | Message | Kind | Payload |
|---|---|---|---|
| client → service | `document/open` | notification | `{ path, text, version, eol? }` |
| client → service | `document/close` | notification | `{ path }` |
| client → service | `document/didChange` | notification | `{ path, version, changes: TextDocumentInsert[] }` |
| client → service | `document/didChangeSelection` | notification | `{ path, version, selections: ClientTextSelection[] }` |
| service → client | `document/applyEdit` | request | `{ path, baseVersion, changes: TextDocumentInsert[] }` → `{ result: 'applied' \| 'outdated' \| 'notOpen' }` |
| service → client | `document/getBuffer` | request | `{ path }` → `{ text, version }`, or `null` if the document is not open |

### Versions

Every open document has an integer version, owned by the client. It starts at the `version` sent
with `document/open` and goes up by exactly one with every change of the buffer the client reports,
whether the user made it or it came from `document/applyEdit`. The version belongs to the document,
not to an editor: keep one counter and one change listener per document, however many editors show
it. IntelliJ's `Document.modificationStamp` does not qualify, as it does not go up by one per change.

`eol` (`'\n'` or `'\r\n'`) is the line ending the service process uses for text it inserts. Without
it, the service process guesses from the buffer.

Opening a path that is already open replaces the document. `document/close` stops the
synchronization; send it when the last reason to track the document goes away, not when an editor
is closed while the document is still open elsewhere.

### `document/didChange`

1. `version` is the version *after* the change.
2. All changes of one notification address the buffer as it was before any of them, are sorted, and
   do not overlap.
3. A change is reported as soon as it happens, before any later message about the document
   (selection, answer to a request).
4. Offsets are UTF-16 code units of the buffer as the client holds it. Inserted text is reported as
   it was actually inserted, after any line-ending conversion of the client.

### `document/applyEdit`

1. The changes address the buffer at `baseVersion`, all of them the buffer as it was before any of
   them, sorted and not overlapping.
2. The client applies them only if its current version equals `baseVersion`, and then all of them
   at once (in IntelliJ: in one write action), back to front, so that each change still addresses
   the original buffer. Otherwise it applies nothing and answers `outdated`.
3. An applied edit is reported as **exactly one** `document/didChange` with version
   `baseVersion + 1`, carrying the changes as applied. Splitting it into several notifications
   makes the service process take it for a change of the user and duplicates it.
4. The client **first** sends that `document/didChange` and **then** answers `applied`.
5. For a path the client does not have open, it answers `notOpen`.

### Ordering and threading

The client handles `document/applyEdit` and `document/getBuffer` of a document **in the order it
received them**, on the thread that changes the buffer (in IntelliJ: the EDT, inside the write
action), and sends every resulting `document/didChange` before the answer. The answer to
`document/getBuffer` therefore reflects every edit sent before it, applied or rejected.

### `document/didChangeSelection`

`version` is the version of the buffer the offsets address. Read the offsets and the version
together, at a moment when every change has been reported. In IntelliJ the caret moves while a
document change is being processed, possibly before the change listener has reported it, so read
selections after the write action (e.g. deferred with `invokeLater`), not in the caret listener.
Selections of other peers are still sent with `awareness/updateTextSelection`.

### Recovery

The service process mirrors the client's buffer from the reported changes. If the mirror cannot be
trusted, it reads the buffer with `document/getBuffer`, replaces the mirror, and repairs the buffer
with minimal edits from the shared text. Each occurrence is logged to stderr as an error, since it
only happens through a client bug or a hung client:

- a `document/didChange` skips a version or does not fit the buffer: changes that were never reported
  are reverted in the editor,
- an answer contradicts the reported changes (`applied` without its `document/didChange`, or
  `outdated` for the latest reported version),
- a `document/applyEdit` is not answered within `--edit-timeout`. A client that answers both requests
  late, in order, is handled without loss.

### Mixing both modes

A document opened with `awareness/openDocument` keeps the legacy behaviour, so a client can migrate
one editor type at a time. Once a client has opened any document with `document/open`, the service
process no longer opens legacy documents on its behalf: when a guest opens a file the host's client
has not opened, the host's file content is shared, and the client syncs it once it sends
`document/open` for it (for example in reaction to `editorOpened`). A versioned client ignores
`awareness/updateDocument`.

## Release

Service process binaries are released through GitHub Actions.

### Automated binary release

The workflow `.github/workflows/release-service-process.yml` creates binaries for Linux, macOS, and Windows and publishes them to a GitHub Release.

Trigger a release by pushing a tag in this format: `service-process-v0.3.1`

The workflow publishes:

- `oct-service-process-<version>-linux-x64`
- `oct-service-process-<version>-macos-arm64` (Apple Silicon)
- `oct-service-process-<version>-macos-x64` (Intel)
- `oct-service-process-<version>-windows-x64.exe`
- `SHA256SUMS.txt`

You can also run the workflow manually with `workflow_dispatch` from the Actions tab.

### Build locally from source

If you need to build the executable without downloading a release artifact:

```sh
npm ci
npm run create:executable --workspace=open-collaboration-service-process
```

The executable is written to:

- `packages/open-collaboration-service-process/bin/oct-service-process` on Linux and macOS
- `packages/open-collaboration-service-process/bin/oct-service-process.exe` on Windows
