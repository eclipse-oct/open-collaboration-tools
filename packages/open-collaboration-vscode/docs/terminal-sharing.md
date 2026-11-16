# Terminal Sharing

The host of a collaboration session can share a terminal with the guests. Guests see the host's
shell output live and, if the host allows it, can type into it. This document describes how the
feature works. The reasons behind the design, and the alternatives that were rejected, are in
[ADR-0001](adr/0001-terminal-sharing-via-extension-owned-pty.md).

Terminal sharing is only available in the desktop (node) build of the extension. The web build
does not support it, because a web extension cannot start a process.

## Using it

| Command | Who | What it does |
| --- | --- | --- |
| `oct.shareTerminal` — *Share Terminal* | host | Asks for an access mode, then opens a new shared terminal in the panel |
| `oct.openSharedTerminal` — *Open Shared Terminal* | guest | Lists the host's shared terminals and opens the one you pick |

Both commands are in the command palette and in the terminal panel's title bar while a session is
active. When the host shares a terminal, guests also get a notification with an *Open* button.

Shared terminals have a `$(broadcast)` icon. Only terminals created with *Share Terminal* are
shared. The extension never attaches to terminals that already exist.

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `oct.terminal.defaultAccessMode` | `read` | The access mode preselected when sharing a terminal (`read` or `readWrite`) |
| `oct.terminal.shell` | empty | Shell executable. If empty: `$SHELL` (or `/bin/bash`) on Linux/macOS, `%COMSPEC%` (or `powershell.exe`) on Windows |
| `oct.terminal.shellArgs` | `[]` | Arguments passed to the shell |
| `oct.terminal.recommendLocalEcho` | `true` | Whether guests opening a write-enabled terminal are asked to turn on `terminal.integrated.localEchoEnabled` |

Scrollback follows VS Code's own `terminal.integrated.scrollback` on both sides.

The shell starts in the first workspace folder if it is a `file:` folder, and in the home
directory otherwise.

## Architecture

The host's extension owns the shell process. It runs the shell in a pseudo-terminal (pty) through
the native [node-pty](https://github.com/microsoft/node-pty) module. Every participant, the host
included, sees the shell through a `vscode.Pseudoterminal`, VS Code's API for terminals whose
content an extension provides.

```
                       ┌───────────── HOST (extension host process) ──────────────┐
                       │                                                          │
  host's terminal      │   SharedTerminal                                         │
  panel  ◄────write────┤   ├─ vscode.Pseudoterminal   (view only, no local echo)  │
        ──handleInput──┤   │                                                      │
                       │   ├─ node-pty  ◄── THE SOURCE OF TRUTH ──►  shell        │
                       │   │     onData ──► OutputChunker ──► subscribers         │
                       │   │     write  ◄── host input + guest input              │
                       │   └─ @xterm/headless  (passive mirror, for snapshots)    │
                       └────────────────┬────────────────┬────────────────────────┘
                         terminal/output│ (targeted)     │terminal/input
                                        ▼                ▲
                       ┌───────────── GUEST ─────────────┴─────────────────────────┐
                       │   GuestTerminal                                           │
                       │   └─ vscode.Pseudoterminal  (view only, no local echo)    │
                       └───────────────────────────────────────────────────────────┘
```

The design depends on three invariants:

1. **Nobody echoes input locally.** Neither the host's nor a guest's `Pseudoterminal` displays
   the keys it receives. Input goes to the pty, the pty echoes it, and the echo reaches everyone
   through the single output stream. Output therefore has exactly one writer, so nothing has to be
   merged.
2. **The shell process outlives every guest view.** When a guest closes a shared terminal, it only
   unsubscribes. When the host closes it, the process is killed.
3. **The host owns the dimensions.** The size of the host's terminal panel sets the pty size.
   Guests display the terminal at that size (see [Dimensions](#dimensions)).

## Components

All code is in [src/terminal/](../src/terminal/).

| File | Role |
| --- | --- |
| [pty-backend.ts](../src/terminal/pty-backend.ts) | `PtyBackend` interface (`write`, `resize`, `onData`, `onExit`, `kill`). A seam for alternative backends |
| [node-pty-backend.ts](../src/terminal/node-pty-backend.ts) | node-pty implementation, loaded by a lazy `require`. `isNodePtyAvailable()` checks whether the native module loads |
| [output-chunker.ts](../src/terminal/output-chunker.ts) | Collects pty output for ~10 ms, caps each message at 32 KB without splitting a UTF-8 character, and numbers the chunks with `seq` |
| [terminal-emulator.ts](../src/terminal/terminal-emulator.ts) | Headless xterm.js (`@xterm/headless` + `@xterm/addon-serialize`) that produces late-join snapshots |
| [shared-terminal.ts](../src/terminal/shared-terminal.ts) | Host side of one terminal: the pty, the host's `Pseudoterminal`, the emulator, the subscriber set, and the access-mode check |
| [guest-terminal.ts](../src/terminal/guest-terminal.ts) | Guest side of one terminal: a `Pseudoterminal` that writes received output, forwards input when allowed, and uses the host's dimensions |
| [terminal-service.ts](../src/terminal/terminal-service.ts) | Per-session orchestration: protocol handlers, commands, output routing, resync, cleanup |
| [terminal-commands.ts](../src/terminal/terminal-commands.ts) | Registers the commands. Called only from [extension.ts](../src/extension.ts) |

`TerminalService` is reset whenever a room is joined or the `CollaborationInstance` is disposed.
Only one session is active at a time, so the service keeps a single set of state.

### Web build isolation

node-pty is a native module and must never be reachable from
[extension-web.ts](../src/extension-web.ts). Two rules keep it out of the web build:

- node-pty is loaded only by the lazy `require` in `node-pty-backend.ts`, never by a static
  import. The lazy load also turns a missing module into an error message instead of failing
  extension activation.
- `terminal-commands.ts` (and everything under `src/terminal/`) is wired up from `extension.ts`
  only, never from `commands.ts` or anything else that `extension-web.ts` imports.

## Protocol

Messages are defined in
[messages.ts](../../open-collaboration-protocol/src/messages.ts) (`Messages.Terminal`) and
[types.ts](../../open-collaboration-protocol/src/types.ts). They are exposed through
`connection.terminal` ([connection.ts](../../open-collaboration-protocol/src/connection.ts)).
The server relays them like any other message and needed no changes.

| Message | Kind | Direction | Purpose |
| --- | --- | --- | --- |
| `terminal/list` | request | guest → host | List the shared terminals (`TerminalInfo[]`). Guests ask when needed and do not keep their own copy of the list |
| `terminal/subscribe` | request | guest → host | Start receiving output. Returns a `TerminalSnapshot`. `TerminalSubscribeOptions.scrollback` limits how much history is sent |
| `terminal/unsubscribe` | notification | guest → host | Stop receiving output |
| `terminal/input` | notification | guest → host | Keystrokes |
| `terminal/viewResize` | notification | guest → host | The guest's panel size. Currently not used for anything |
| `terminal/output` | notification | host → subscriber | A `TerminalChunk` (`seq`, `data`). Sent only to subscribers |
| `terminal/opened` | broadcast | host → room | A terminal was shared |
| `terminal/updated` | broadcast | host → room | Name, mode or dimensions changed |
| `terminal/closed` | broadcast | host → room | The process exited or the host closed the terminal |

- Lifecycle events are broadcast because they are rare. Peers that don't support terminals
  (Theia, the Monaco playground, `oct-agent`) only log an unhandled-message line for them.
  Output goes only to the peers that subscribed.
- Guests ignore lifecycle messages that don't come from the host, and ignore
  `updated`/`closed` for terminals they don't have open.
- The host sets `capabilities.terminals` in `InitData` to `isNodePtyAvailable()`. If a host
  can't share terminals, guests see a message instead of an empty list.
- `TerminalChunk.data` is a string, not `Binary`. node-pty already decodes UTF-8, including
  multi-byte characters split across reads, and `Pseudoterminal.onDidWrite` takes strings.

## Dimensions

Each participant's terminal panel has its own size, but a pty has only one. The host's
`Pseudoterminal` dimensions are used: they resize the pty and the headless emulator, and changes
are broadcast with `terminal/updated`. Guests display the terminal at the host's size by firing
`onDidOverrideDimensions`, so lines wrap the same way for everyone. Guests report their own panel
size with `terminal/viewResize`, but the host ignores it for now.

## Late join, reconnect and resync

The host feeds every pty byte into a headless xterm.js instance. That instance does nothing except
answer "what does the screen look like right now?":

- Its `onData` is **never** connected to the pty. Programs send status queries (cursor position,
  device attributes) that the host's real terminal already answers through `handleInput`. A second
  answer would corrupt the session.
- It is not part of the live stream. Guests receive the raw pty chunks.

Subscribing works like this:

1. The host flushes the chunker. The snapshot's `buffer` and `seq` then describe the same point in
   the stream.
2. The host serializes the emulator with at most the scrollback the guest asked for. If the
   snapshot is larger than 512 KB, history is halved until it fits. The visible screen is always
   included.
3. The guest sets the host's dimensions, resets its view (`\x1bc`) and writes the buffer.

After that, every chunk must have exactly the expected `seq`:

- `seq` lower than expected: the chunk is already in the snapshot and is skipped.
- `seq` higher than expected: there is a gap, so the guest subscribes again and redraws from a
  fresh snapshot. Missing chunks are never requested individually.
- Only one resync runs per terminal at a time. Output that arrives during a resync waits for it
  and is then applied in order.
- After `onReconnect`, guests resubscribe to every terminal they have open. The host keeps the
  process running throughout.

## Security model

A terminal with write access lets guests run any command on the host's machine as the host.

- **`read` is the default.** Picking *Read & Write* shows a modal warning before the terminal is
  shared. The warning states that a shell bypasses `oct.files.exclude`: `cat .env` shows the file to
  everyone in the room. Content is still end-to-end encrypted, so the server can't read it.
- **The workspace must be trusted.** Sharing is refused in an untrusted workspace.
- **The host checks every input message.** Input is written to the pty only if the sender is a
  current subscriber of that terminal and the terminal's mode is `readWrite`. What a sender claims
  about itself is never trusted.
- **Room-wide `readonly` overrides the terminal's mode.** While the room's permissions are
  read-only, guest input is dropped, whatever mode the terminal was shared with.
- **The host's own keystrokes** are never checked against the access mode.
- **Processes don't outlive the session.** Closing the host's terminal view kills the process and
  broadcasts `terminal/closed`. Leaving or closing the session, and deactivating the extension,
  dispose every `SharedTerminal`, which kills its process. Guests that leave are removed from the
  subscriber sets.

### Local echo

Guests see their own keystrokes only after the round trip to the host. When a guest opens a
write-enabled terminal, the extension suggests enabling `terminal.integrated.localEchoEnabled`
once per window. That setting's default, `auto`, only applies to terminals in remote windows, not
to extension terminals. `oct.terminal.recommendLocalEcho` turns the suggestion off.

## Packaging and platform support

esbuild cannot bundle node-pty, so it is marked `external`.
[scripts/esbuild.ts](../scripts/esbuild.ts) copies node-pty's runtime files (`package.json`,
`LICENSE`, `lib/`, `prebuilds/`) into `dist/node_modules/node-pty`. The lazy `require` in
`dist/extension.js` finds the module there, so `vsce package --no-dependencies` keeps working.
`fs.cpSync` keeps file modes, so the macOS `spawn-helper` stays executable.

node-pty is a Node-API addon, so its binaries work across Node.js and Electron versions without
rebuilding. Version `1.2.0-beta` includes prebuilt binaries for:

| Platform | x64 | arm64 |
| --- | --- | --- |
| Windows (ConPTY) | ✓ | ✓ |
| macOS | ✓ | ✓ |
| Linux (glibc) | ✓ | ✓ |

All of them ship in the same, universal VSIX. VS Code installs the extension wherever the
extension host runs, so with Remote-SSH, WSL, Dev Containers or Codespaces the binary for the
*remote* machine is loaded.

**Unsupported platforms**, such as Alpine/musl and 32-bit systems, have no matching binary. There,
`isNodePtyAvailable()` returns `false`. The host advertises `capabilities.terminals: false`, *Share
Terminal* shows an error with a link to this document, and the rest of the extension works
normally.

## Known limitations

- **No backpressure handling.** Output is coalesced and capped per message, but nothing is ever
  dropped. A process that writes faster than the network can carry will make guests fall behind.
- **Write access is per terminal, not per guest.** It can't be revoked for one guest. The only
  room-wide switch is the `readonly` permission.
- **`TerminalInfo.mode` isn't updated** when the room becomes read-only. The host enforces it, but
  guests still see the terminal's original mode.
- **Renames are polled.** VS Code has no event for renaming a terminal tab, so the host checks the
  names once a second and broadcasts changes.
- **Only the host can share.** Guests can't ask the host for a terminal.

## Testing

Manual check: two VS Code windows on `test-collab-project`. One hosts and shares a terminal, the
other joins and opens it. Test both access modes, closing on each side, a late join while a TUI
(`htop`, `vim`) is running, and a reconnect. Before a release, also test once from a Remote-SSH
host to cover a remote extension host.

`OutputChunker`/`splitByBytes` and `TerminalEmulator.serialize` don't depend on VS Code or
node-pty, so unit tests for them can go in [test/](../test/).
