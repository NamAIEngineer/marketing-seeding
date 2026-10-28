# Integration status

## Candidate

- Candidate worktree: `/Users/nam/Documents/marketing-seeding-session-c-reconciled`
- Branch: `integration/session-c-reconciled`
- Code/test checkpoint: `7f2b74acab39987318d0720361f1cefdac0e6b51`
- Base: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- Remote observed: `origin=https://github.com/DevAngular333/marketing-seeding.git`.
- C-owned evidence and coordinator source/tests are committed through `7f2b74a`.

## A/B/C connectivity and ownership

- SESSION A: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`, branch `wave/distribution-os-runtime-wave-13-bridge`, checkpoint `1ed5771`; latest compact status 9 tracked dirty + 80 untracked entries (518 files expanded); owns `127.0.0.1:4318`; current health HTTP 200 with schema 8, 6 UNKNOWN and 0 verified; no restart by C.
- SESSION B: `/Users/nam/Documents/marketing-seeding-integration`, branch `integration/autonomous-build`, checkpoint `b675a98`; 0 tracked dirty + 23 untracked artifacts excluded.
- SESSION C: candidate above; integration/docs/evidence owner.
- Orca native handshake marker `SESSION-C-HANDSHAKE-20261028T1210Z`: A and B both returned `turn_started`, exact ACK markers, HEAD/branch/dirty counts, ownership, and native terminal references.
- No A/B file was edited, staged, reset, stashed, cleaned, or committed by C.
- Current marker handshake: A and B both returned `turn_started`/real read-only result with marker `ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01`; A reported receiver READY, B reported orphaned terminal and follow-up capability unconfirmed.
- Latest read-only A runtime recheck at `2026-10-28T08:02:47Z`: `127.0.0.1:4318` HTTP 200, PID `49399`, `sourceCommit=1ed5771`, `sourceDirty=true`, schema 8, `UNKNOWN=6`, verified 0, publication unverified 150; Camoufox session metadata is `STALE` and readiness is `UNKNOWN`. C did not restart or mutate A.

## Verified candidate evidence

- Baseline `79985bb411afc141f0edf10ae635fb91824d8bc9`: `npm test` → 576 total, 574 pass, 0 fail, 2 skipped.
- Focused current slices: authority/bootstrap/delegation `47/47`; oi-browser/browser/provider/transport `59/59`; combined `106/106`.
- Coordinator focused: `node --test test/project-coordinator.test.mjs` → 4 total, 4 pass, 0 fail.
- Full candidate: `node --test test/*.test.mjs` → 794 total, 792 pass, 0 fail, 2 skipped.
- Durable regression artifact: `plans/oi-browser-integration/regression-final-7f2b74a.json`, exact source revision and output SHA recorded.
- Auxiliary queue verifier task `0e9f9242-0019-4f11-9453-9d155a419221` failed closed at provider authorization validation; no retry or artifact. Direct independent verifier PASS remains authoritative.
- Auto-GTM current checkout: `python -m unittest discover tests` → 158 total, 158 pass, 0 fail; `pip check` clean.
- Controlled fixture: `plans/oi-browser-integration/fixture-run-7378f8c.json`, `FIXTURE_VERIFIED`; learning support 2, verified 2; before/after candidate changed; restart and browser replay passed; external side effects false.
- Isolated runtime: `plans/oi-browser-integration/server-smoke-7378f8c.json`, `RUNTIME_VERIFIED`; port `4337`, exact SHA, auth boundary, memory/static snapshot persistence, restart persistence, explicit local-Qwen route success; Auto-GTM remains unavailable (`feed_not_generated`).
- Current syntax checks and `git diff --check` passed. Fresh independent verifier reviewed `7f2b74a` at `2026-10-28T07:49:24Z`; coordinator tests are 4/4. Secret scan found no credential-like values in coordinator files; matches elsewhere are test redaction fixtures/generated UI text.

## State

`PARTIAL`. Communication is proven. Native A/B handshakes are acknowledged. Live Camoufox readiness/publication/metrics, Auto-GTM generation/media, and A's dirty overlay reconciliation remain unproven.

## Supervisor evidence

- Existing System Agentic service: `8879`, local-only, health/doctor PASS, but prior GoalRuns v60–v63 failed in worker/artifact or ChatGPT approval/reply paths.
- Added `src/project-coordinator.mjs` as a project-scoped, bounded integration coordinator. It persists task/dependency/wake/result state, uses a process lock, deduplicates event IDs, wakes only satisfied dependencies, rejects non replay-safe recovery, and accepts artifacts only after reading and hashing the declared file.
- Rehearsal: `plans/oi-browser-integration/coordination-rehearsal-20261028.json`, `FIXTURE_VERIFIED`. Event `dependency-a-event` from A checkpoint woke `wake-proof`; one worker attempt completed; restart retained one result and replay executed false. No external side effect.

## Native resume continuation (2026-10-28)

- `IMPLEMENTED`: coordinator schema v2 additive migration, durable native request/attempt/result state, exact-request recovery, process lock, restart dedupe, raw terminal-output scrubbing.
- `IMPLEMENTED`: Orca adapter uses observed CLI protocol: `terminal send --wait-submit`, exact `--retry-request`, `terminal wait --for tui-idle`, `terminal read`; verifies marker and agent-created safe artifact.
- `IMPLEMENTED`: project-scoped supervisor and macOS LaunchAgent `ai.marketing-seeding.project-coordinator`, configured `RunAtLoad` + `KeepAlive`.
- `NATIVE_RESUME_VERIFIED`: C launchd follow-up #1 request `fc821d69-2281-4757-b5c2-8d1f5628a63b`, artifact hash `a6cf8a3201799ff1aaf0ff5aaba1a5ff7b5e727ba848a8caa162d7bc1b9e1960`, one attempt.
- `NATIVE_RESUME_VERIFIED`: C launchd follow-up #2 request `4f19fde8-0f31-4f8d-8b40-0d36de8dd45a`, artifact hash `4b3e51dad6b2d8aaf63377f416a8a30ecc9f25041986dd19aa21b1f29b0f4770`, one attempt after exact request replay/recovery. Launchd restart retained two results and did not replay.
- A/B native follow-up artifacts also exist: A request `536fa680-2dd7-4330-8573-67566db016cb`, hash `2903df5db1800124fa59515c8042e966a1e9498a528122d75309deace9291f22`; B request `b705ab7f-a863-44b7-bf54-8f57a05d269f`, hash `97799c6641a26e9b0967240331c6c370aba39f3041c4c9f453f9e79e07ff7441`.
- All artifacts are local rehearsals: `rehearsal=true`, `liveEligible=false`, `externalSideEffects=false`, `unknownRetryAllowed=false`.


## Native resume continuation (2026-10-28)

- `IMPLEMENTED`: coordinator schema v2 additive migration, durable native request/attempt/result state, exact-request recovery, process lock, restart dedupe, raw terminal-output scrubbing.
- `IMPLEMENTED`: Orca adapter uses observed CLI protocol: `terminal send --wait-submit`, exact `--retry-request`, `terminal wait --for tui-idle`, `terminal read`; verifies marker and agent-created safe artifact.
- `IMPLEMENTED`: project-scoped supervisor and macOS LaunchAgent `ai.marketing-seeding.project-coordinator`, configured `RunAtLoad` + `KeepAlive`.
- `NATIVE_RESUME_VERIFIED`: C launchd follow-up #1 request `fc821d69-2281-4757-b5c2-8d1f5628a63b`, artifact hash `a6cf8a3201799ff1aaf0ff5aaba1a5ff7b5e727ba848a8caa162d7bc1b9e1960`, one attempt.
- `NATIVE_RESUME_VERIFIED`: C launchd follow-up #2 request `4f19fde8-0f31-4f8d-8b40-0d36de8dd45a`, artifact hash `4b3e51dad6b2d8aaf63377f416a8a30ecc9f25041986dd19aa21b1f29b0f4770`, one attempt after exact request replay/recovery. Launchd restart retained two results and did not replay.
- A/B native follow-up artifacts also exist: A request `536fa680-2dd7-4330-8573-67566db016cb`, hash `2903df5db1800124fa59515c8042e966a1e9498a528122d75309deace9291f22`; B request `b705ab7f-a863-44b7-bf54-8f57a05d269f`, hash `97799c6641a26e9b0967240331c6c370aba39f3041c4c9f453f9e79e07ff7441`.
- All artifacts are local rehearsals: `rehearsal=true`, `liveEligible=false`, `externalSideEffects=false`, `unknownRetryAllowed=false`.
