# Distribution OS Runtime Wave 8 — release candidate report

Observed: 2026-10-23 Asia/Ho_Chi_Minh  
Branch: `wave/distribution-os-runtime-wave-8-rc`  
RC head: `2e8f83c`

## Unverified items first

- UI build remains unavailable because `ui/node_modules/.bin/vite` is missing (`npm --prefix ui run build` exits 127).
- No live GPM profile start/stop, CDP/WebSocket attach, browser navigation, login, account identity proof, LinkedIn publication, metrics authenticity, or 24/7 soak was performed.
- The RC is not merged into `main`, not deployed, and not connected to canonical runtime state.
- The session coordinator is provider-neutral and fake-injectable; it is not yet wired into live service execution.

## Changes

- Server dashboard observation reuses the existing read-only `probeGpmRuntime` profile catalog probe. Probe failure is projected as `UNKNOWN` or `UNAVAILABLE`; no lifecycle call or state write occurs.
- Mission Control displays bounded GPM catalog linkage using fingerprints and explicit linkage states. Raw profile IDs, credentials, storage, proxy, and session material are not projected.
- Added `GpmSessionCoordinator` with deterministic account selection, exact platform/account/profile health binding, explicit lifecycle start/stop, in-memory lease tracking, duplicate/foreign release rejection, no retry/fallback, and sanitized runtime identity.
- Preserved irreversible-submit fences, transport selection before durable intent, and historical UNKNOWN quarantine.

## Verification

- Full `npm test`: **639 total / 637 pass / 0 fail / 2 skip**, exit 0.
- Wave 8 focused RC gate: **66 total / 66 pass / 0 fail / 0 skip** (independently rerun after final integration).
- Observation lane independent gate: **60/60 pass**.
- Session lane independent gate: **66/66 pass**.
- `node --check src/*.mjs`: PASS.
- `git diff --check`: PASS.
- UI build: SKIP/ENVIRONMENT — Vite binary absent.
- Independent RC review: `reports/verify-wave8-rc-release.md`, pin matched `2e8f83c`, status `DONE_WITH_CONCERNS`.

## Side-effect boundary

No GPM profile start/stop, CDP/WebSocket attach, login, navigation, click, Post, ORCA restart, canonical-state write, merge, deploy, or social mutation occurred. Existing UNKNOWN executions remain immutable.

## Truthful capability effect

Wave 8 adds bounded read-only GPM catalog observability and a tested, secret-free session lease seam. It does not prove live account identity, session readiness, autonomous browser execution, irreversible transport certification, public publication, outcome metrics, arbitrary Product Factory execution, or 24/7 readiness.

**Status: DONE_WITH_CONCERNS**
