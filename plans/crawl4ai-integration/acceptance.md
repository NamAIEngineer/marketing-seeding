# Session D Crawl4AI Listening Acceptance

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
