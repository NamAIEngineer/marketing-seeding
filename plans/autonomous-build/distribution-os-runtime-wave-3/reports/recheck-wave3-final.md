# Independent final release recheck — Distribution OS Runtime Wave 3 (round 2)

**Auditor:** independent verifier (`/root/release_verify_wave3`)
**Repository:** `/Users/nam/Documents/marketing-seeding-wave-rc`
**Observed:** 2026-10-23, Asia/Ho_Chi_Minh
**Scope:** A4, A5, C1–C5, V1, V3, V4 after final bounded GPM listener/parser/projection change.

## Unverified items first

- UI build/typecheck remains **NOT VERIFIED**: `npm --prefix ui run build` exits `127` (`vite: command not found`; UI dependencies absent).
- Real GPM profile listing/start/CDP/session health and Camoufox executable/profile operation remain **UNKNOWN**. New GPM listener discovery is tested with injected process output and read-only candidates; no profile or social account was started or mutated.
- RC worktree is intentionally dirty with controller changes; this verifier made no source edits.

## Fresh gate evidence

- `npm test` → **616 total / 614 pass / 0 fail / 2 skipped / 0 todo**, exit 0, duration ~38.9s.
- Focused runtime/GPM/router/ORCA/authority/safety batch:
  `node --test test/account-runtime-projection.test.mjs test/browser-interaction-transport.test.mjs test/browser-runtime-router.test.mjs test/camoufox-public-observer.test.mjs test/gpm-runtime-probe.test.mjs test/runtime-projection.test.mjs test/independent-audit.test.mjs test/guards.test.mjs test/campaign-authorization.test.mjs`
  → **81 total / 81 pass / 0 fail / 0 skipped**, exit 0.
- `node --check src/*.mjs` → PASS.
- `git diff --check` → PASS.
- UI build → **NOT VERIFIED**, exit 127 (`vite: command not found`).

Full-suite skipped tests (2) are ACL/environment checks:
`runtime token ACL excludes broad local user groups` and `browser evidence directory and existing screenshots exclude broad local user groups`.

## RC/runtime observations

- Branch: `wave/distribution-os-runtime-rc`; `HEAD` and pin: `9f002c3d53701d10568b86f7ad6fc1412ae0f9e4`.
- Current diff has 9 tracked files modified by controller: browser transport/router, GPM probe, runtime projection, server, and related tests. No source edits were made by verifier.
- ORCA read-only `--version` → `1.4.237`.
- ORCA read-only `status --json` exit 0: app running (`pid=509`), runtime `state=ready`, `reachable=true`, `connectionState=connected`, `appVersion=1.4.237`, graph `ready`.
- No ORCA restart/start/stop, profile/tab command, login, browser interaction, click, Post, publish, or social mutation occurred.

## Canonical UNKNOWN preservation

Read-only `/Users/nam/build-agentic-AI/.agentic/marketing-seeding/state.json` inspection found **6** `submissionUncertainties`, all status `UNKNOWN`, and **6** posts with status `submit_result_unknown`. IDs remain:

`19e9eb9b-f854-4530-aeef-9fa789daf73d`, `258383a3-e0c6-4f8d-9754-43bf3b4464fe`, `e9b299b6-b1d5-4564-ab23-f5804a910452`, `df39df1c-2f06-4c20-8e9a-4ed07f5df34c`, `69169dea-1575-4689-ab5e-14ae16c79af8`, `867e0e0d-d2e8-48b4-9e63-0e167f2243d9`.

No state write, retry, reconciliation, deletion, or ID mutation occurred.

## Acceptance results

| ID | Result | Evidence |
|---|---|---|
| A4 | **PASS (bounded)** | Fresh full/focused gates pass; no external/social mutation. UI build unavailable. |
| A5 | **PASS (bounded)** | Exact totals, skips, RC status, ORCA metadata, canonical UNKNOWN preservation, and runtime limits recorded. |
| C1 | **PASS** | No main/integration/canonical-state edits by verifier; only controller RC diff observed. |
| C2 | **PASS** | No ORCA/profile/browser/social mutation or UNKNOWN retry. |
| C3 | **PASS** | No credential material read or recorded; outputs reduced to safe metadata. |
| C4 | **PASS (bounded)** | Full/focused tests preserve `COMMAND_COMPLETED`, `CONTROL_ACTIVATED`, `PLATFORM_ACCEPTED`, and `PUBLICATION_VERIFIED` separation. |
| C5 | **PASS** | No merge, deploy, publication, or release approval performed. |
| V1 | **PASS (bounded)** | Full 616/614/0/2, focused 81/81/0/0, syntax and diff checks pass; UI build unavailable. |
| V3 | **PASS** | Six UNKNOWN IDs/states preserved; ORCA process/runtime remained ready and connected. |
| V4 | **PASS** | Direct facts, bounded inferences, and UNKNOWN gaps are distinguished. |

## Required completion fields

- **Outcome:** Final independent recheck passes all requested Node/runtime/GPM/router/ORCA/authority/safety gates for the controller's final bounded change.
- **Files changed:** only `plans/autonomous-build/distribution-os-runtime-wave-3/reports/recheck-wave3-final.md`.
- **Tests:** full **616 total / 614 pass / 0 fail / 2 skipped**; focused **81 total / 81 pass / 0 fail / 0 skipped**.
- **Limitations:** UI `vite` unavailable; real GPM profile/Camoufox capability and live publication remain unverified; RC worktree contains controller changes.
- **Next step:** human release review/approval; do not infer live publication from local gates.

**Status: DONE_WITH_CONCERNS**
