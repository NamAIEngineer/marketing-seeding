# Session D Crawl4AI Listening Report

Status: C_INTEGRATED_RUNTIME_VERIFIED; STANDALONE_D_BLOCKED; V5_OPEN

## Final C integration status

C integration is verified at HEAD `246f02f3e9649acef5adba7ee2b876ac6735a7c3` on `integration/session-c-reconciled`. The integrated C runtime passed the full regression with **818 passed, 2 skipped, 0 failed**. This result is separate from the historical D-worktree count of 812 passed, 2 skipped, 0 failed.

The independent report is [`/Users/nam/orca/workspaces/marketing-seeding/session-d-independent-verifier/plans/crawl4ai-integration/independent-verifier-report-20261029.md`](file:///Users/nam/orca/workspaces/marketing-seeding/session-d-independent-verifier/plans/crawl4ai-integration/independent-verifier-report-20261029.md), SHA-256 `34fd69d4467cccac1aa07ec25b023df9e18511bda3c2f316f92d076e2a8341c4`. It completes V6 review but gives the exact standalone D revision `33b115d17a0aba26776ed4219647a0e671d3d6f3` a **BLOCKED** verdict: `src/listening-adapter.mjs` imports `pinnedFetch` and `resolvePublicUrl`, while that D revision's `src/discovery-observer.mjs` does not export them. C overlap/integration fixes this module contract, and the C runtime was verified independently below.

V5 remains **OPEN**: the C public smokes prove bounded run and cleanup, but no controlled canonical component-restart artifact proves persisted job-state recovery. The D same-state rerun/dedupe evidence remains implementation-side evidence and is not upgraded to a canonical restart PASS.

Overall acceptance is **NOT COMPLETE** while V5 remains open and the exact standalone D revision remains blocked.

Base: `dd814bf1df82a0371171ce0ca3674d16a1009368`
Branch: `integration/session-d-crawl4ai-listening`

## Outcome

Implemented a product entrypoint for public market/community Listening. Node owns the bounded job and canonical `SeedingService` writes. A dedicated Python nodriver worker owns a temporary unauthenticated Chrome profile; Crawl4AI parses only the returned HTML snapshot. The existing local provider route receives bounded extracted content plus digest/evidence refs for analysis.

Entrypoint:

```bash
node scripts/listening-run.mjs --urls <url,url,...> --backend http|nodriver [--campaign-id <id>] [--provider-analysis] [--evidence <file>]
```

`http` is the rollback/default baseline. `nodriver` is explicit per job or `SEEDING_LISTENING_BACKEND=nodriver`.

## Pins/runtime

- Crawl4AI `v0.9.5@838869bdda93f25e6d50b3f50ae9577d9b19a586`, Apache-2.0.
- nodriver `0233da5bfbe98dc58341f0863526b6315a97e646`, AGPL-3.0; use/distribution obligations remain subject to the deployment model.
- Python `3.12.15`, `.venv-crawl4ai`, Chrome `156.0.8078.48`, nodriver runtime `0.50.6`.
- Source/license/API details: [source-audit.md](source-audit.md).
- Dependency snapshot: [python-dependencies.lock](python-dependencies.lock); license summary: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Real evidence

`real-run-final.json` is redacted metadata only. Real run used:

- `https://example.com/` — HTTP 200; source hash `fa87188765e603e821d515a49cb8af3316da43767fdfc53a012d37824efc8de5`; extracted hash `0a080719be9fbb82a86a45b80dc8c2a430fbe17dc93d23758debac092864d00f`; page record.
- `https://www.python.org/community/` — HTTP 200; source hash `77e0893ed4ec285bd3743fa5e31200ccc0ee4ce87f0a31dfe6b338217e0d1519`; extraction `PARTIAL` because the returned public snapshot contained only head content; no invented records.
- `https://news.ycombinator.com/item?id=50276792` — HTTP 200; source hash `011a575489f27f329acf6cd38595ea3eae2a022097dfe36bbf4e6ea32f823172`; extracted hash `37f14c5d516352de4ecf8c78e7d446820b7718d44661cabd510889e5a523067f`; 1 post + 99 comments, stable source IDs and parent post ID.

Job: `listening-63f184855b1d7a2c3011e26d-7bf9b72c`; status `PARTIAL`; 3 requested, 2 succeeded, 1 partial; 101 records; the same-state rerun path yielded deduplicated records (latest receipt: `newRecords=10`, `deduplicatedRecords=91`; earlier exact rerun: `newRecords=0`, `deduplicatedRecords=101`). Memory IDs are in the persisted run receipt (`memoryIdCount=101`). Provider receipt: `local-qwen`, `SUCCEEDED`, analysis digest `6b9c9145b17dd388f343e728432f0eae51c0912fad87aa4375e1fd7f247a9661`; provider decision is persisted in canonical `providerDecisions` with bounded evidence refs.

A separate two-URL provider run (`real-run-provider.json`) also returned `local-qwen/SUCCEEDED` with digest `5dd7e19a0a05b6c5326b4c23cf497744bdf28beab08591490ac532359f003013`.

Latest direct nodriver smoke (`real-run-smoke-20261029-r4.json`) used the same three public URLs through `scripts/listening-run.mjs` and produced job `listening-dc798c34873d53af27cc18cc-63aebe21`. Statuses were `SUCCEEDED`, `PARTIAL`, `SUCCEEDED`; 101 redacted records were observed, including one page, one post, and 99 comments. Source hashes were `fa87188765e603e821d515a49cb8af3316da43767fdfc53a012d37824efc8de5`, `77e0893ed4ec285bd3743fa5e31200ccc0ee4ce87f0a31dfe6b338217e0d1519`, and `40fa22fd67bcb2c7ebbcae79370cf391e70b81d5c91d82718f81ea14e15d9652`; extracted hashes were `0a080719be9fbb82a86a45b80dc8c2a430fbe17dc93d23758debac092864d00f`, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, and `e553329746a12810ff87c0c996528e91e065332cd519a073ef816a9530b9e7fb`. Receipts observed Chrome `Chrome/156.0.8078.48`, nodriver `0.50.6`, `processCountAfter=0`, and `browser_process_exited;profile_removed` for every fetch; extraction workers reported `worker_exited` and zero remaining processes.

### C pinned integration verification (2026-10-28T21:07Z)

Using the already pinned D virtualenv without changing C source or dependency files:

- HTTP command: `SEEDING_LISTENING_PYTHON=/Users/nam/Documents/marketing-seeding-session-d-crawl4ai/.venv-crawl4ai/bin/python node scripts/listening-run.mjs --urls https://example.com --backend http --evidence /tmp/session-c-listening-smoke-pinned.json`.
- Job `listening-9e1159276b9a36be48254103-7df82a78`; run status `SUCCEEDED`; fetch `SUCCEEDED` (HTTP 200); extraction `SUCCEEDED`; 1 page record.
- Fetch hash `25ddf2c883e0d1958ea971d279a7e4f0fd446724ee3db7db19dadabd4a62e484`; extracted hash `0a080719be9fbb82a86a45b80dc8c2a430fbe17dc93d23758debac092864d00f`; analysis digest `e2a1bd36714bdf9c27308dc1a9882775cfdc5c1d245a6c33f84ec21e2f678346`; extraction worker cleanup `worker_exited`, `processCountAfter=0`.
- Bounded nodriver command used the same pinned Python and `https://example.com`. Job `listening-6220b76fe0a04bd6abc0203d-bdde3f75`; run/fetch/extraction all `SUCCEEDED`; 1 page record; Chrome `Chrome/156.0.8078.48`, nodriver `0.50.6`; fetch hash `fa87188765e603e821d515a49cb8af3316da43767fdfc53a012d37824efc8de5`; extracted hash `0a080719be9fbb82a86a45b80dc8c2a430fbe17dc93d23758debac092864d00f`; analysis digest `f35475ca9c0b20f08cba2bfc2182833411556538abd0d126de9862211e679322`; browser cleanup `browser_process_exited;profile_removed`, `processCountAfter=0`; extraction worker `worker_exited`, `processCountAfter=0`.
- Both receipts have `persisted: null`: no `--campaign-id` was supplied, so canonical discovery/memory/provider decision persistence was not invoked. No provider-analysis request was made. Evidence files are `/tmp/session-c-listening-smoke-pinned.json` and `/tmp/session-c-listening-smoke-nodriver-pinned.json`.

## Benchmark

[benchmark-runtime-20261029.json](benchmark-runtime-20261029.json) records two bounded rounds on the same two URLs. HTTP completed both rounds in about 6 seconds. Nodriver completed one round in about 9.7 seconds with peak aggregate process RSS about 1.34 GB; the second round was `PARTIAL` after one transient fetch failure. Cleanup receipts report `browser_process_exited;profile_removed`. The sample supports choosing nodriver for explicit JS/public-read coverage; it does not support a speed or memory superiority claim.

## Verification

Focused checks pass: 29 tests covering contract bounds/hash failure, relative URL/provenance, extraction persistence/dedupe, provider content forwarding, observer safety, and deadlines. The C integrated full project regression passed with **818 tests passing, 2 skipped, and 0 failures**. The D-worktree report's **812/2/0** count is historical implementation-side evidence for the pre-integration revision. Syntax checks pass for Node/Python workers; `git diff --cached --check` passes. Direct nodriver smoke passed with no remaining browser process. Extraction worker is HTML-only and no browser/network/model call is made after IPC.

The independent verifier review is now complete at the report path and hash recorded above. It is a valid V6 review result with a concrete BLOCKED verdict for standalone D; it does not convert the standalone D revision to PASS. `verifier-report.md` in this C tree remains implementation-side evidence and is not the independent report.

## Limitations / handoff

- Python community page returned incomplete HTML in this environment; status remains `PARTIAL`.
- Public channel policy defaults may classify unconfigured hosts as `UNSUPPORTED`; this is preserved in canonical discovery state.
- nodriver peak RSS is high in the measured sample; keep concurrency at 1 until a larger controlled sample exists.
- C integration is complete at HEAD `246f02f3e9649acef5adba7ee2b876ac6735a7c3`; no A/B or D worktree, authenticated account, cookie, or publication lane was touched. The exact standalone D revision remains blocked on its missing `pinnedFetch`/`resolvePublicUrl` exports; C's overlap integration supplies that seam.

Overlap handoff details are in [c-overlap-handoff.md](c-overlap-handoff.md). C applied the overlap serially and is clean at HEAD `246f02f3e9649acef5adba7ee2b876ac6735a7c3`; this report retains the original D handoff file for historical scope and ownership context.
