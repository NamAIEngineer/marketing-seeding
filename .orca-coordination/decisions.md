# Integration decisions

- Candidate is `integration/session-c-reconciled`; code/test checkpoint is `20ba20f6f8f273a72cb0db88b216d645aeecaeb1`; C-owned evidence/docs are being finalized on top of committed `e9a7bfa9dc561a4dad06035caaeabff35ee0d8f0`.
- Candidate history contains merge commit `d195756af715e686de46b2f6de8fbb11b7cace9b`, which merged A's committed Camoufox checkpoint `52072ce` into the C candidate. B owner checkpoint `b675a98e6dd2da3c12133dff715eddea616c91f5` was created natively after focused `41/41` pass and awaits serial C integration.
- `marketing-seeding` remains the only application, `JsonStore`, `SeedingService`, dashboard, and Decision Plane. No second oi-browser app/store/orchestrator was added.
- oi-browser source pin: `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm source pin: `9368098477d78f75d57fdf5db276129948f3a183`.
- oi-browser memory, provider routing, static BrowserSnapshot/semantic identity, and validated intent seam are adapted into the canonical store/service. Static evidence cannot prove live DOM or publication.
- Auto-GTM remains a read-only `lead-feed` capability. `feed_not_generated` is surfaced as unavailable; no generation/media claim is made.
- GPM is not active in the server runtime. Historical compatibility modules remain only where existing contracts require them.
- Active runtime `4318` belongs to A and was not restarted. Candidate verification uses private temporary state and port `4333`.
- Loopback Qwen `/v1/models` health is not inference proof: current smoke returned `FAILED/nonzero` with `exit_code_404`; the local MLX log records `generation thread died` from Metal `Insufficient Memory`. Keep provider execution unavailable until a fresh inference succeeds.
- Fixture/runtime evidence remains separate from live evidence. No credentials, login, grant, publish, deployment, merge, push, or external side effect was performed.
- Native review markers are durable in the A/B terminals: `RESULT-A-20261028T0420Z` and `RESULT-B-20261028T0420Z`, with exact worktree/HEAD/dirty-scope references. B checkpoint is `b675a98`; A remains at `52072ce` while its owner checkpoint is prepared. The independent C verifier PASS remains separate from failed queue task `2fdee808-270a-491c-a042-14dc3fad3972`.
