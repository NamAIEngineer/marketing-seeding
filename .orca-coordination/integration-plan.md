# Integration plan and task ledger

## Controller and base

- Controller: SESSION C, candidate branch `integration/session-c-reconciled`.
- Base revision: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- Candidate source/test revision: `35cc224febb5eb9c8368cf88f5f28b6a119b6be3`; metadata/evidence commits follow this checkpoint; prior integration checkpoint `7f2b74a`.
- Earlier native code/test checkpoint: `7378f8cac202ce8efc0c5c66cb789e67f504f32e`.
- Candidate evidence/docs are C-owned changes on top of that checkpoint.
- Approval gates: no live publication, merge, deploy, credential change, real-data migration, or external messaging.

## Current session evidence

- SESSION A: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`, branch `wave/distribution-os-runtime-wave-13-bridge`, checkpoint `1ed57710f66d8ca1a6284d16b149d9039fcb032e`; latest read-only status is 13 tracked dirty files plus 90 untracked entries. A owns runtime `127.0.0.1:4318`, PID `79925`.
- SESSION B: `/Users/nam/Documents/marketing-seeding-integration`, branch `integration/autonomous-build`, checkpoint `b675a98e6dd2da3c12133dff715eddea616c91f5`; tracked scope clean, 16 untracked reports/artifacts excluded.
- SESSION C: `/Users/nam/Documents/marketing-seeding-session-c-reconciled`, branch `integration/session-c-reconciled`, source/test candidate `35cc224`; metadata/evidence HEAD follows.
- Native handshake `SESSION-C-HANDSHAKE-20261028T1210Z` delivered through Orca terminal handles. A returned `SESSION-A-ACK-20261028T1210Z`; B returned `SESSION-B-ACK-20261028T1210Z`; both showed `turn_started`, exact ownership, and no edits by C.

## Tasks

| Task ID | Owner | Scope | Dependency | Acceptance / evidence | State |
|---|---|---|---|---|---|
| C-001 | C | Audit oi-browser and auto-gtm source pins | source checkouts | `docs/integrations/oi-browser-audit.md` | COMPLETED |
| C-002 | C | Canonical memory/provider/browser contracts and persistence | base store/service | native modules/tests at `7378f8c` | COMPLETED |
| C-003 | C | Reconcile A Camoufox checkpoint | A checkpoint `1ed5771` | present in candidate history; A dirty overlay preserved | COMPLETED / OVERLAY PRESERVED |
| C-004 | C | Preserve B authority boundary | B checkpoint `b675a98` | behavior confirmed by candidate history/tests; exact B commit intentionally not cherry-picked | COMPLETED / ADAPTED |
| C-005 | C | Controlled Product X / Community A+B case | C-002 | `fixture-run-7378f8c.json`, before/after learning change, restart and idempotent replay | COMPLETED |
| C-006 | C | Isolated server/provider/restart smoke | C-002 | `server-smoke-7378f8c.json`, port `4337`, exact SHA, no external side effects | COMPLETED |
| C-007 | C | Focused/full regression and hygiene | C-002..C-006 | focused coordinator/native `17/17`; oi-browser memory/provider `22/22`; final full `810/808/0/2` at source/test checkpoint `4fe2b7b`; historical integration/authority `106/106`; baseline `576/574/0/2`; Auto-GTM `160/160` | COMPLETED |
| C-008 | C | Snapshot deduplication execution trace retention | C-002 | repeated DOM test retains bounded execution bindings | COMPLETED |
| C-009 | C | Independent memory evidence and provider full-deadline regressions | C-002 | commit `9875db3`; focused `22/22`; historical full `805/803/0/2`; independent review PASS | COMPLETED |
| C-010 | C | Re-run current candidate regression and reconcile evidence metadata | C-007..C-009 | HEAD `4fe2b7b`; focused oi-browser `22/22`; coordinator/native `17/17`; full `810/808/0/2`; output SHA-256 `8d9a67f68f491b0370f5876d11c8a0ad8f731e6c76d1a49c4792bf9d8bf36ac` | COMPLETED |
| C-011 | C | Provider caller cancellation and fallback race regression | C-009 | commit `35cc224`; focused oi-browser/provider/live bridge `34/34`; coordinator/native `17/17`; full `813/811/0/2`; independent verifier PASS | COMPLETED |
| A/B-001 | A/B | Native receiver handshake and checkpoint ACK | existing live sessions | `SESSION-A/B-ACK-20261028T1210Z`, native terminal evidence | ACKNOWLEDGED |
| LIVE-001 | authorized runtime owner | fresh Camoufox identity/readiness and publication | standing authority + account | separate live evidence | BLOCKED |
| GTM-001 | Auto-GTM owner | generated feed/content/media artifact | configured source/provider | capability-specific evidence | BLOCKED |

## Integration rule

Only C-owned files are written in this worktree. A/B dirty files remain owner-controlled. Candidate integration uses committed checkpoints and verified behavior; it does not mutate, stash, reset, clean, restart, or commit A/B worktrees.
