# Ownership and claims

| Session | Worktree / branch | Owned scope observed | Claim state | Evidence |
|---|---|---|---|---|
| A | `/Users/nam/Documents/marketing-seeding-wave-13-bridge` / `wave/distribution-os-runtime-wave-13-bridge` | Camoufox session/transport/server/strategy/UI; current overlay includes `src/auto-gtm-feed.mjs`, `src/camoufox-execution-transport.mjs`, `src/camoufox-playwright-protocol.mjs`, `src/market-intelligence.mjs`, and related tests | PRESERVED; not reclaimed | Current marker ACK `ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01`; historical handshake snapshot had 8 tracked + 509 untracked. Latest read-only status: 13 tracked + 90 untracked entries; port `4318` remains A-owned (PID `79925`); receiver reported READY in the native checkpoint |
| B | `/Users/nam/Documents/marketing-seeding-integration` / `integration/autonomous-build` | authority/standing-delegation/service/tests/reports | CHECKPOINTED; behavior adapted in candidate | Current marker ACK `SESSION-B-ACK-ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01`; owner commit `b675a98`; 0 tracked dirty + 16 untracked; follow-up capability remains unconfirmed because Orca marks terminal orphaned |
| C | `/Users/nam/Documents/marketing-seeding-session-c-reconciled` / `integration/session-c-reconciled` | oi-browser audit, native memory/provider/browser contracts, durable coordination, acceptance-aware continuation, integration docs/evidence, reconciled candidate | CLAIMED; code/test checkpoint `85913e9`, source/evidence follows docs commit | C-owned candidate and evidence; no A/B/D worktree mutation |

Rules:

- A/B claims are not released by silence or missing heartbeat.
- C may integrate only committed A/B checkpoints or disjoint patches after inspection.
- Dirty A/B files remain outside C's write set.
- `REQUESTED`, `ACKNOWLEDGED`, and `COMPLETED` require receiver evidence. Native delivery/turn start plus `SESSION-A/B-ACK-20261028T1210Z` proves handshake acknowledgement. A checkpoint is preserved as an overlay; B checkpoint is durable and behavior is already represented/adapted in the candidate.
- Current marker handshake was delivered with Orca request IDs `461d4128-4075-41ea-b07f-291c421385bb` (A) and `7cdca6e2-c446-4d8c-b4d6-686e061e9da8` (B). A returned `turn_started` and `Receiver: READY`; B returned the ACK after a real read-only turn but reported `orphaned=true` and `follow-up capability unconfirmed`. This is current connectivity evidence, not proof that B can be resumed automatically.
