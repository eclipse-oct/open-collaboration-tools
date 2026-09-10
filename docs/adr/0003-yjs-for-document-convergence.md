---
status: accepted
---

# ADR-0003: Use Yjs CRDTs for document convergence

## Context

Several peers edit the same documents at once and must end up with identical content, over an
unreliable network, with peers joining and leaving mid-session. Something has to reconcile concurrent
edits.

[ADR-0001](0001-end-to-end-encrypted-relay.md) had already decided that the server cannot read session
content — which removes the option most collaborative editors take.

## Options considered

1. **Server-side operational transformation** — the classic approach: a central authority orders and
   transforms operations. Requires the server to read and understand document operations.
2. **A CRDT library** — peers converge without any central authority. Among the mature options, Yjs.
3. **A hand-rolled CRDT** — full control over the wire format, at the cost of implementing and
   debugging a class of algorithm that is notoriously easy to get subtly wrong.

## Decision

Documents converge through Yjs CRDTs, bound to the protocol's sync channel by the
`open-collaboration-yjs` package.

The encryption decision forced the first half of this: with an unreadable relay, no server-side
transformation is possible, so convergence has to happen at the peers — which means a CRDT. Yjs then
won on maturity and reach. It solves awareness (cursors, selections, peer presence) through
`y-protocols` rather than leaving it to be reinvented, and it already has editor bindings, including
Monaco, that this project would otherwise have written by hand.

## Consequences

- Convergence is correct by construction under concurrency, but the resulting state is whatever the
  CRDT merge produces; there is no central authority to appeal to for "the right answer".
- Yjs's document model is now load-bearing across four client packages, and its update format is
  effectively part of what peers must agree on. Replacing it would be a protocol-level change.
- Yjs is a peer dependency, so a client's Yjs version must stay compatible with the one peers use.
- Editor-specific text handling (line endings in particular) needs normalization on the way in and
  out — the reason `yjs-normalized-text.ts` exists.
- The relay stays simple: it moves encrypted updates and never interprets them.
