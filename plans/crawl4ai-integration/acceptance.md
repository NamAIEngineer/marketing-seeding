# Session D Crawl4AI Listening Acceptance

## Current C integration status

| Area | Status | Evidence |
|---|---|---|
| C integrated runtime | **RUNTIME_VERIFIED** | C candidate source/test revision `3d3d0b0f76656df188f6e0d339e91c9d0f3031bd`; focused Listening V5 checks `20/20`; full `npm test` `825 total, 823 pass, 0 fail, 2 skipped`; campaign-scoped public read and terminal replay completed with no external side effect. |
| Standalone D `33b115d17a0aba26776ed4219647a0e671d3d6f3` | **BLOCKED** | Independent report SHA-256 `34fd69d4467cccac1aa07ec25b023df9e18511bda3c2f316f92d076e2a8341c4` identifies the concrete missing `pinnedFetch` and `resolvePublicUrl` exports from that D revision's `src/discovery-observer.mjs`; C overlap integration fixes the seam. |
| V5 canonical restart proof | **RUNTIME_VERIFIED** | [`v5-restart-evidence-20261029.json`](v5-restart-evidence-20261029.json) records the canonical campaign job `listening-785c32cd7081c573d686b25f231c683d`, persisted discovery/memory, terminal replay without fetch, and unchanged state hash. Focused `20/20`, full `825/823/0/2`; evidence is fixture/public-read rehearsal with no external side effect. |
| V6 independent review | **COMPLETE WITH BLOCKER** | Independent review passes the C candidate V5 evidence at source revision `3d3d0b0f76656df188f6e0d339e91c9d0f3031bd`. The standalone D SHA remains blocked by the missing `pinnedFetch` and `resolvePublicUrl` exports documented in [`independent-verifier-report-20261029.md`](file:///Users/nam/orca/workspaces/marketing-seeding/session-d-independent-verifier/plans/crawl4ai-integration/independent-verifier-report-20261029.md). |

Overall acceptance: **NOT COMPLETE**. C's integrated V5 gate is closed at the candidate revision; standalone D remains blocked and live/authenticated acceptance is outside the verified evidence.

## Requirements

- A1. Pin a verified Crawl4AI source revision and record API, license, Python, and platform compatibility evidence.
- A2. Provide a versioned JSON contract for public source declarations, extracted records, provenance, coverage, dedupe, and run receipts.
- A3. Implement a bounded Crawl4AI adapter with isolated Python lifecycle, stdout JSON only, stderr logs, timeout, output limits, and graceful cleanup.
- A4. Expose Listening through the marketing-seeding product entrypoint and canonical `JsonStore`; do not create a parallel memory or provider router.
- A5. Preserve source URL, captured time, content hash, extractor revision, scope, and source references for every observation and analysis input.
- A6. Keep web content untrusted; never treat page instructions as authority, system prompt, or execution command.
- A7. Dedupe stable source IDs and content hashes across restart and rerun; retain updates/retractions as explicit states.
- A8. Run at least one real public read over two URLs, including an observed post/comment source where available, and preserve redacted evidence hashes and coverage.
- A9. Route one real analysis through the existing Decision Plane/provider contract with an evidence-linked receipt; metadata-only routing is insufficient.
- A10. Provide focused checks, restart/dedupe evidence, installation/run/rollback instructions, and a concise handoff report for C.
- A11. Pin and audit nodriver as a separate public-read backend; record AGPL-3.0 notice, Python/Chrome compatibility, and feature-flag rollback.
- A12. Pass a bounded nodriver HTML snapshot contract into Crawl4AI without opening a second browser or making extraction-stage network/model calls.
- A13. Distinguish BLOCKED, PARTIAL, FAILED, and UNKNOWN outcomes with coverage evidence; never solve login walls or bot challenges.
- A14. Run at least three public URLs, including one JavaScript source, and route at least one job through nodriver via the product entrypoint.
- A15. Record two bounded benchmark rounds on the same URL set for the selected backend and baseline, with wall time, process count/RSS, completeness, and cleanup evidence.

## Constraints

- C1. Base D on C checkpoint `dd814bf1df82a0371171ce0ca3674d16a1009368`; never modify C/A/B worktrees.
- C2. Keep all product writes inside `/Users/nam/Documents/marketing-seeding-session-d-crawl4ai` and keep worker scopes disjoint.
- C3. Do not read, copy, export, or mutate credentials, cookies, browser profiles, authenticated accounts, or publication state.
- C4. Public-read network effects and local state writes must be labeled accurately; no publication, messaging, or account mutation.
- C5. Keep Crawl4AI source and dependency pins immutable and separate from product runtime state.
- C6. Preserve existing memory, Decision Plane, executor, and single-writer contracts.
- C7. Real-run output must not contain raw private data, credentials, cookies, or generated runtime state in Git.
- C8. nodriver uses a temporary profile owned by D; never reuse Camoufox, personal Chrome, cookies, tokens, or authenticated state.
- C9. nodriver subprocesses are owned and cleaned by D; never kill unrelated browser/runtime processes.
- C10. Source and dependency license obligations remain explicit; no license conclusion is inferred from subprocess isolation.

## Verification

- V1. Crawl4AI tag/commit and dependency lock are recorded and import/runtime smoke passes on this Mac.
- V2. Contract, provenance, untrusted-content, dedupe, restart, timeout, and error checks pass.
- V3. Real public-read evidence records URL, capturedAt, raw/extracted hashes, coverage, record IDs, memory IDs, and side effects.
- V4. Existing provider/Decision Plane receives extracted content and returns an evidence-linked receipt.
- V5. A controlled component restart preserves job state and the next run dedupes previously observed records.
- V6. An independent verifier reviews the exact D revision and reports PASS or concrete blockers.
- V7. Handoff identifies base/head, files, entrypoint, pins, run IDs, hashes, memory IDs, provider receipt, limitations, and next owner action.
- V8. nodriver source pin, license, executable/version, backend switch, and rollback are directly verified.
- V9. HTML IPC and extraction process evidence show no second browser/network/model during extraction and no D-owned orphan after cleanup.
- V10. Benchmark and real-run evidence support the backend decision without unsupported performance claims.
