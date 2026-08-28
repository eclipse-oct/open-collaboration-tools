---
status: accepted
---

# ADR-0002: Keep session state in server process memory

## Context

The server tracks rooms, the peers in them, and pending credentials for the duration of a session.
This state has to live somewhere. The project's stated deployment goal is that anyone can run their
own instance — the published `oct-server-dev` image is meant to be launched with `docker compose up`
and nothing else.

## Options considered

1. **External store (Redis or a database)** — durable sessions, horizontal scaling, at the cost of an
   infrastructure dependency every self-hoster must also run.
2. **Process memory** — no dependency, no scaling.

## Decision

Rooms, peers, and credentials live in process memory, held by `RoomManager`, `PeerManager`, and
`CredentialsManager`. The server has no datastore.

The deciding argument is deployment simplicity: a self-hoster runs one container and is done. Adding
Redis or a database to the critical path would make the thing adopters are most likely to try first —
"run our own instance" — substantially harder, in exchange for scale that a self-hosted team instance
does not need.

## Consequences

- The server does not scale horizontally. Sessions are bound to one process, so a second replica
  cannot serve the same room. Load is capped by one machine.
- Restarting or redeploying the server ends every live session; peers must create or rejoin a room.
- Sessions are not durable and no session history exists to inspect after the fact.
- WebSocket connections are sticky by nature, so no session affinity layer was needed — but adding one
  later would not be enough on its own to make the server scalable.
- Revisiting this is a real project: it would touch room, peer, and credential management together,
  and would be a new ADR superseding this one.
