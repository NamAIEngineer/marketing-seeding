# Ownership and claims

| Session | Worktree / branch | Owned scope observed | Claim state | Evidence |
|---|---|---|---|---|
| A | `/Users/nam/Documents/marketing-seeding-wave-13-bridge` / `wave/distribution-os-runtime-wave-13-bridge` | Camoufox session/transport/server/strategy/UI; current overlay `src/auto-gtm-feed.mjs`, `src/market-intelligence.mjs`, `test/auto-gtm-feed.test.mjs` | PRESERVED; not reclaimed | `SESSION-A-ACK-20261028T1210Z`; HEAD `1ed5771`; 3 tracked dirty + 475 untracked; port `4318` PID `38672` |
| B | `/Users/nam/Documents/marketing-seeding-integration` / `integration/autonomous-build` | authority/standing-delegation/service/tests/reports | CHECKPOINTED; behavior adapted in candidate | `SESSION-B-ACK-20261028T1210Z`; owner commit `b675a98`; tracked scope clean; untracked artifacts excluded |
| C | `/Users/nam/Documents/marketing-seeding-session-c-reconciled` / `integration/session-c-reconciled` | oi-browser audit, native memory/provider/browser contracts, integration docs/evidence, reconciled candidate | CLAIMED; code/test checkpoint `7378f8c` | C-owned candidate and evidence; no A/B worktree mutation |

Rules:

- A/B claims are not released by silence or missing heartbeat.
- C may integrate only committed A/B checkpoints or disjoint patches after inspection.
- Dirty A/B files remain outside C's write set.
- `REQUESTED`, `ACKNOWLEDGED`, and `COMPLETED` require receiver evidence. Native delivery/turn start plus `SESSION-A/B-ACK-20261028T1210Z` proves handshake acknowledgement. A checkpoint is preserved as an overlay; B checkpoint is durable and behavior is already represented/adapted in the candidate.
