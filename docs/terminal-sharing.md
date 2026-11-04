# Design: Terminal Sharing for the VS Code Extension

**Status:** Draft / not yet implemented
**Scope:** `packages/open-collaboration-vscode`, `packages/open-collaboration-protocol`
**Server impact:** none

## 1. Motivation

A collaboration session currently shares editor contents, selections and the host's file
system, but not a shell. Guests are the ones who need it most: they have no local checkout
at all — their workspace is the virtual `oct://` file system provided by
[collaboration-file-system.ts](../packages/open-collaboration-vscode/src/collaboration-file-system.ts) —
so a local terminal on a guest's machine is useless for the shared project. Watching the
host's build, test run or dev server is a core pair-programming activity that the extension
cannot support today.

VS Code's own terminal-sharing primitives (`window.onDidWriteTerminalData` and friends) are
behind proposed API and therefore unavailable to a published extension. This design achieves
terminal sharing without proposed API by having the extension own the shell process itself
and render it through the stable `vscode.Pseudoterminal` API on every participant.

## 2. Constraints from the existing codebase

| Finding | Consequence |
| --- | --- |
| The server relays messages generically; it only inspects `Room.Leave` ([peer.ts](../packages/open-collaboration-server/src/peer.ts)) | **No server changes needed.** New message types work against the already-deployed public instance |
| Unknown methods only log `No handler registered…` ([abstract-connection.ts](../packages/open-collaboration-protocol/src/messaging/abstract-connection.ts)) | Old peers (Theia, monaco playground, `oct-agent`) will not break, but every broadcast they don't understand gets logged — keep broadcasts to rare lifecycle events and target high-frequency traffic |
| socket.io is created with default options ([collaboration-server.ts](../packages/open-collaboration-server/src/collaboration-server.ts)), so `maxHttpBufferSize` is **1 MB** | Output chunks must be hard-capped; 32 KB per message is a safe target |
| `Peer.metadata` is built server-side and carries only encryption/compression info ([peer.ts](../packages/open-collaboration-server/src/peer.ts)) | Guest→host capability advertisement is impossible without a server change; capability negotiation must happen client-side |
| `Capabilities` in `InitData` is an empty interface ([types.ts](../packages/open-collaboration-protocol/src/types.ts)) | Host→guest capability flags *are* possible and should be used |
| In the `0.x` range, differing minor versions are treated as incompatible ([version.ts](../packages/open-collaboration-protocol/src/utils/version.ts)) | Ship additive messages as a patch bump (`0.3.4`), not `0.4.0` |
| The extension is bundled by esbuild into a single CJS file and packaged with `vsce package --no-dependencies`; there is also a **web** build ([scripts/esbuild.ts](../packages/open-collaboration-vscode/scripts/esbuild.ts)) | A native module cannot be bundled this way; it needs `external` + a copy step + platform-specific packaging, and must never be reachable from the web build |
| No VSIX release workflow exists yet (only [ci-cd.yml](../.github/workflows/ci-cd.yml), [images.yml](../.github/workflows/images.yml), [release-service-process.yml](../.github/workflows/release-service-process.yml)) | Platform-specific publishing is greenfield, but [release-service-process.yml](../.github/workflows/release-service-process.yml) already establishes the OS-matrix pattern to follow |

## 3. Architecture

Three parties, one source of truth: the shell process owned by the host's extension.

```
                       ┌───────────── HOST (extension host process) ──────────────┐
                       │                                                          │
  host's terminal      │   SharedTerminal                                         │
  panel  ◄────write────┤   ├─ vscode.Pseudoterminal   (view only, no local echo)  │
        ──handleInput──┤   │                                                      │
                       │   ├─ node-pty  ◄── THE SOURCE OF TRUTH ──►  shell        │
                       │   │     onData ──► Chunker ──► subscribers               │
                       │   │     write  ◄── merge(host input, guest input)        │
                       │   └─ @xterm/headless  (passive mirror, for snapshots)    │
                       └────────────────┬────────────────┬────────────────────────┘
                          terminal/output│ (targeted)     │terminal/input
                                         ▼                ▲
                       ┌───────────── GUEST ──────────────┴────────────────────────┐
                       │   GuestTerminal                                           │
                       │   └─ vscode.Pseudoterminal  (view only, no local echo)    │
                       └───────────────────────────────────────────────────────────┘
```

Three invariants make this tractable:

1. **Nobody echoes locally.** Neither the host's nor a guest's `Pseudoterminal` renders the
   input it receives. Input goes to the pty; the pty echoes it; the echo returns through the
   single output stream to everyone. This is what makes the design a one-way fan-out of a
   single-writer stream plus a command channel, rather than a genuine three-way merge.
2. **The shell process outlives every view.** Closing a guest's terminal means unsubscribing.
   Closing the host's terminal kills the process.
3. **Dimensions are owned by the host** and applied to guests via `onDidOverrideDimensions`,
   so line wrapping is identical for everyone (§10).

## 4. Runtime: node-pty

`vscode.window.createTerminal()` gives no way to read a terminal's output without proposed
API, so the extension must own the child process — which means a real pty, which means a
native module.

### 4.1 Findings (node-pty 1.1.0)

- It depends on `node-addon-api ^7.1.0`, i.e. it is a **Node-API addon**. Node-API is ABI-stable
  across Node.js *and* Electron, so there is no `electron-rebuild` step and no per-Electron-version
  rebuild treadmill. This is the fact that makes bundling viable.
- It ships prebuildify-style `prebuilds/{platform}-{arch}/` directories and its `prebuild.js`
  check contains no Electron-specific logic — it keys off `process.platform`/`process.arch` only.
- Prebuilds are published for `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`.
- The Windows prebuilds include **ConPTY** (`conpty.node`, `conpty.dll`, `OpenConsole.exe`) with a
  winpty fallback, so Windows gets a real pty rather than a degraded mode.
- MIT licensed, and maintained by Microsoft for VS Code itself.

### 4.2 The gap: no Linux prebuilds

`install` is `node scripts/prebuild.js || node-gyp rebuild`, so on Linux node-pty compiles from
source (needs python3 and a C++ toolchain). That is not a niche concern: under Remote-SSH, WSL,
Dev Containers and Codespaces the extension host runs on the **remote** machine, so a workspace
extension like this one meets Linux constantly.

We therefore build `linux-x64` and `linux-arm64` prebuilds ourselves in CI (and musl-linked ones
if we want Alpine dev containers). macOS and Windows need no build step — we repackage upstream's
prebuilds. GitHub's arm64 Linux runners can cover `linux-arm64` natively; an Alpine container
covers musl. [`@homebridge/node-pty-prebuilt-multiarch`](https://github.com/homebridge/node-pty-prebuilt-multiarch)
exists to fill the same hole and is worth evaluating, but taking a fork means inheriting its
release cadence — building from upstream is preferable.

### 4.3 Packaging: platform-specific extensions

VS Code supports platform-specific extensions (`vsce package --target <target>`): several VSIXs
share one extension id and version, and the marketplace serves each client the matching one. A
universal (untargeted) VSIX acts as the fallback for platforms with no specific build. VS Code
resolves this per extension-host location, so a remote host correctly receives the VSIX for the
*remote* platform.

Per-target differences are limited to *which prebuild directory is copied into `dist/`* — `main`,
`browser` and all source stay identical.

| VSIX target | node-pty prebuild | Origin |
| --- | --- | --- |
| `win32-x64` | `win32-x64` (ConPTY) | upstream |
| `win32-arm64` | `win32-arm64` (ConPTY) | upstream |
| `darwin-x64` | `darwin-x64` | upstream |
| `darwin-arm64` | `darwin-arm64` | upstream |
| `linux-x64` | `linux-x64` | built in CI |
| `linux-arm64` | `linux-arm64` | built in CI |
| `alpine-x64` / `alpine-arm64` (optional) | musl-linked | built in CI (Alpine container) |
| *universal fallback* | none | terminal sharing disabled, everything else works |

The universal fallback build is a feature, not a leftover: it is exactly the graceful-degradation
build for unusual platforms and for vscode.dev.

Concrete changes required:

- esbuild: `external: ['node-pty']` plus a copy step in
  [scripts/esbuild.ts](../packages/open-collaboration-vscode/scripts/esbuild.ts) taking a
  `--target` flag and copying **only** the matching prebuild into `dist/node-pty/`. The published
  package is ~64 MB unpacked across 286 files, so it must never be shipped wholesale.
- Keep `vsce package --no-dependencies`; load the module with a lazy `require` resolved against
  `context.extensionPath`.
- The web build must never reach the import: keep it behind a lazy require inside a node-only
  module, never a static import from anything [extension-web.ts](../packages/open-collaboration-vscode/src/extension-web.ts) pulls in.
- `spawn-helper` (darwin/linux) needs its exec bit. Zip preserves mode bits, but a runtime
  `fs.chmod` guard is cheap insurance.
- A new tag-triggered release workflow, modelled on
  [release-service-process.yml](../.github/workflows/release-service-process.yml), that packages
  and publishes every target at one version (marketplace and Open VSX — verify `ovsx --target`
  support before relying on it).
- All targets must carry the same version number.

**Staging option:** ship the four upstream-prebuilt targets (Windows, macOS) plus the universal
fallback first, and add the Linux targets once the CI compile step is proven. Local development is
unaffected either way, since `npm i node-pty` compiles on a developer's machine.

### 4.4 No fallback backend

Earlier drafts proposed a `script(1)` pty shim and a pipe-based fallback. With ConPTY and
Node-API prebuilds both available, these are dropped: if the native module cannot be loaded, the
feature is **disabled with an actionable message** rather than offering a half-working shell that
generates its own class of bug reports. The `PtyBackend` seam is still worth keeping so a fallback
can be added later if users on unsupported platforms ask for one.

## 5. Terminal state: @xterm/headless

The host feeds the same pty bytes into a headless xterm.js instance — no DOM, pure JS, bundles
without trouble — which buys three things:

1. **Accurate late-join snapshots** via `@xterm/addon-serialize`. This replaces a raw byte ring
   buffer: no risk of slicing an escape sequence in half, and a `vim`/`htop` session already
   running renders *correctly* for someone who joins mid-stream instead of as garbage.
2. **Memory bounded by construction.** A `scrollback: N` lines cap is better behaved than
   "the last 256 KB of bytes".
3. **Real terminal state.** `onTitleChange` for the tab title, `buffer.active.type === 'alternate'`
   to detect that a TUI owns the screen, and parser hooks (`registerOscHandler`) for OSC 7 (cwd)
   and OSC 133 (prompt marks) should we later want per-command awareness.

Two boundaries must hold:

- **Never wire `headless.onData` back to the pty.** Programs send device-status queries (CPR, DA)
  expecting *the terminal* to answer, and in this architecture the answering terminal is the host's
  real xterm via `handleInput`. A second responder produces duplicated or interleaved replies and
  corrupt state. The emulator is a strictly passive observer, and the same applies to its
  `onResize`.
- **It is not on the streaming path.** Guests receive raw pty chunks, which is lossless and cheap.
  The emulator exists only to answer "what does the screen look like right now".

It would work unchanged if the monaco/web client ever renders shared terminals.

## 6. Why not Yjs

The room already has a Yjs document and a provider with resync
([yjs-provider.ts](../packages/open-collaboration-yjs/src/yjs-provider.ts)), so carrying terminal
output in it would give late-join scrollback and reconnect resync for free. It was evaluated and
rejected for the streams:

- **CRDT merge semantics buy nothing here.** Output has exactly one writer (the pty). There is no
  concurrent edit to reconcile — the single property Yjs exists to provide is the one property this
  data does not need.
- **Monotonic growth is disqualifying for terminals.** Yjs documents do not shrink and deletions
  leave tombstones. One `find /` or verbose test run would put megabytes into the room document
  permanently: held in every peer's memory, replayed to every future joiner, and re-scanned by
  every state-vector resync. Terminal scrollback must be prunable; a CRDT log is not.
- **It reaches the wrong peers.** Document updates go to everyone, so the monaco playground and
  `oct-agent` would pay for output they never render.
- **The room document is load-bearing.** A firehose of terminal chunks competing with editor
  updates in the same document is an avoidable risk to the feature that already works.

The one place Yjs would earn its keep is a bounded `Y.Map<TerminalInfo>` *registry* — free
late-join and reconnect consistency with no growth. Since the host is the only writer, a
`terminal/list` request is just as simple, so plain messages win for v1. Worth revisiting only if
terminals ever become multi-host.

## 7. Protocol additions

Lifecycle events (`opened`, `updated`, `closed`) are **broadcast** to the whole room: they are
rare, so the log noise on peers without terminal support is negligible, and the host does not need
to track which peers understand terminals. Capability negotiation is covered by
`capabilities.terminals` in `InitData`. Everything else is **targeted**: guests query
`terminal/list` on demand (they don't mirror the host's terminal list), and `terminal/output` goes
only to the subscribers of that terminal. Guests ignore lifecycle broadcasts that don't come from
the host, and ignore `updated`/`closed` for terminals they don't have open.

```ts
// types.ts
export type TerminalId = string;
export type TerminalAccessMode = 'read' | 'readWrite';
export interface TerminalDimensions { columns: number; rows: number }
export interface TerminalInfo {
    id: TerminalId;
    name: string;
    ownerId: Id;                        // peer owning the process
    mode: TerminalAccessMode;
    dimensions?: TerminalDimensions;    // authoritative, from the owner
    exit?: TerminalExit;
}
export interface TerminalChunk { seq: number; data: string }
export interface TerminalSnapshot {
    info: TerminalInfo;
    dimensions: TerminalDimensions;
    buffer: string;                     // serialized emulator state
    seq: number;
}
export interface TerminalExit { code?: number; signal?: string }

// messages.ts
export namespace Terminal {
    export const List        = new RequestType<[], TerminalInfo[]>('terminal/list');       // queried on demand
    export const Subscribe   = new RequestType<[TerminalId], TerminalSnapshot>('terminal/subscribe');
    export const Unsubscribe = new NotificationType<[TerminalId]>('terminal/unsubscribe');
    export const Input       = new NotificationType<[TerminalId, string]>('terminal/input');
    export const ViewResize  = new NotificationType<[TerminalId, TerminalDimensions]>('terminal/viewResize');
    export const Opened      = new BroadcastType<[TerminalInfo]>('terminal/opened');
    export const Updated     = new BroadcastType<[TerminalInfo]>('terminal/updated');      // name/mode/dims changed
    export const Closed      = new BroadcastType<[TerminalId, TerminalExit?]>('terminal/closed');
    export const Output      = new NotificationType<[TerminalId, TerminalChunk]>('terminal/output'); // subscribers only
}
```

Plus a `TerminalHandler` in [connection.ts](../packages/open-collaboration-protocol/src/connection.ts)
following the existing `chat`/`fs` shape, and `capabilities.terminals?: boolean` in `InitData` so
guests can hide the UI when the host cannot share. Protocol version becomes `0.3.4`, and the
extension's `open-collaboration-protocol` dependency is bumped with it.

`TerminalChunk.data` is a **string**, not `Binary`: `Pseudoterminal.onDidWrite` takes strings and
node-pty's `onData` already emits correctly decoded strings (`encoding: 'utf8'`), including across
reads that split a multi-byte sequence. Gzip compression is already negotiated per message
([encryption.ts](../packages/open-collaboration-protocol/src/messaging/encryption.ts)).

## 8. Extension components

New files under `packages/open-collaboration-vscode/src/terminal/`:

- `pty-backend.ts` — `PtyBackend` interface (`write`, `resize`, `onData`, `onExit`, `kill`) and
  backend selection.
- `node-pty-backend.ts` — the node-pty implementation, loaded by lazy `require` (node-only).
- `output-chunker.ts` — coalesces `onData` over a ~10 ms window and caps messages at 32 KB,
  assigning `seq` numbers. Pure and unit-testable.
- `terminal-emulator.ts` — `@xterm/headless` + `SerializeAddon` wrapper producing snapshots and
  title/state events.
- `shared-terminal.ts` (host) — owns backend, `Pseudoterminal`, emulator and subscriber set;
  enforces access mode.
- `guest-terminal.ts` — `Pseudoterminal` that writes incoming chunks, forwards `handleInput`
  (dropped when read-only), and fires `onDidOverrideDimensions` with the host's dimensions.
- `terminal-service.ts` — injectable; registers handlers when a `CollaborationInstance` is created,
  relays output to each terminal's subscribers, and cleans up on `room.onLeave` / `onClose` / `onDisconnect` / `dispose`.

Wiring: bind `TerminalService` in [inversify.ts](../packages/open-collaboration-vscode/src/inversify.ts)
and initialize it from [extension.ts](../packages/open-collaboration-vscode/src/extension.ts) only —
**not** [extension-web.ts](../packages/open-collaboration-vscode/src/extension-web.ts), which has no
child processes. Add `oct.shareTerminal` / `oct.openSharedTerminal` to
[commands-list.ts](../packages/open-collaboration-vscode/src/commands-list.ts),
[commands.ts](../packages/open-collaboration-vscode/src/commands.ts) and `package.json`, with
strings in `package.nls.json` and the translated NLS files. Add an `oct.terminal.*` block to
[settings.ts](../packages/open-collaboration-vscode/src/utils/settings.ts): `defaultAccessMode` (default `read`), `scrollback`, `shell`, `shellArgs`.

Shared terminals should be visually distinct via `TerminalOptions.iconPath` (`$(broadcast)`) and
`color`, reusing the peer colors from
[utils/package.ts](../packages/open-collaboration-vscode/src/utils/package.ts).

## 9. Dimensions

Participants have differently sized terminal panels, and a pty has exactly one size.

The host's `Pseudoterminal` dimensions are authoritative and drive `pty.resize()`. Guests report
their own dimensions with `terminal/viewResize` (informational for now) and render at the host's
size by firing `onDidOverrideDimensions`, which keeps wrapping identical everywhere. A future
option could clamp the pty to `min(cols, rows)` across write-enabled participants; the default
stays host-authoritative because it is predictable.

## 10. Late join, reconnect, replay

- A guest subscribing receives a `TerminalSnapshot`: it applies the dimensions, resets its
  terminal (`\x1bc`), then writes the serialized buffer — in that order.
- `seq` is used for **gap detection only**, not gap filling. A detected gap triggers a
  re-subscribe.
- On `onReconnect` ([collaboration-instance.ts](../packages/open-collaboration-vscode/src/collaboration-instance.ts))
  guests re-subscribe and re-render from a fresh snapshot. The host keeps the process running
  throughout.
- A guest leaving or its room closing removes it from the subscriber set; the process is untouched.

## 11. Security and permissions

Terminal sharing with write access is remote code execution on the host's machine. That is
inherent to the feature and the design states it plainly rather than burying it.

- **Default is `read`.** Granting `readWrite` is an explicit per-terminal action with a modal
  warning naming the peers who gain it.
- **The room's `readonly` permission forces `read`** regardless of a terminal's own mode, and
  downgrades live when `room.onPermissions` fires.
- Input is validated against the terminal's access mode **on the host**, per message. Sender claims
  are never trusted.
- Only explicitly created shared terminals are shared. The extension never attaches to a user's
  pre-existing terminals.
- The consent warning must state that `oct.files.exclude` (which hides `**/.env` from the shared
  file system) is bypassed by a shell: `cat .env` in a shared terminal shows it to guests. Content
  remains end-to-end encrypted from the server, but not from the room.
- Every child process is killed on `leave`, `room.onClose`, `onDisconnect` and `deactivate`,
  including on crash paths.

## 12. Failure modes and edge cases

- **Backpressure.** The pty can out-produce the network. Coalesce and cap; when the pending queue
  exceeds a threshold, drop the middle and emit a visible `[output truncated]` marker rather than
  growing memory or falling minutes behind. The emulator snapshot lets a lagging subscriber
  re-sync cheaply.
- **1 MB socket.io frame limit.** The 32 KB chunk cap keeps messages clear of it even after
  framing and encryption overhead.
- **Process exit.** Send `Closed` with the exit code; guest terminals print it and close.
- **Guest resizes its panel.** Ignored for the pty; the view is overridden to the host's size.
- **Native module fails to load.** Feature disabled with an actionable message; the rest of the
  extension is unaffected.
- **A guest floods input.** Revoke `readWrite` for that peer.

## 13. Alternatives considered

- **VS Code shell integration API** (`window.onDidStartTerminalShellExecution` + `execution.read()`,
  stable since 1.93) can stream output from the user's *own real* terminal with zero native
  dependencies. Rejected as the primary mechanism: it is per-command rather than a raw pty stream,
  input cannot be injected, it requires shell integration to be active, and it would force
  `engines.vscode` from `^1.73` to `^1.93`. It remains a good fit for a future "share this
  command's output" feature.
- **`script(1)` as a pty shim** (`script -qfc "$shell -i" /dev/null`) gives a real pty with no
  native dependency, but resize propagation is partial, behaviour differs between util-linux and
  BSD, and it does nothing for Windows. Superseded by node-pty.
- **Pipe-based `child_process.spawn`.** Works everywhere and needs nothing, but `isatty()` is
  false: no prompt echo, no TUIs, colors only when forced. Rejected as a shipped experience.
- **node-pty forks with multi-arch prebuilds.** A shortcut around the missing Linux prebuilds at
  the cost of depending on a fork's release cadence; building from upstream in CI is preferred.

## 14. Implementation phases

0. **Packaging spike.** Prove a platform-specific VSIX loads node-pty on Windows, macOS, local
   Linux *and* a Remote-SSH host. This is the only high-risk step; everything after it is ordinary
   work. Feature development can proceed in parallel against a locally compiled node-pty.
1. **Protocol and host skeleton.** Types, messages, handler, `TerminalService`, `NodePtyBackend`,
   host `Pseudoterminal` rendering its own output. Verifiable in a single window.
2. **Guests, read-only.** Subscribe/snapshot/output, dimension override, subscriber tracking,
   lifecycle and cleanup. First genuinely useful milestone.
3. **Emulator integration.** `@xterm/headless` snapshots and title/state events.
4. **Write access.** Mode toggle, consent warnings, `readonly` enforcement, host-side validation.
5. **Polish.** Shared terminals listed in
   [collaboration-status-view.ts](../packages/open-collaboration-vscode/src/collaboration-status-view.ts),
   guest-initiated terminal requests, optional `min()` dimension clamping.

Phases 1–3 form a coherent read-only release; phase 4 opens the RCE surface and should be a
separate, deliberate one.

## 15. Testing

- vitest unit tests for the chunker, snapshot/serialize wrapper, `seq` gap detection and access-mode
  gating, against a mocked `ProtocolBroadcastConnection` — the existing
  [test/](../packages/open-collaboration-vscode/test/) directory already has this shape.
- Manual two-window verification against `test-collab-project`, plus one Remote-SSH run per
  release to cover the remote extension-host path.

## 16. Open questions

- Does `ovsx` support `--target` well enough for Open VSX to serve platform-specific builds, or
  does Open VSX need the universal fallback only?
- Are Alpine/musl targets worth the extra CI, or is the universal fallback acceptable for
  Alpine-based dev containers at first?
- Should guests be able to *request* a shared terminal from the host (with consent), or is
  host-initiated sharing sufficient for the first release?
