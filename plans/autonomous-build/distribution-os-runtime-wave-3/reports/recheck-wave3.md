# Independent release recheck — Distribution OS Runtime Wave 3

**Auditor:** independent verifier (`/root/release_verify_wave3`)
**Repository:** `/Users/nam/Documents/marketing-seeding-wave-rc`
**Observed:** 2026-10-23, Asia/Ho_Chi_Minh
**Scope:** A4, A5, C1–C5, V1, V3, V4 after controller source changes.

## Unverified items first

- UI build/typecheck remains **NOT VERIFIED**: `npm --prefix ui run build` exits `127` because `vite` is unavailable (`ui/node_modules` is not installed).
- Real GPM profile listing/start/CDP/session health and Camoufox executable/profile operation remain **UNKNOWN**. Tests cover injected, bounded seams only; no profile or social account was started or mutated.
- The RC worktree remains dirty with the controller's three tracked source/test changes. No source edits were made by this verifier.

## Fresh gate evidence

Commands run from the RC worktree:

- `npm test` → **612 total / 610 pass / 0 fail / 2 skipped / 0 todo**, exit 0, duration ~38.6s.
- Focused runtime/transport/authority/safety batch:
  `node --test test/account-runtime-projection.test.mjs test/browser-interaction-transport.test.mjs test/browser-runtime-router.test.mjs test/camoufox-public-observer.test.mjs test/gpm-runtime-probe.test.mjs test/runtime-projection.test.mjs test/independent-audit.test.mjs test/guards.test.mjs test/campaign-authorization.test.mjs`
  → **77 total / 77 pass / 0 fail / 0 skipped**, exit 0.
- `node --check src/*.mjs` → PASS.
- `git diff --check` → PASS.
- `npm --prefix ui run build` → **NOT VERIFIED**, exit 127 (`vite: command not found`).

The two skipped full-suite tests are ACL/environment checks:
`runtime token ACL excludes broad local user groups` and `browser evidence directory and existing screenshots exclude broad local user groups`.

## RC and runtime observations

- Branch: `wave/distribution-os-runtime-rc`.
- `HEAD` and pin remain `9f002c3d53701d10568b86f7ad6fc1412ae0f9e4`.
- Worktree status: modified `src/browser-interaction-transport.mjs`, `src/runtime-projection.mjs`, `test/browser-interaction-transport.test.mjs`; untracked wave-3 plan/report directory. No changes were made to `main` or `integration/autonomous-build`.
- ORCA read-only executable probe: `--version` → `1.4.237`.
- ORCA read-only `status --json`: exit 0; app running (`pid=509`), runtime `state=ready`, `reachable=true`, `connectionState=connected`, `appVersion=1.4.237`, graph `ready`.
- No ORCA restart/start/stop, tab/profile command, login, browser interaction, click, Post, publish, or social mutation was performed. Existing process set was only observed.

## Canonical UNKNOWN preservation

Read-only inspection of `/Users/nam/build-agentic-AI/.agentic/marketing-seeding/state.json` found:

- **6** `submissionUncertainties`, all status `UNKNOWN`.
- **6** posts with status `submit_result_unknown`.
- IDs unchanged and preserved:
  `19e9eb9b-f854-4530-aeef-9fa789daf73d`,
  `258383a3-e0c6-4f8d-9754-43bf3b4464fe`,
  `e9b299b6-b1d5-4564-ab23-f5804a910452`,
  `df39df1c-2f06-4c20-8e9a-4ed07f5df34c`,
  `69169dea-1575-4689-ab5e-14ae16c79af8`,
  `867e0e0d-d2e8-48b4-9e63-0e167f2243d9`.

No state write, retry, reconciliation, deletion, or ID mutation occurred.

## Acceptance results

| ID | Result | Evidence |
|---|---|---|
| A4 | **PASS (bounded)** | Fresh full and focused gates pass; no external/social mutation. UI build is unavailable. |
| A5 | **PASS (bounded)** | Exact RC identity, totals, skips, UI limitation, runtime observations, and remaining provider gaps recorded. |
| C1 | **PASS** | No main/integration/canonical-state edits by verifier; RC controller changes remain visible as dirty worktree. |
| C2 | **PASS** | No ORCA/profile/browser/social mutation or UNKNOWN retry. |
| C3 | **PASS** | No credential material read or recorded; ORCA output reduced to non-secret metadata. |
| C4 | **PASS (bounded)** | Full/focused suites pass transport and publication evidence separation tests; no action collapses `COMMAND_COMPLETED`, `CONTROL_ACTIVATED`, `PLATFORM_ACCEPTED`, or `PUBLICATION_VERIFIED`. |
| C5 | **PASS** | No merge, deploy, publication, or release approval performed. |
| V1 | **PASS (bounded)** | Node tests 612/610/0/2, focused 77/77/0/0, syntax and diff checks pass; UI build unavailable. |
| V3 | **PASS** | Six UNKNOWN IDs/states preserved; ORCA process/runtime remained running and connected. |
| V4 | **PASS** | Direct observations, bounded inferences, and UNKNOWN runtime gaps are explicitly classified in this report. |

## Required completion fields

- **Outcome:** Independent fresh recheck passes all requested Node/runtime/safety gates on the controller's current RC changes, subject to UI dependency and real-provider limitations.
- **Files changed:** only `plans/autonomous-build/distribution-os-runtime-wave-3/reports/recheck-wave3.md`.
- **Tests:** full **612 total / 610 pass / 0 fail / 2 skipped**; focused **77 total / 77 pass / 0 fail / 0 skipped**.
- **Limitations:** UI `vite` unavailable; real GPM/Camoufox capability and live publication remain unverified; worktree is intentionally dirty with controller changes.
- **Next step:** human review/release approval; do not infer live publication from these local gates.

**Status: DONE_WITH_CONCERNS**
