# Ownership and claims

| Session | Worktree / branch | Owned scope observed | Claim state | Evidence |
|---|---|---|---|---|
| A | `/Users/nam/Documents/marketing-seeding-wave-13-bridge` / `wave/distribution-os-runtime-wave-13-bridge` | Camoufox session/transport/server/strategy/UI dirty files | PRESERVED; checkpoint requested, not reclaimed | `RESULT-A-20261028T0420Z`; HEAD `52072ce`; dirty scope; port `4318` PID `38672`; owner checkpoint in progress |
| B | `/Users/nam/Documents/marketing-seeding-integration` / `integration/autonomous-build` | authority/standing-delegation/service/tests/reports | CHECKPOINTED; not yet integrated | `RESULT-B-20261028T0420Z`; owner commit `b675a98`; tracked scope clean; untracked artifacts excluded |
| C | `/Users/nam/Documents/marketing-seeding-session-c-reconciled` / `integration/session-c-reconciled` | oi-browser audit, native memory/provider/browser contracts, integration docs/evidence, reconciled candidate | CLAIMED; committed candidate `e9a7bfa`, code/test at `20ba20f`, serial integration owner | no source/test drift; C owns serial integration |

Rules:

- A/B claims are not released by silence or missing heartbeat.
- C may integrate only committed A/B checkpoints or disjoint patches after inspection.
- Dirty A/B files remain outside C's write set.
- `REQUESTED`, `ACKNOWLEDGED`, and `COMPLETED` require receiver evidence. A/B handshake and review markers are `ACKNOWLEDGED`; B checkpoint is `COMPLETED` at `b675a98`; A checkpoint remains `REQUESTED` until owner returns its commit marker.
