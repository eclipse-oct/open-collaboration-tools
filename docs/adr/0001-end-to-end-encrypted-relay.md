---
status: accepted
---

# ADR-0001: Relay session content end-to-end encrypted, so the server cannot read it

## Context

A collaboration session streams the host's workspace — source code, file contents, cursor positions —
through a server that both parties reach over the public internet. TypeFox operates a public instance
at `open-collab.tools`, and the project also expects adopters to self-host, potentially on
infrastructure they do not fully control.

That raises a trust question the architecture has to answer one way or the other: is the relay
operator a party to the session's contents?

## Options considered

1. **Transport encryption only (TLS)** — the server decrypts, routes, and re-encrypts. Simple, and
   allows server-side features that need to read content (search, persistence, operational
   transformation).
2. **End-to-end encryption between peers** — the server routes ciphertext it cannot open.

## Decision

Session content is encrypted end-to-end between peers. Message content is encoded, compressed, and
encrypted with a room symmetric key; that key is wrapped for each peer with the peer's public key.
The server routes opaque bytes.

Three arguments converged on this. The public instance must not be able to see users' code — which
also means its operator cannot be compelled to produce it. Self-hosting adopters get the same
guarantee without having to trust the machine the relay runs on. And it keeps the server entirely
stateless about content: the relay handles bytes, so it needs no knowledge of document formats or
editor semantics.

## Consequences

- The server cannot arbitrate document state, which rules out server-side operational transformation
  and forces peer-side convergence — see [ADR-0003](0003-yjs-for-document-convergence.md).
- Server-side features that would need to read content are permanently off the table: no server-side
  search, no content persistence, no server-rendered previews.
- Every host process must supply a crypto implementation via `initializeProtocol` before using the
  protocol, adding a startup step for each new client.
- Debugging is harder: a network capture or server log shows ciphertext, so protocol problems must be
  reproduced at a peer.
- Key distribution becomes the protocol's problem — peer public keys and the wrapped room key are
  part of the join handshake, and a bug there is a correctness *and* a security bug.
