# Implementation-side D verification note

This is not an independent verifier result. The independent verifier dispatch was attempted separately and refused with `NO_PROVIDER`; see `report.md`.

Revision inspected: working tree on `integration/session-d-crawl4ai-listening`, base `dd814bf1df82a0371171ce0ca3674d16a1009368`.

## PASS

- Versioned fetch/extraction/analysis contract; URL, hash, timestamp, revision, scope, coverage and source refs are bounded.
- Nodriver owns a temporary profile and Chrome process; real receipts show browser process exit and profile removal.
- Crawl4AI extraction uses direct Markdown/JSON components on supplied HTML; no AsyncWebCrawler, browser startup, network, or model call in extraction code.
- Canonical persistence uses `recordDiscoveries`, `recordOiMemory`, and `routeOiAgentTask`; no parallel store/router.
- HN real snapshot produced stable post/comment IDs, parent IDs, and source URLs. Repeated state runs dedupe.
- Provider forwarding carries bounded content, analysis digest, and evidence refs; local Qwen receipt is `SUCCEEDED` in the real artifact.
- Focused suite: 29/29 pass. Full project regression: 812 pass, 2 skipped, 0 fail. Node/Python syntax checks pass. HTTP rollback entrypoint passes two public URLs.
- Evidence artifact strips HTML and record text. No credentials/cookies/profile/runtime state committed.

## LIMITATIONS

- Python.org real snapshot was head-only; extraction is honestly `PARTIAL` with zero invented records.
- One benchmark nodriver round was `PARTIAL` after transient public fetch failure. Current sample does not prove speed or memory superiority; observed nodriver peak RSS is high and concurrency remains 1.
- Public channel policy may classify unconfigured hosts as `UNSUPPORTED` in campaign discovery state. This is an existing canonical policy gate, not a collection success claim.
- A/C integration and runtime deployment are not proven by this D worktree. No A/B/C worktree was changed.

## Verification gate

- `V6`: OPEN. Independent dispatch task `session-d-crawl4ai-independent-verifier-20261029-r1` returned `REFUSED / NO_PROVIDER`; no independent PASS is claimed.
