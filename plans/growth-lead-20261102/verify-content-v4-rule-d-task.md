# Task — Independent verify Mission 22/D v4 rule-d content

## Scope

Read-only inspection of the committed artifact in:

`/Users/nam/orca/workspaces/marketing-seeding/ms-growth-lead-content-v4-rule-d-20261102`

Verify only:

- `campaigns/design-os-studio-launch/drafts/drafts-2026-11-02-v4-rule-d.json`
- matching `.md`
- `plans/growth-lead-20261102/reports/content-v4-rule-d-worker.md`

Do not edit this worktree. Do not inspect or modify runtime, publisher, Chrome,
credentials, media, canonical drafts, or external services.

## Gates

1. JSON parses; exactly seven unique IDs/products/bodies/video slots.
2. Products are dashboard, pricing page, mobile onboarding, settings/form,
   profile + design tokens, e-commerce product page, and blog/article layout.
3. Top-level and row states remain `CONTENT_PENDING_CLAUDE`,
   `PENDING_CLAUDE_APPROVAL`, and `NOT_AUTHORIZED`; no permalink/publication.
4. Every row has official positioning and exact source-available PolyForm Shield
   license wording; scan body/comment fields for forbidden `mã nguồn mở`,
   `open source`, `#OpenSource`, pricing/fee claims, and backticks.
5. LinkedIn body counts are 120–200 words; Facebook rows are Vietnamese prose;
   build-in-public and result-first task→outcome bullets are present and unique.
6. At least one `case_study_numeric` row has a non-null grounded number and an
   exact evidence reference; ordinary rows may use `numeric_claim=null`.
7. Every row has `link_in_post` or `first_comment`; first-comment rows contain
   full repo/release URLs. Repo URL and matching release URL are exact.
8. Re-run the recorded validator command (or record unavailable) and record
   exact exit/output. Recompute artifact hashes. Confirm only the declared
   artifact/report commits exist in the builder worktree.

## Output

Write a fresh report in the lead checkout:

`plans/growth-lead-20261102/reports/verify-content-v4-rule-d.md`

The report must classify `PASS (bounded)`, `FAIL`, or `NO-OP`, list evidence,
limitations, exact commands/exit codes/hashes, and end with `Status:`. Do not
promote, approve, publish, or change any artifact.
