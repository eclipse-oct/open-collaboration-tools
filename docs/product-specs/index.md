# Product specs

Current intended behaviour, one file per capability. These adjudicate *bug vs. intended* when
behaviour surprises someone. A change to intended behaviour updates its spec in the same change.

Specs are written when there is evidence they are needed — recurring bug-vs-intended questions,
clustered regressions, or high cost of getting it wrong — never one per module.

| Capability | Spec |
|---|---|
| Session and peer sync — joining, room membership, document seeding, file exclusion | [session-and-peer-sync.md](session-and-peer-sync.md) |
