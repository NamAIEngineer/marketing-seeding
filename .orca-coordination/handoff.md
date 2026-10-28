# Handoff

## Candidate handoff

- Candidate: `/Users/nam/Documents/marketing-seeding-session-c-reconciled`, branch `integration/session-c-reconciled`.
- Code/test checkpoint: `7f2b74acab39987318d0720361f1cefdac0e6b51`.
- Base: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- A checkpoint represented: `1ed57710f66d8ca1a6284d16b149d9039fcb032e`; current A overlay preserved outside candidate.
- B owner checkpoint: `b675a98e6dd2da3c12133dff715eddea616c91f5`; not cherry-picked because candidate already contains/adapts substantive behavior and B has unrelated obsolete differences.
- Source pins: oi-browser `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm `9368098477d78f75d57fdf5db276129948f3a183`.

## Evidence

- `plans/oi-browser-integration/fixture-run-7378f8c.json`: `FIXTURE_VERIFIED`, controlled Product X / Community A+B, learning-driven before/after candidate change, static browser intent activation, idempotent replay, restart persistence.
- `plans/oi-browser-integration/server-smoke-7378f8c.json`: `RUNTIME_VERIFIED`, exact source SHA, isolated port `4337`, auth/memory/static snapshot/restart persistence, explicit local-Qwen route success, `feed_not_generated`.
- Current tests: focused integration/authority slices `106/106`; coordinator `4/4`; full `794 total, 792 pass, 0 fail, 2 skipped`; baseline `576/574/0/2`; Auto-GTM `158/158`, `pip check` clean.
- Durable regression artifact: `plans/oi-browser-integration/regression-final-7f2b74a.json`, source `7f2b74a`, output SHA `af10e9c7…`.

## Native session evidence

- A: `SESSION-A-ACK-20261028T1210Z`, Orca terminal `term_58af59e8-f5dd-4968-a724-78b48a04cf3c`, HEAD `1ed5771`, dirty scope preserved.
- B: `SESSION-B-ACK-20261028T1210Z`, Orca terminal `term_41a5601e-887e-4ac0-a8d7-35112fedb375`, HEAD `b675a98`, tracked scope clean.
- Current marker handshake: A request `461d4128-4075-41ea-b07f-291c421385bb` returned `SESSION-A-ACK-ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01`, HEAD `1ed5771`, then latest compact status showed 9 tracked + 80 untracked entries (518 files expanded), receiver READY. B request `7cdca6e2-c446-4d8c-b4d6-686e061e9da8` returned `SESSION-B-ACK-ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01`, HEAD `b675a98`, 0 tracked + 23 untracked; terminal still reports orphaned/follow-up unconfirmed.

## ChatGPT bridge evidence

- Fresh AX inspection matched marker and exact URL `https://chatgpt.com/g/g-p-6adf80888a748191a92fa5dabc7a0a4a-module-markting-seeding-os/c/6ae09d26-12c4-83ec-bd1f-d53553e707cc` in the same snapshot.
- Harmless request `chatgpt-master-handshake-92d4a305829cfa67` / nonce `c-handshake-d98b40e2a85191a0` completed as `xchg-50bacbd9c3064aa2a7e0`, source `chatgpt-web`, same conversation URL, bounded response with matching requestId/marker/nonce. `message_id` is null by transport design.

## Project coordinator evidence

- `src/project-coordinator.mjs`, `test/project-coordinator.test.mjs`, and `scripts/coordination-rehearsal.mjs` add a local-only development control plane. It does not select providers/accounts/campaigns and cannot publish.
- Rehearsal artifact: `plans/oi-browser-integration/coordination-rehearsal-20261028.json`; dependency → wake → worker → accepted artifact → restart/replay check passed, one invocation only.
- Fresh independent read-only review at `2026-10-28T07:49:24Z` verified HEAD `7f2b74a`; stale test/provenance metadata was corrected before final handoff.

## Runtime boundary

- Runtime `127.0.0.1:4318` remains A-owned and untouched.
- No login, MFA/CAPTCHA handling, authority grant, live submit, deployment, merge, or external side effect occurred. Branch `integration/session-c-reconciled` is pushed and draft PR [NamAIEngineer/marketing-seeding#2](https://github.com/NamAIEngineer/marketing-seeding/pull/2) is open; no merge performed.
- Fixture and isolated runtime evidence do not upgrade live publication, authenticated Camoufox readiness, or external metrics.

## Continuation supervisor evidence

- C-owned continuation changes are pending on branch `integration/session-c-reconciled` above `6bb0eee`; A/B worktrees remain untouched.
- LaunchAgent `ai.marketing-seeding.project-coordinator` runs `/Users/nam/Documents/marketing-seeding-session-c-reconciled/scripts/project-coordinator-supervisor.mjs`; rollback: `launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/ai.marketing-seeding.project-coordinator.plist"`.
- C follow-ups #1/#2 native requests, markers, artifacts, and hashes are recorded in `plans/oi-browser-integration/native-resume-evidence-20261028.json`.
- Durable coordinator state contains structured receipts/hashes/markers/request IDs; raw `outputExcerpt` is removed on read and not persisted again.
- A checkpoint artifact `artifacts/session-a-checkpoint-20261028.json` completed natively with hash `94aa53a52b514b198375774fb2ba2cdfd1bebe8731110e3324d00dd0af0803c7`; A reports clean checkpointing is blocked until shared ownership and fresh overlay tests are reconciled.
