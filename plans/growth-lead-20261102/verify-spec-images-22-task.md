# Task — VERIFY · Mission 22 seven product specs and screenshots

Run: run_6a12be5c1b06 · Role: VERIFY · Controller: Growth Lead · Builder: ctx_47170a457fae (separate attempt)
Workspace: read-only view `/Users/nam/orca/workspaces/marketing-seeding/ms-growth-lead-spec-images-20261102`; report: `/Users/nam/orca/workspaces/marketing-seeding/ms-growth-lead-20261101/plans/growth-lead-20261102/reports/verify-spec-images-22-20261102.md`
Acceptance: A15, V6, V4, V5. Pin: `plans/growth-lead-20261102/pin/spec-images-22-20261102T1148.txt` and worker report claim as untrusted input.

Original request: Mission 22 requires seven complete NodeSpec/designos products and screenshot evidence for dashboard SaaS, pricing, mobile onboarding, settings/form, profile plus design tokens, e-commerce, and blog. Each needs a scoped source spec, applied `.designos`, CLI apply/inspect evidence, readable 1920x1200 screenshot and Dev Mode screenshot, SHA ledger, and no wireframe-only claim. Mission 24 forbids computer use; CLI evidence is required, while visual quality and Claude approval remain UNKNOWN until independently reviewed.

Read-only checks: no-op/report path absent; inspect the worker report and `products/evidence/manifest.json`; assert exactly seven product IDs, source specs/designos, apply receipts with saved=true, inspect node counts >0, main and Dev screenshot files exist and decode to 1920x1200, SHA256SUMS verifies after no edits, product data is scoped, no runtime/publisher/Chrome/service.mjs/canonical manifest changes, and `git diff --check`. Do not use computer use or GUI. Do not modify files. State whether semantic visual completeness can be verified from CLI only.

Forbidden: fixes, screenshots changes, canonical promotion, publication, credentials, comments, joins, API/OAuth, computer use, touching publisher/runtime/video/content/Overview.

Routing: ROLE VERIFY · TIER workhorse `gpt-6-luna` · EFFORT high · reason independent artifact and evidence verification.

Completion: report what could NOT be verified first; acceptance table; direct commands/evidence; confidence; out-of-scope; final lines exactly `Status: PASS (bounded) | FAIL | NO-OP`, `Summary:`, `Concerns/Blockers:`.

Operating discipline: Keep FACT / INFERENCE / ASSUMPTION / UNKNOWN separate. Worker report is a claim. Before each check state PREDICT; surprise => stop and re-model. Attack the final artifact; do not fix. Success test: A15, V6, V4, V5. Constraints: read-only, no computer use, no publisher/runtime edits. Reversibility: two-way.
