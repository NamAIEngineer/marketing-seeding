# Ownership and claims

| Session | Worktree / branch | Owned scope observed | Claim state | Evidence |
|---|---|---|---|---|
| A | `/Users/nam/Documents/marketing-seeding-wave-13-bridge` / `wave/distribution-os-runtime-wave-13-bridge` | Camoufox session/transport/server/service/strategy/UI dirty files | PRESERVED; not reclaimed | HEAD `52072ce`; dirty status; port `4318` PID `30842`; no receiver |
| B | `/Users/nam/Documents/marketing-seeding-integration` / `integration/autonomous-build` | authority/standing-delegation/service/tests/reports dirty files | PRESERVED; not reclaimed | HEAD `6899679`; dirty status; no receiver |
| C | `/Users/nam/Documents/marketing-seeding-session-c-reconciled` / `integration/session-c-reconciled` | oi-browser audit, native memory/provider/browser contracts, integration docs/evidence, reconciled candidate | CLAIMED; code at `20ba20f`, evidence/docs pending commit | exact HEAD `20ba20f6f8f273a72cb0db88b216d645aeecaeb1` |

Rules:

- A/B claims are not released by silence or missing heartbeat.
- C may integrate only committed A/B checkpoints or disjoint patches after inspection.
- Dirty A/B files remain outside C's write set.
- `REQUESTED`, `ACKNOWLEDGED`, and `COMPLETED` require receiver evidence; current A/B status is `UNVERIFIED`, not ACKNOWLEDGED.
