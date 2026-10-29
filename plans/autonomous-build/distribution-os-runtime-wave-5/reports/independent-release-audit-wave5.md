# Independent release audit — Distribution OS Runtime Wave 5

**Repository:** `/Users/nam/Documents/marketing-seeding-wave-rc`
**Branch:** `wave/distribution-os-runtime-rc`
**Observed:** 2026-10-23, Asia/Ho_Chi_Minh
**Verifier:** independent read-only audit

## Unverified items first

- UI build/typecheck is **NOT VERIFIED**: `npm --prefix ui run build` exits `127` because `vite` is unavailable.
- Real GPM profile start/stop, CDP/WebSocket attach, login/session health, and Camoufox runtime remain **UNKNOWN**. The profile catalog is metadata-only and does not establish account identity or readiness.
- Worktree has uncommitted Wave 5 changes; no source edits were made by this verifier.

## Fresh verification

- `npm test`: **616 total / 614 pass / 0 fail / 2 skipped / 0 todo**, exit 0.
- Focused batch (`gpm-runtime-probe`, browser runtime/router, runtime projection, account/authority/guards/campaign safety): **58 total / 58 pass / 0 fail / 0 skipped**, exit 0.
- `node --check src/*.mjs`: PASS.
- `git diff --check`: PASS.
- UI build: NOT VERIFIED, exit 127 (`vite: command not found`).
- Full-suite skipped tests are ACL/environment checks: `runtime token ACL excludes broad local user groups`; `browser evidence directory and existing screenshots exclude broad local user groups`.

## Wave 5 diff and leakage review

Observed modified files: `src/gpm-runtime-probe.mjs`, `src/runtime-projection.mjs`, `src/server.mjs`, and focused tests. The implementation uses GET-only same-origin catalog requests and allowlists profile ID/name/group/browser/OS/pinned/tags/timestamps. Raw proxy, storage path, note, credential, cookie, password, token, and session fields are not emitted by the catalog or runtime projection. Direct source scan found zero occurrences of `raw_proxy`, `storage_path`, and `note` in production probe/projection/server files. Focused tests explicitly assert dropped fields and GET method.

GPM health remains unbound: profile catalog observation returns metadata only; account/session binding is null unless explicitly supplied, so readiness/execution eligibility remains UNKNOWN. No route policy or irreversible-submit fence changed in this audit.

## Runtime and canonical-state observations

- RC `HEAD`: `22654fc` (`docs: link camoufox feasibility evidence`). Worktree contains controller modifications and untracked Wave 5 plan/report files.
- ORCA read-only `--version`: `1.4.237`.
- ORCA read-only `status --json`: exit 0; app running PID 509; runtime `state=ready`, `reachable=true`, `connectionState=connected`, `appVersion=1.4.237`.
- No ORCA restart, profile/tab start/stop, CDP/WebSocket attach, login, navigation, click, Post, social mutation, merge, or deploy occurred.
- Canonical state `/Users/nam/build-agentic-AI/.agentic/marketing-seeding/state.json`: **6** `submissionUncertainties`, all `UNKNOWN`; **6** posts `submit_result_unknown`. IDs and states were preserved; no writes/retries/reconciliation occurred.

## Acceptance classification

| ID | Result | Evidence |
|---|---|---|
| A1 | PASS (bounded) | Read-only GPM catalog probe uses discovered/supplied endpoint and GET requests only. |
| A2 | PASS | Allowlisted catalog fields; unsafe raw proxy/storage/note/credential/session fields discarded. |
| A3 | PASS | Catalog does not become account identity/readiness; unbound GPM health remains UNKNOWN. |
| A4 | PASS (bounded) | Probe wired into liveness with no route or submit-fence changes observed. |
| A5 | PASS (bounded) | Focused/full tests and safety gates pass; UI build and real provider runtime remain unverified. |
| C1 | PASS | No profile/browser/social/ORCA/merge/deploy side effects by verifier. |
| C2 | PASS | No secret fields read or persisted; source/projection leakage scan clean. |
| C3 | PASS | Canonical UNKNOWN executions remain unchanged. |
| C4 | PASS | GPM health stays UNKNOWN without explicit account/profile/session binding. |
| V1 | PASS | Fake fetch tests prove GET-only, same-origin, allowlisting, and schema-drift UNKNOWN behavior. |
| V2 | PASS (bounded) | Fresh full 616/614/0/2 and focused 58/58/0/0; syntax/diff checks pass. |
| V3 | PASS | Independent observation found no mutation and no secret fields in outputs. |

## Required completion fields

- **Outcome:** Wave 5 bounded GPM profile catalog and liveness wiring independently verified.
- **Files changed:** only this report.
- **Limitations:** UI dependencies missing; real profile/session/Camoufox capability unknown; worktree uncommitted.
- **Next step:** human release review; no live execution inferred.

**Status: DONE_WITH_CONCERNS**
