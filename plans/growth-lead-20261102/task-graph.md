# Growth Lead task graph — 2026-11-02

Run mode: supervised Orca orchestration. Current non-account lanes continue while live account side effects remain blocked by truthful readiness gates. Controller: Growth Lead in `ms-growth-lead-20261101`. Independent verifier: a fresh read-only Codex attempt after the last integration change. Max concurrent workers: 2; completed workers are reused or released before new work starts. P0 login blocks account-dependent publishing/comments, but content/video/public community lanes continue.

## Wave 0 — parallel build

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-runtime | BUILD · runtime | P0 source pin, additive state backup/migration, LaunchAgent/rollback rehearsal, health and credential onboarding evidence | none | A1, V2 |
| T-content | BUILD · content | Grounded LinkedIn/Facebook-only copy buffer (≥14), `design-os-vietnamese` pin/gate evidence, campaign drafts, source map | none | A2, A3, A6, V3 |

## Wave 1 — parallel build, after any free worker

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-video | BUILD · video | Measure reference MP4; produce/validate ≥10 distinct MP4s or bounded blocker; thumbnails, hashes, post mapping | none, may consume content claims read-only | A8, V6 |
| T-community | BUILD · community | Facebook/LinkedIn Group discovery, scoring, bounded join flow, rule/warm-up evidence, dashboard/community data contract | account state may be UNKNOWN; no credential bypass | A10, V7 |

## Wave 1-P0 — account browser architecture (immediate, before account-dependent lanes)

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-chrome-login | BUILD · runtime/account | Visible Playwright Chromium persistent profile manager, manual-login API/UI for LinkedIn/Facebook, native host fingerprint, identity redirect verification, retry with Keychain credential only, canonical `JsonStore`/`SeedingService` source/evidence records, Camoufox public-only routing | none; may read existing runtime/account contracts | A11, A12, V8 |

## Wave 1.5 — non-account execution (2026-11-02 01:57 ICT)

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-schedule-pilot | BUILD · publish/learning | Arm 10 daily slots 07:00–23:00 ICT for 2026-11-02..08; READY gate, first post <=15m, missed-slot shift/no burst, cap-aware | none for arming; READY + permalink/media evidence for live execution | A13, A14, V9 |
| T-comments-report | BUILD · engagement/learning | Reply guards, sensitive CẦN NAM queue, 20/account/day, 2–15m delay, 23:30 reports, 09-Nov pilot report | READY account for live writes; schema can be prepared now | A13, A14, V9 |
| T-community-public | BUILD · community | Public-only FB/LinkedIn discovery artifact with score/rule fields and evidence hashes; no join side effects | none | A10, V7 |
| T-facebook-fixture | BUILD · runtime/account | Preserve chooser/consent/challenge surfaces; fail-closed identity evidence; test fixtures only | none; no real-account retry | A11, A12, V8 |
| T-ui-overview | BUILD · UI | Five growth blocks and explicit CẦN NAM; technical controls under Hệ thống | source integration | A5, V5 |

## Current worker receipts

- `7a8c68f`: Facebook Chrome fixture guard + 6 tests (integrated).
- `T-schedule-pilot` worker edits staged in worktree, pending controller commit.
- `T-community-public` artifact staged in worktree, pending controller commit.
- `T-ui-overview`: worker pending.

## Reconciliation checkpoint — 2026-11-02 03:05 ICT

- `T-schedule-pilot`: `ARMED` in the canonical store; ten slots are defined
  for 07:00–23:00 Asia/Ho_Chi_Minh, but live schedule rows stay at zero until
  an account is `READY` and one post has independently verified permalink and
  media evidence. Missed windows shift to the next unused slot without burst.
- `T-comments-report`: local reply guards and observation-only report schema
  are committed and verified (`node --test test/growth-pilot.test.mjs` — 4
  passed). Live polling/reply remains blocked by the no-READY gate.
- `T-community-public`: 30 public candidate rows are canonical (15 Facebook
  Groups, 15 LinkedIn Groups), source `camoufox-public`; authenticated rules,
  membership, join approval, warm-up, and postability remain `UNKNOWN`.
- `T-ui-overview`: integrated UI presents the five result blocks and explicit
  instructions for the two app-owned Chrome windows; the packaged runtime
  still requires a rebuild from the current source checkpoint.
- `T-video`: the current quality-A intake receipt is
  `BLOCKED_CAPTURE_TARGET_UNAVAILABLE`. Direct frame inspection of the ten
  `.mov` files shows Claude/Orca desktops rather than Design OS Studio. The
  prior manifest's `PASS_REAL_SCREEN_CAPTURE_BOUNDED`/`quality=A` labels are
  therefore not trusted by the projection; no files were deleted or relabeled
  in place.
- `T-integrate`: source projection now fails closed when that intake blocker is
  present, exposing `qaFail=10`, `quality=UNVERIFIED`, and
  `bufferTomorrow=0`; next clean package must carry this truthful state.

## Quality-A replacement checkpoint — 2026-11-02 04:18 ICT (superseded 05:05)

- `T-video`: the 04:18 PASS is superseded by Claude's 05:05 visual review.
  The ten 4.4-second files failed composition review (headline overflow, clip
  crop/overflow, missing proper intro/end card and repo CTA). They remain under
  the rejected audit directory and cannot bind pilot slots.
- `T-integrate`: projection now requires
  `video/quality-a/composition-qa.json` with status
  `PASS_QUALITY_A_COMPOSITION` plus true checks for reference-frame
  comparison, headline bboxes, clip containment, intro/end cards, full repo
  URL and star CTA. Until then it exposes `qaFail=10` and `bufferTomorrow=0`.
- `T-video-v2`: worker recomposed ten 18.6-second MP4s (intro + three scenes +
  end card) with v2 proof grids, but the receipt references `compare-v2`
  evidence that is not present in the lead checkout. Canonical manifest/draft
  hashes are stale relative to the changed files and must not be promoted.
- `T-verify-video-composition`: independent read-only verifier checks decoded
  frames/contact grids, bbox and clip bounds, template sections, repo URL, CTA,
  actual Studio source, unique hashes and canonical mapping before any
  manifest/draft update or packaged rebuild. No account retry/publication.

## Wave 2 — serialized integration and verification

| Task | role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-integrate | BUILD · integration | Controller-only cherry-pick/reconcile disjoint worker commits into current branch; update decisions/status/Overview seams; no external publish/deploy/merge | T-runtime, T-content, T-video, T-community | A1–A10 |
| T-verify | VERIFY · independent | Fresh read-only inspection after T-integrate; rerun bounded gates; inspect pins/foreign changes; write unique verification report | T-integrate | V1–V7 |

## Wave 3 — after Chrome account readiness (do not claim READY before evidence)

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-comments-pilot | BUILD · publish/learning | Account-owned comment polling/reply safety, 07:00–23:00 schedule, pilot variable/metric schema, daily 23:30 and 2026-11-09 08:00 reports, warning/checkpoint frequency reduction | T-chrome-login; at least one account identity verified for live side effects | A13, A14, V9 |

## Wave 3 — account pool after the Chrome gate

`T-account-pool` starts only after `CHROME_LOGIN_READY` is recorded. It does not weaken the manual-login gate: credentials may be supplied only through the local UI/CSV picker, are written to Keychain, and are never persisted in state, logs, repo, or chat.

| Task | role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-account-pool | BUILD · account/runtime | Local account-list form plus one-shot local CSV import; validate LinkedIn/Facebook rows; create one app-owned Chrome profile per account; read Keychain credentials for bounded auto-login; stop challenged accounts and surface `CẦN NAM`; continue independent pool accounts; project all rows through the single `JsonStore`/`SeedingService` with source/evidence hash | `CHROME_LOGIN_READY`; existing account credential seam | Mission 14, A11, V8 |
| T-linkedin-pilot | LIVE-PREP · publish | After at least one account reaches READY, run exactly one LinkedIn browser post with one approved MP4, independently verify permalink/media, and record evidence before enabling schedule | T-account-pool; READY account; kill switch/campaign gate | one real permalink or explicit BLOCKED/UNKNOWN; no fabricated publication |
| T-schedule-pilot | BUILD · publish/learning | Enable 10/day 07:00–23:00 only after pilot post proof; allocate across account pool under per-account caps, spacing, warning 50% reduction, and kill switch | T-linkedin-pilot; verified permalink | A13, A14, V9 |

Paused scope: Threads, Reddit, Product Hunt, Indie Hackers, X publication; no W3b platform outside Facebook/LinkedIn Groups. Credential entry and CAPTCHA/MFA/OTP remain the only `CẦN NAM` actions. T-comments-pilot may implement guards and scheduling before login but must not perform live writes until a READY account and kill switch are evidenced.

## Wave 4 — Mission 22 parallel production (11:48 ICT)

Publisher ownership is external and exclusive to `term_84dd3dea` (task `task_ccae37fd6ff6` / dispatch `ctx_296c3a1aa393`). Lead must not touch publisher code, Chrome profiles, or `service.mjs` publish paths. All three tasks below have disjoint artifact scopes and no live side effects.

| Task | role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-spec-images-22 | BUILD · spec/images | Seven complete NodeSpecs and `designos --apply-spec` screenshots/evidence for dashboard SaaS, pricing, mobile onboarding, settings/form, profile + design-system tokens, e-commerce, blog; include `.designos` source files and screenshot hashes. | none; read-only reference images/spec examples | A15, V6 |
| T-content-22 | BUILD · content | Seven hand-written posts, one per product/media, following Nam gold standard and Mission 22/D: result-first, build-in-public, FREE + source-available (PolyForm Shield), official Figma-alternative positioning, no open-source wording, distinct case-study numeric hook and link placement experiment. | T-spec-images-22 product names may be consumed read-only; product facts must be README/CHANGELOG grounded | A15, A2, A3, V3 |
| T-video-22 | BUILD · video | Dashboard video #1 using apply-spec against scoped file, ScreenCaptureKit/CLI-only capture, 30–40s complete process/reveal, intro/end card with full repo URL and Star CTA, reference-frame/bbox/crop checks, silent audio permitted. | none; no publisher or personal Chrome | A8, A15, V6 |

Dispatch contract: controller Growth Lead; role BUILD; tier workhorse `gpt-6-luna`, effort high; independent verifier is a fresh read-only attempt after each final artifact; worktrees `ms-growth-lead-spec-images-20261102`, `ms-growth-lead-content-20261102`, and existing `ms-growth-video-20261101` respectively. Each worker must write its declared report, pin state before edits, preserve foreign dirty artifacts, send one `worker_done`, and end with `Status:`. Claude approval and publication remain human approval gates; no worker may publish, join, comment, access credentials, or use computer use.

## 2026-11-02 07:06 ICT — Mission 18 latest content + packaged refresh

- T-content: worker commit `ea98daa` integrated as `a3a5117`; independent report commit `1393eea` PASS bounded. Facebook timeline/group hooks are distinct and each states “Mình và team đang build…” with concrete outcomes; all rows remain `CONTENT_PENDING_CLAUDE`.
- T-runtime: candidate source `1393eea` built in a detached checkout and swapped into packaged 4321 with state backup/rollback. Health probe PASS; sourceDirty=false; state revision 454; 4318 untouched.
- T-video: recorder repair report complete; v5 production still pending; canonical media remains fail-closed (`qaFail=10`, buffer=0). No video or content approval inferred.
- T-publish: zero scheduled, zero verified permalink, zero live publication. Pilot remains armed, dual content/video gates closed.

## 2026-11-02 07:26 ICT — Mission 18/06:06 content checkpoint

- `T-content`: worker `65d8b1a` integrated as `f69a501`; independent verifier `838f6fb` PASS_WITH_CONCERNS bounded. All eight Facebook posts now explicitly say `Mình và team đang build ra ... để người dùng ...`; timeline (4) and member_group (4) remain distinct. 16 unique bodies/slots, LinkedIn 179–190 words, Free/open-source only, full repo URL, no backticks, all `CONTENT_PENDING_CLAUDE`.
- `T-runtime`: packaged 4321 still observes prior LaunchAgent source `1393eea`; rebuild from HEAD `f69a501` required. Preserve state revision/Keychain/Chrome profiles and leave 4318 untouched.
- `T-publish`: zero scheduled, zero verified permalink, zero live publication. Content/video approval gates stay closed.

## 2026-11-02 07:42 ICT — v5 prototype batch gate

- `T-video`: ten technically valid v5 prototype MP4s exist under `video/quality-a/v5-prototype/artifacts-v5`, each 32.000s H.264/AAC with thumbnails and unique hashes.
- Independent receipt `verify-video-v5-batch-20261102.md` is `FAIL / PENDING — PROTOTYPE BATCH ONLY`: nine outputs are deterministic derivatives of one capture sequence, audio license is UNKNOWN, and `CLAUDE_APPROVED` is absent.
- Canonical manifest/draft media bindings remain unchanged. `T-integrate`, `T-publish`, and schedule stay blocked until independent capture/approval/license gates pass.

## 2026-11-02 07:45 ICT — independent-capture blocker

- `T-video`: fresh read-only receipt `verify-video-v5-independent-capture-blocker-20261102.md` confirms six real capture sessions only; nine derivative outputs do not establish independent final captures. Audio license remains UNKNOWN and `CLAUDE_APPROVED` is absent.
- Canonical media/draft bindings remain untouched. `T-integrate`, `T-publish`, and schedule remain blocked pending nine additional real sessions or an explicit approved fan-out policy, audio evidence, and Claude approval.

## 2026-11-02 07:56 ICT — MISSION 19 candidate-3 integration

- `T-content-v3-candidate`: worker `44aaa6f` integrated as `62c1eea`; exactly three review candidates added. Independent verifier pending. Failed v2 remains preserved and rejected.
- Candidate gate requires verifier PASS, then explicit Claude content approval before expanding to remaining posts.
- `T-video-01` and `T-audio-license` remain independent; no content candidate implies video approval or license proof.

## 2026-11-02 08:11 ICT — MISSION 19 candidate-4 correction

- `T-content-v3-candidate`: candidate-3 verifier FAIL (207-word LinkedIn and substantial English in Facebook) is preserved. Candidate-4 commits `d08de11`, `f6e90d7`, and `ed76641` contain exactly three separate hand-written posts. Independent verifier `verify-content-v3-candidate-4.md` now PASSes content gates at HEAD `ed76641` (LinkedIn 190 words; bounded Vietnamese Facebook); content remains `CONTENT_PENDING_CLAUDE`.
- `T-audio-license`: `cbfcc7f` preserves official Free To Use download and license snapshot. Commercial campaign use is BLOCKED by the official Commercial Content prohibition; no audio/media approval inferred.
- `T-video-01`: 07:58 v6 live-session retry opened blank `.designos` in official Studio window 44649 and accepted an Agents prompt, but produced no canvas diff or MP4 (`BLOCKED_INTERACTION_CAPTURE`). No valid raw session or `CLAUDE_APPROVED` evidence exists.
- `T-video-01`: worker commit `d8f56f2` integrated as `f1537f7`; `REPORT.md` plus prompt/blank-state screenshots and SHA256 sums provide bounded evidence of the same `BLOCKED_INTERACTION_CAPTURE`. Do not generate videos 2–10 or bind any media until video #1 passes MISSION 19 and Claude approves it.
- `T-audio-license`: replacement search commit `7b29b57` adds official FAQ evidence. No free track with explicit commercial permission was found; active Commercial Plan or single-track license is required. Keep audio and all video/media gates blocked.
- `T-video-01`: recovery diagnosis `dc00c34`/`12cadb4` identifies foreign-worktree Studio binding (`quality-a/v6-live/blank.designos`), unsaved Claude Untitled session, and empty `DESIGNOS_FILE`. Recovery must use a newly bound scoped session only; do not restart or mutate the foreign session. Current state remains `BLOCKED_DIAGNOSTIC_ONLY`.
- Final controller receipt: lead HEAD `ca011e7` is pushed and matches `origin/NamAIEngineer/marketing-seeding`. No canonical media/draft/manifest changes or live side effects were performed after the gates closed.

## 2026-11-02 09:55 ICT — MISSION 20 redispatch

- `T-content`: Claude-approved 3-post source is `campaigns/design-os-studio-launch/drafts/drafts-2026-11-02-v3-claude.md`. Seven additional posts dispatched to a separate worker; product/video uniqueness and hand-written quality are required before integration.
- `T-audio-license`: Edge of Motion/Free To Use is superseded. Pixabay/commercial-license evidence search is bounded to 30 minutes; silent video is permitted after timeout and should not block content/video.
- `T-video-01`: fresh worker must save a named blank `.designos`, open that exact path, verify scope, wait >=5 minutes, and fall back to scoped designos-mcp/CLI node creation with ScreenCaptureKit capture. No foreign process restart, canonical binding, videos 2–10, or publication.

- `T-content-remaining-7`: worker commit `b449d341` integrated as `2c578b4`; exactly seven additional hand-written posts cover landing page, mobile onboarding, signup form, pricing page, profile card, design system, and analytics workspace. Independent gate pending; no canonical Claude-approved 3-file mutation.
- `T-integrate`/`T-publish`: remain fail-closed. No canonical draft expansion, video binding, schedule activation, publication, permalink, comment, or group side effect is allowed before independent PASS plus explicit Claude content/video approval and valid commercial audio rights.

## 2026-11-02 10:15 ICT — Mission 20 review checkpoint

- `T-content-remaining-7`: original seven-post artifact failed independent review because LinkedIn rows repeated the rejected generic CTA. Replacement files `drafts/drafts-2026-11-02-v3-remaining-7-rewrite.json/.md` were written in commit `c57c681`; independent report `verify-content-v3-remaining-7-rewrite.md` is **PASS (content gates) / PENDING (Claude approval and publication)**. It proves 7/7 unique products, bodies, IDs, and video slots; LinkedIn 170–183 words; Vietnamese Facebook; seven distinct closing questions; five unique task→outcome bullets per post; grounded 0.7.6 and repository/release URLs; no pricing, Free To Use, placeholder, backtick, or generic CTA. Existing canonical approved three-post file remains untouched; replacement seven remain outside the canonical manifest and `CONTENT_PENDING_CLAUDE`.
- `T-audio-license`: Pixabay request was HTTP 403 Cloudflare. Official Wikimedia Commons evidence now clears the fallback track `Moral Berkarat (2021)` by AlexanderMenulis under CC0 1.0: commercial reuse permitted, attribution not required, SHA-256 `dbf668a6704c3ef92430592f701f161a3f0e82ac48f199fed1e0fd89ebbc5cae`; metadata/deed evidence is under `plans/growth-lead-20261102/evidence/`. `quality-a/template-spec.json` records URL, license, retrieval time, hash, and evidence. No claim that any video has been muxed; silent fallback remains allowed.
- `T-video-01`: Mission 20 worker created and opened the named blank `mission-20-video-01/dashboard-01.designos` in a fresh scoped worktree; exact process path was observed. Agents binding failed, no five-minute wait claim was made, no scoped CLI fallback was available, and no raw capture/MP4/contact sheet exists. Evidence is integrated as `db9e0fe`. Foreign Studio PID/worktree, canonical manifests, videos 2–10, and `CLAUDE_APPROVED` remain untouched.
- `T-video-01` follow-up: official `designos`/`designos-mcp` 0.7.6 discovery completed in the scoped worktree (`36a7791`). `designos --inspect-json` rejects the intentionally blank file with EOF; MCP stdin probe closes before initialize. No valid bootstrap/live session or capture path was established; no mutation was attempted.
- `T-integrate`/`T-publish`: remain fail-closed. Do not promote the rewrite into canonical drafts, bind media, rebuild 4321, schedule, publish, reply, or join until Claude approves content and video #1 has independently verified visual evidence. Accounts remain READY from prior receipt; no credential action.
