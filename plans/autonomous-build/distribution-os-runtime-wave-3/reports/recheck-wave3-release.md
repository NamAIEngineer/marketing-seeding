# Independent release recheck — Distribution OS Runtime Wave 3 (round 3)

**Auditor:** independent verifier (`/root/release_verify_wave3`)
**Repository:** `/Users/nam/Documents/marketing-seeding-wave-rc`
**Observed:** 2026-10-23, Asia/Ho_Chi_Minh
**Scope:** A4, A5, C1–C5, V1, V3, V4 after final GPM root probe/transport wiring change.

## Unverified items first

- UI build/typecheck remains **NOT VERIFIED**: `npm --prefix ui run build` exits 127 (`vite: command not found`; UI dependencies absent).
- Real GPM profile listing/start/CDP/session health and Camoufox executable/profile operation remain **UNKNOWN**. Root API probing is read-only and tested with fixtures; no profile or social account was started or mutated.
- The verifier observed the controller worktree dirty while the final source diff
  was under review; the controller then committed the exact reviewed snapshot as
  `0d6fb02`. No source content changed during that commit and the final RC
  worktree is clean.

## Fresh gate evidence

- `npm test` → **616 total / 614 pass / 0 fail / 2 skipped / 0 todo**, exit 0, duration ~38.9s.
- Focused runtime/GPM/router/ORCA/authority/safety batch (including GPM root probe/transport tests) → **81 total / 81 pass / 0 fail / 0 skipped**, exit 0.
- `node --check src/*.mjs` → PASS.
- `git diff --check` → PASS.
- UI build → **NOT VERIFIED**, exit 127 (`vite: command not found`).

Full-suite skipped tests are ACL/environment checks: `runtime token ACL excludes broad local user groups` and `browser evidence directory and existing screenshots exclude broad local user groups`.

## RC/runtime observations

- Branch: `wave/distribution-os-runtime-rc`; final reviewed implementation:
  `0d6fb02`; latest clean documentation commit: `631674e`.
- Current controller diff modifies 9 tracked source/test files covering browser transport, GPM probe/transport, runtime projection, server wiring, and tests. No source edits were made by verifier.
- ORCA read-only executable probe → `1.4.237`.
- ORCA read-only `status --json` exit 0: app running (`pid=509`), runtime `state=ready`, `reachable=true`, `connectionState=connected`, `appVersion=1.4.237`, graph `ready`.
- No ORCA restart/start/stop, profile/tab command, login, browser interaction, click, Post, publish, or social mutation occurred.

## Canonical UNKNOWN preservation

Read-only `/Users/nam/build-agentic-AI/.agentic/marketing-seeding/state.json` inspection found **6** `submissionUncertainties`, all status `UNKNOWN`, and **6** posts with status `submit_result_unknown`. Preserved IDs:

`19e9eb9b-f854-4530-aeef-9fa789daf73d`, `258383a3-e0c6-4f8d-9754-43bf3b4464fe`, `e9b299b6-b1d5-4564-ab23-f5804a910452`, `df39df1c-2f06-4c20-8e9a-4ed07f5df34c`, `69169dea-1575-4689-ab5e-14ae16c79af8`, `867e0e0d-d2e8-48b4-9e63-0e167f2243d9`.

No state write, retry, reconciliation, deletion, or ID mutation occurred.

## Acceptance results

| ID | Result | Evidence |
|---|---|---|
| A4 | **PASS (bounded)** | Fresh full/focused gates pass; no external/social mutation. UI build unavailable. |
| A5 | **PASS (bounded)** | Exact totals, skipped tests, RC status, ORCA metadata, UNKNOWN preservation, and provider limitations recorded. |
| C1 | **PASS** | No main/integration/canonical-state edits by verifier; only controller RC diff observed. |
| C2 | **PASS** | No ORCA/profile/browser/social mutation or UNKNOWN retry. |
| C3 | **PASS** | No credential material read or recorded; outputs reduced to safe metadata. |
| C4 | **PASS (bounded)** | Full/focused tests preserve separate `COMMAND_COMPLETED`, `CONTROL_ACTIVATED`, `PLATFORM_ACCEPTED`, and `PUBLICATION_VERIFIED` evidence classes. |
| C5 | **PASS** | No merge, deploy, publication, or release approval performed. |
| V1 | **PASS (bounded)** | Full 616/614/0/2, focused 81/81/0/0, syntax and diff checks pass; UI build unavailable. |
| V3 | **PASS** | Six UNKNOWN IDs/states preserved; ORCA process/runtime remained ready and connected. |
| V4 | **PASS** | Direct facts, bounded inferences, and UNKNOWN gaps are distinguished. |

## Required completion fields

- **Outcome:** Final independent recheck passes requested Node/runtime/GPM/router/ORCA/authority/safety gates for the final bounded change; the exact reviewed snapshot is committed as `0d6fb02`.
- **Files changed:** only `plans/autonomous-build/distribution-os-runtime-wave-3/reports/recheck-wave3-release.md`.
- **Tests:** full **616 total / 614 pass / 0 fail / 2 skipped**; focused **81 total / 81 pass / 0 fail / 0 skipped**.
- **Limitations:** UI `vite` unavailable; real GPM profile/Camoufox capability and live publication remain unverified. The reviewed RC snapshot is committed and clean.
- **Next step:** human release review/approval; local gates do not prove live publication.

**Status: DONE_WITH_CONCERNS**
