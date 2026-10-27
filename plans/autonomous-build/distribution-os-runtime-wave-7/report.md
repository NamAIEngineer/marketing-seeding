# Distribution OS Runtime Wave 7 — release candidate report

Observed: 2026-10-23 Asia/Ho_Chi_Minh  
Branch: `wave/distribution-os-runtime-wave-7-rc`  
Baseline: `f5866b7`  
RC head: `3d1d446`

## Unverified items first

- UI build remains unverified because `ui/node_modules/.bin/vite` is not installed in this checkout (`npm --prefix ui run build` exits 127). This is an environment/dependency gap, not a source failure proven by this wave.
- GPM profile start/stop, CDP/WebSocket attachment, account identity, session readiness, and live publication remain unverified. No real lifecycle endpoint was called.
- The RC is not merged into `main`, not deployed, and not wired to canonical runtime state.

## Changes

- Added the independently verified exact-profile GPM catalog projection to `SeedingService.dashboard()` through an optional, process-local observation. Missing observation is `UNKNOWN`; projection is read-only and does not mutate state or create accounts/readiness/authority.
- Added an explicitly invoked GPM profile lifecycle adapter with injected HTTP, dynamic remote debugging endpoint parsing, exact URI encoding, GET-only `/profiles/start/:id` and `/profiles/stop/:id` paths, bounded acknowledgements, no retries, and fail-closed secret/schema/endpoint handling.
- Preserved submit fencing, UNKNOWN quarantine, provider-neutral routing, and all existing server behavior.

## Fresh verification

- Full `npm test`: **631 total / 629 pass / 0 fail / 2 skip**, exit 0.
- Focused independent account/runtime verification: **65/65 pass**.
- Focused independent lifecycle/runtime verification after GET/prefix fix: **58/58 pass**.
- `node --check src/*.mjs`: PASS.
- `git diff --check`: PASS.
- Independent verifier reports: `reports/verify-wave7-account.md`, `reports/verify-wave7-gpm-r2.md`.

## Side-effect boundary

No GPM profile start/stop, CDP/WebSocket attach, login, navigation, click, Post, ORCA restart, canonical-state write, merge, deploy, or social mutation was performed. Existing UNKNOWN execution history remains immutable.

## Truthful capability effect

This wave improves local observability and supplies a tested lifecycle contract. It does not prove account identity, session health, autonomous account selection, irreversible transport certification, public publication, metrics authenticity, Product Factory arbitrary execution, or 24/7 readiness.

**Status: DONE_WITH_CONCERNS**
