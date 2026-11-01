# Acceptance — Growth Lead · 2026-11-02

## Requirements

- **A1 (P0 runtime):** Runtime is built from `desktop-integrated` code at pinned SHA, additive state backup exists with timestamp and SHA-256, health is responsive, source provenance is clean/pinned, and credential onboarding exposes the account-credentials POST route without exposing secrets.
- **A2 (P1 content):** Campaign `Design OS Studio — daily distribution` has at least 14 distinct grounded drafts for 2026-11-02, with source references, full repo link, result-first opening, media/evidence references, and channel metadata.
- **A3 (Vietnamese gate):** `design-os-vietnamese` is cloned read-only at a pinned SHA; Vietnamese copy runs through the available `validate_copy.py` gate or records an explicit unavailable/blocked result; no copy with validation errors enters queue.
- **A4 (P2 readiness):** Account state, login/readiness, and existing `submit_result_unknown` reconciliation remain truthful; credential/MFA/CAPTCHA work is listed under `CẦN NAM` and never fabricated as complete.
- **A5 (P3/P4 safety):** Standing campaign authorization is represented with scope, expiry `2026-12-01`, kill switch, caps, and delegated-by-Nam provenance; scheduling/overview surfaces target=10 and verified permalink/metric fields without claiming unverified publication.
- **A6 (North Star):** Overview/content evidence records `https://github.com/jangtrinh/design-os-studio`, current star observation source/time, and path toward 1000 stars; no unsupported attribution claims.
- **A7 (status):** `.orca-coordination/growth-lead-status.md` is updated at phase changes and at least every 30 minutes with the required fields.
- **A8 (video factory):** At least 10 distinct MP4 artifacts are produced or explicitly blocked with evidence. Each queued draft has its own video hash, QA result, thumbnail/preview reference, and channel aspect ratio. The reference MP4 is measured and never silently reused for multiple posts.
- **A9 (scope):** From 2026-11-02 only LinkedIn and Facebook surfaces are eligible: LinkedIn personal/Page and Facebook timeline/Page/member Groups. Threads, Reddit, Product Hunt, Indie Hackers, and X remain paused and cannot enter the queue. Facebook Groups and LinkedIn Groups community discovery/join is active under A10.
- **A10 (community engine):** Facebook Groups and LinkedIn Groups discovery, scoring, bounded join requests, truthful membership answers, rule classification, warm-up state, and postable scheduling are represented with evidence. Join cap is at most 3/account/day and 15/account/week; only credential/CAPTCHA/MFA/OTP blockers go to `CẦN NAM`; `no_promo` and `unclear` groups cannot receive promotional links.

## Constraints

- **C1:** Work only in `/Users/nam/orca/workspaces/marketing-seeding/ms-growth-lead-20261101` and declared child worktrees; preserve unrelated dirty overlays and do not clean/reset/stash them.
- **C2:** No secrets, credentials, OTP, CAPTCHA bypass, external publication, messaging, deploy, merge, or push without a separate human approval gate; Nam's stated delegation authorizes coordination, runtime preparation, and local artifacts, not bypassing credential prompts.
- **C3:** Separate FACT / INFERENCE / UNKNOWN. HTTP 200, process launch, fixture output, or worker self-report never proves live publication.
- **C4:** Parallel writers have disjoint scopes. Integration is serial. Last editor cannot be final verifier.
- **C5:** Use source-grounded claims only; preserve exact links, hashes, SHAs, and receipts. No fabricated permalink, metric, star delta, or `JOINED`.
- **C6:** Do not add or run tests unless needed for the requested verification; any checks run are recorded with exact command and exit evidence.
- **C7:** Only Nam can enter account credentials or solve MFA/CAPTCHA/OTP/token prompts; record instructions under `CẦN NAM` and continue other lanes.
- **C8:** Do not exceed surface/account caps: LinkedIn personal 2/account/day with at least 4h spacing; LinkedIn Page 2/page/day; Facebook timeline 1–2/account/day; Facebook Page 3/page/day; Facebook member Group 4/account/day, one per group, at least 2h spacing. Missing capacity is reported, never filled by cap violations.
- **C9:** Every post must carry a different MP4. Reused fallback video is allowed only as an explicitly marked temporary artifact and never for two posts in the same day.
- **C10:** Community automation may crawl, score, request joins, answer only questions supported by the account's public profile and product facts, read rules, and schedule eligible groups. It must not fabricate profile facts, bypass challenges, join beyond caps, post into groups before approval/warm-up/rule eligibility, or treat HTTP 200/login HTML as authenticated group evidence.

## Verification

- **V1:** Independent read-only verifier inspects the final diff/artifacts, re-runs bounded runtime/content/video gates after the last change, checks pinned state and foreign changes, and writes `plans/growth-lead-20261102/reports/verify-*.md` with `PASS (bounded)`, `FAIL`, or `NO-OP`.
- **V2:** Runtime evidence includes health response, source SHA/dirty state, state backup hash, onboarding route/method evidence, and rollback reference.
- **V3:** Content evidence includes draft count, per-draft source refs, repo URL, locale/channel, validation report/hash, media hash or explicit missing-media status.
- **V4:** No lane is reported DONE without a report ending in the orchestration completion contract `Status:` line; classify `DONE`, `DONE_WITH_CONCERNS`, `NO-OP`, or `REFUSED`.
- **V5:** Overview/status truthfully show current account and publication UNKNOWN/BLOCKED states, target=10, explicit `CẦN NAM` instructions, and paused surfaces.
- **V6:** Video evidence includes reference hash/spec, each output hash, ffprobe/QA evidence, thumbnail/preview route, and a one-to-one post↔video mapping.
- **V7:** Community evidence includes discovery source/time, score inputs, join request receipt/status, truthful-answer basis, group rule receipt/classification, warm-up/postable decision, cap counters, and dashboard counts `discovered`, `join_requested_today`, `approved`, `postable`.
