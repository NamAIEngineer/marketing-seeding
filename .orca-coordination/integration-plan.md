# Integration plan and task ledger

## Controller and base

- Controller: SESSION C, candidate branch `integration/session-c-reconciled`.
- Base revision: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- Candidate code revision: `20ba20f6f8f273a72cb0db88b216d645aeecaeb1`.
- Approval gates: no live publication, merge, deploy, credential change, migration of real data, or external messaging.

## Tasks

| Task ID | Owner | Scope | Dependency | Acceptance / evidence | State |
|---|---|---|---|---|---|
| C-001 | C | Audit oi-browser and auto-gtm source pins | source checkouts | `docs/integrations/oi-browser-audit.md` | COMPLETED |
| C-002 | C | Canonical memory/provider/browser contracts and persistence | base store/service | committed native modules/tests | COMPLETED |
| C-003 | C | Reconcile A committed Camoufox checkpoint | A commit `52072ce` | merge commit `d195756`; exact candidate regression | COMPLETED |
| C-004 | C | Preserve B authority boundary | B dirty scope | candidate preserves committed authority boundary; B dirty remains uncommitted | PARTIAL / ownership pending |
| C-005 | C | Controlled Product X / Community A+B case | C-002 | final fixture artifact, PASS, before/after learning change and restart | COMPLETED |
| C-006 | C | Isolated server/provider/restart smoke | C-002 | `server-smoke-20ba20f.json`, exact SHA, private port `4333`; provider failure preserved as `FAILED/nonzero` after MLX OOM | COMPLETED |
| C-007 | C | Focused/full regression and syntax/diff checks | C-002..C-006 | focused 37/37; full 790/788/0/2; baseline 576/574/0/2; syntax + diff clean | COMPLETED |
| C-008 | C | Snapshot deduplication execution trace retention | C-002 | repeated DOM test retains bounded execution bindings after restart | COMPLETED |
| A/B-001 | A/B | Native receiver handshake and dirty checkpoint ACK | existing live sessions | native `DELIVERED` + `ACKNOWLEDGED` + result refs | BLOCKED / UNVERIFIED |
| LIVE-001 | authorized runtime owner | fresh Camoufox identity/readiness and publication | standing authority + account | separate live evidence | BLOCKED |
| GTM-001 | Auto-GTM owner | generated feed/content/media artifact | configured source/provider | capability-specific evidence | BLOCKED |

| C-009 | C | Re-run current fixture and preserve exact evidence | C-002..C-008 | `fixture-run-20ba20f.json`, learning-driven before/after and restart proof | COMPLETED |

## Integration rule

Only C-owned files are written here. A/B dirty files are observed and represented in the candidate only through committed checkpoints already in history; no dirty worktree mutation is allowed.
