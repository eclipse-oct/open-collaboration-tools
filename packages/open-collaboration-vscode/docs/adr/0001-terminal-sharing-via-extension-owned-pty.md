---
status: accepted
---

# ADR-0001: Share terminals through an extension-owned pty and dedicated protocol messages

ADRs in this folder apply to the VS Code extension only. Project-wide ADRs are in
[docs/adr/](../../../../docs/adr/). [docs/terminal-sharing.md](../terminal-sharing.md) describes
how the feature works.

## Context

A collaboration session already shares editor contents, selections and the host's file system,
but not a shell. Guests need one most: they have no local checkout, because their workspace is the
virtual `oct://` file system, so a terminal on their own machine can't run anything in the shared
project. Watching the host's build, test run or dev server is a core pair-programming activity.

Several constraints limited the options:

- **No proposed API.** VS Code's terminal-sharing APIs (`window.onDidWriteTerminalData` and
  related) are proposed API, which a published extension cannot use. The stable API has no way to
  read the output of a terminal created with `window.createTerminal()`.
- **No server changes.** The server relays messages without inspecting them; it only looks at
  `Room.Leave`. New message types therefore work against the already-deployed public server. Peer
  metadata is built on the server, though, so guests cannot advertise capabilities to the host.
  Only host → guest capabilities (`InitData.capabilities`) are possible.
- **Other clients.** Theia, the Monaco playground and `oct-agent` only log a line for message types
  they don't know. They won't break, but every broadcast they don't understand produces log noise.
- **1 MB frame limit.** socket.io runs with the default `maxHttpBufferSize` of 1 MB, and a larger
  message closes the connection.
- **Protocol versioning.** In the `0.x` range, peers with a different minor version are treated as
  incompatible, so the new messages must be added in a patch release.
- **Bundling.** The extension is bundled by esbuild into one file, packaged with
  `vsce package --no-dependencies`, and also has a web build that cannot start processes.

## Options considered

### How to get at the shell's output

1. **An extension-owned pty via node-pty, displayed with `vscode.Pseudoterminal`.** The extension
   starts the shell itself and sends the same output to the host's and the guests' views. A real
   pty supports prompts, colours and full-screen programs (TUIs). The downside is a native module.
2. **The shell integration API** (`window.onDidStartTerminalShellExecution` and
   `execution.read()`, stable since VS Code 1.93). It streams output from the user's own terminal
   with no native dependency. But it works per command rather than as a raw pty stream, cannot
   inject input, requires shell integration to be active, and would raise `engines.vscode` from
   `^1.73` to `^1.93`.
3. **`script(1)` as a pty wrapper** (`script -qfc "$shell -i" /dev/null`). A real pty without a
   native dependency, but resizing only partly works, util-linux and BSD versions behave
   differently, and it does nothing on Windows.
4. **Plain `child_process.spawn` with pipes.** Works everywhere with no dependencies, but
   `isatty()` is false: no prompt echo, no TUIs, colours only when forced.

### How to carry terminal data between peers

1. **Dedicated `terminal/*` protocol messages**, with output sent only to subscribers.
2. **The room's Yjs document.** It would provide late-join history and reconnect resync for free.
   But a CRDT is built to merge concurrent edits, and terminal output has exactly one writer, so
   that benefit doesn't apply. Yjs documents also never shrink: one `find /` would add megabytes to
   the room document for good, kept in every peer's memory and replayed to every later joiner.
   Updates would reach every peer, including those that never show a terminal. And terminal output
   would compete with editor sync in the document that the core feature depends on
   ([ADR-0003](../../../../docs/adr/0003-yjs-for-document-convergence.md)).

### How to bring late joiners up to date

1. **A raw byte ring buffer** of recent output. Simple, but cutting it can split an escape
   sequence, and a full-screen program that is already running (`vim`, `htop`) shows up garbled.
2. **A headless terminal emulator** (`@xterm/headless` + `@xterm/addon-serialize`) fed the same
   bytes, serialized on demand. The snapshot is correct, memory is limited by a line count, and the
   emulator knows the terminal's state (title, alternate screen).

### How to package node-pty

1. **Platform-specific VSIXs** (`vsce package --target`), each containing one platform's binary,
   plus a universal fallback VSIX without terminal sharing. Smallest download, but needs a new
   multi-target release workflow. node-pty 1.1 also had no Linux binaries, so they would have had
   to be built in CI.
2. **One universal VSIX containing all of node-pty's prebuilt binaries.** node-pty
   `1.2.0-beta` publishes binaries for Windows, macOS and Linux (glibc) on x64 and arm64.

## Decision

- **The host's extension owns the shell** in a pty created through node-pty. Every participant,
  the host included, sees it through a `vscode.Pseudoterminal`, and no view echoes input locally:
  the pty is the only writer of output. The pty dimensions follow the host's panel.
- **There is no fallback backend.** If node-pty can't be loaded, terminal sharing is turned off
  with a clear message, rather than offering a half-working shell (options 3 and 4). The
  `PtyBackend` interface stays as a seam in case one is wanted later.
- **Terminal data travels in dedicated protocol messages**, not in Yjs. Rare lifecycle events
  (`opened`, `updated`, `closed`) are broadcast. Everything else is sent only to the peers that
  need it: guests request the terminal list when needed, and output goes only to subscribers.
  Output is sent in chunks of at most 32 KB, numbered with `seq` so gaps can be detected. A gap
  triggers a resubscribe, never a request for the missing chunks. The host advertises support with
  `capabilities.terminals`. The protocol change is additive and ships as a patch version.
- **Late joiners get a headless-emulator snapshot.** The emulator only observes; its replies to
  terminal queries are never written back to the pty, and it is not part of the live stream.
- **node-pty ships in a single universal VSIX** with all its prebuilt binaries copied into
  `dist/`. Platforms without a binary keep every other feature.
- **Write access is opt-in per terminal.** `read` is the default, write access requires confirming
  a modal warning, the host validates every input message, and the room's `readonly` permission
  overrides it.

## Consequences

- Terminal sharing works with stable VS Code API and the deployed server, and doesn't change
  `engines.vscode`.
- The extension now ships a native dependency. node-pty is a Node-API addon, so there is no
  rebuild for each Electron version. But the VSIX contains binaries for every platform, and the
  feature depends on a **beta** node-pty release. Moving to platform-specific VSIXs remains
  possible if the package size becomes a problem.
- Alpine/musl, 32-bit and other platforms without a node-pty binary have no terminal sharing.
- The web build must never reach node-pty: it is loaded only through a lazy `require` in a module
  that only `extension.ts` uses.
- Only plain shells are shared, never the user's existing terminals. Profiles, shell integration
  and other VS Code terminal features don't apply to shared terminals. The one exception: if
  `oct.terminal.shell` is empty, the default profile's shell path is used (`vscode.env.shell`),
  without that profile's args or env.
- Write access means guests can run any command on the host's machine as the host, and it bypasses
  `oct.files.exclude`. The feature states this rather than trying to sandbox it.
- Late-join history is limited by the scrollback and the 512 KB snapshot cap. Nothing is
  permanently stored in the room.
- Terminals only work between peers that implement the messages (currently only the VS Code
  extension), and only the host can own a terminal. Letting other peers own terminals would need
  a shared registry, which is the one place a bounded Yjs map would be worth revisiting.
- The shell integration API (option 2 for getting output) is still a good fit for a possible
  future "share this command's output" feature, which would need no native module.
