# Task — Mission 22/D content refresh (2026-11-02)

## Target

Create a new review-only content artifact in a fresh child worktree. Do not edit
the canonical campaign drafts, runtime, publisher, Chrome profiles, or media.

## Change

Rewrite seven product-specific posts for the Mission 22 products:

1. SaaS dashboard
2. Pricing page (describe the produced page only; make no monetization claim)
3. Mobile onboarding
4. Settings/form
5. Profile + design tokens
6. E-commerce product page
7. Blog/article layout

Write both:

- `campaigns/design-os-studio-launch/drafts/drafts-2026-11-02-v4-rule-d.json`
- `campaigns/design-os-studio-launch/drafts/drafts-2026-11-02-v4-rule-d.md`

Keep top-level `status=CONTENT_PENDING_CLAUDE`, `publication=NOT_AUTHORIZED`;
each row remains pending video approval and has a unique media slot. Preserve the
canonical three Claude-approved posts and the earlier seven-post artifacts.

## Required copy rules

- Result first. Every hook, bold/result line, and bullet says what a real user
  finishes and can use. Each bullet has a distinct real task → outcome pair.
- Build in public. LinkedIn uses “My team and I are building …”; Facebook uses
  “Mình và team đang build …”.
- Include the official positioning in metadata and naturally in copy:
  `DESIGN:OS Studio là một Figma alternative chất lượng cao, FREE, built for AI.`
- License wording is exactly `Free, source-available (PolyForm Shield)` or the
  lower-case form `free, source-available (PolyForm Shield)`.
- Never write `mã nguồn mở`, `open source`, `#OpenSource`, paid/pricing-plan/fee
  claims, or backticks. The product name “pricing page” is allowed.
- Full repository URL is mandatory: `https://github.com/jangtrinh/design-os-studio`.
  Use the matching v0.7.6 release URL only for grounded 0.7.6 claims.
- Facebook prose is Vietnamese; LinkedIn prose is English, 120–200 words.
- Use the gold-standard reference at
  `campaigns/design-os-studio-launch/reference/manual-posts-nam-gold-standard.md`
  as the quality bar. Do not use a script/template to clone bodies.

## Pilot variables

Every JSON row must include:

- `hook_variant`: `ordinary_result` or `case_study_numeric`.
- `numeric_claim`: a real number or `null`. At least one row must use
  `case_study_numeric`; when used, include `numeric_evidence` with an exact
  source path/line or a product artifact path. Do not invent a number.
- `link_placement`: `link_in_post` or `first_comment`.
- `firstCommentBody`: only for `first_comment`, containing the required full
  repo/release link; no comment is published by this task.

Use distinct hooks, closing questions, CTA wording, and bullet sets. Keep every
product/video slot unique. Assign channels within Mission 9 caps; if a channel
or group membership is not proven, mark the row conditional rather than claiming
membership or publication.

## Constraints and evidence

- Read-only external source allowed: `/Users/nam/Documents/design-os-issue-1063`
  (README/CHANGELOG only) for facts. Do not modify it.
- No credentials, browser actions, publication, comments, joins, schedule
  activation, runtime changes, or media binding.
- Run the available `design-os-vietnamese` validator against the generated
  Markdown if applicable; record exact command, exit code, and errors/warnings.
- Write a worker report under
  `plans/growth-lead-20261102/reports/content-v4-rule-d-worker.md` ending in a
  `Status:` line. Include file hashes and the validator result.

## Acceptance

- JSON parses; exactly seven rows; unique IDs/products/bodies/video slots.
- All required metadata/copy rules and forbidden scans pass.
- At least one grounded numeric hook; no fabricated numbers.
- LinkedIn word counts 120–200; Facebook rows are Vietnamese prose.
- Artifact remains review-only (`CONTENT_PENDING_CLAUDE`, `NOT_AUTHORIZED`).
- No canonical or live side effect.
