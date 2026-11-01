# ORCA_MS_CD_COMPLETE_20261029_01 acceptance

Goal revision: 3
Coordination marker: `ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01`
Controller: Session C
Native Orca Run: `run_5c4c40ae690b`

## Requirements

- **A1 / M0:** One native Orca Run is bound to C; goal mode state, consumer, checkpoint, and next action are durable. No active goal with runnable work may have an empty task queue.
- **A2 / M1:** A, B, C, and D mappings distinguish UI observation from receiver verification. Every dispatched task has a fresh request/dispatch ID, exact owner, pinned workspace/revision, and correlated ACK/result.
- **A3 / M2:** Worker status, delivery status, acceptance status, and goal status remain separate. A completed report leaves a durable successor or a verified dependency wait.
- **A4 / M3:** Candidate integration keeps single writer ownership, dirty overlays, source/test pins, cancellation, idempotency, UNKNOWN quarantine, and independent review.
- **A5 / M4:** Reddit public Listening for `design-os-studio` stores bounded source-grounded observations through canonical persistence, with coverage, provenance, dedupe, and restart evidence.
- **A6 / M5:** C/D-owned continuation survives controlled restart/replay without duplicate completed work.
- **A7 / M6:** LinkedIn execution is LIVE_VERIFIED only with real authority, identity, publication, permalink, content/target match, and independent verification. Otherwise retain exact blocker.
- **A8 / M7:** Candidate, remote SHA, PR/checks, dashboard projection, task evidence, and blocker state match observed revisions.
- **A9 / M8:** Auto-GTM generation/media is accepted only with a real configured capability/artifact; text-only and Listening lanes remain independently runnable.

## Constraints

- **C1:** Never modify, stage, stash, reset, clean, restart, or commit A/B/D worktrees without their owner checkpoint and handoff.
- **C2:** No login, MFA, authority grant/refresh, publication, social messaging, GPM, deployment, merge, credential handling, or fake proof.
- **C3:** Native Orca is the sole coordination control plane for delegated workers. Do not create a competing broker or ledger.
- **C4:** Keep IMPLEMENTED, FIXTURE_VERIFIED, RUNTIME_VERIFIED, and LIVE_VERIFIED separate; retain UNKNOWN immutably.

## Verification

- **V1:** Native task receipt, turn start, ACK, and correlated result from a verified B owner receiver.
- **V2:** Fresh A and D owner receiver evidence or a durable WAITING state naming owner, event, consumer, and wake condition.
- **V3:** Restart/replay evidence shows no duplicate attempt or completed artifact.
- **V4:** Independent review reads final candidate diff and reruns checks after the last source change.
- **V5:** Listening and LinkedIn evidence are separate; no fixture artifact is promoted to live proof.
