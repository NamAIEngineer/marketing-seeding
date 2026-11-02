# Mission 20 remaining-seven rewrite verification — 2026-11-02

## Scope

Independent read-only verification of only:

- `campaigns/design-os-studio-launch/drafts/drafts-2026-11-02-v3-remaining-7-rewrite.json`
- `campaigns/design-os-studio-launch/drafts/drafts-2026-11-02-v3-remaining-7-rewrite.md`

Canonical drafts, video, runtime, account state, and publication surfaces were not edited. No publication action was attempted.

## Verdict

**PASS (content gates) / PENDING (Claude/media approval and publication).**

## Evidence

### Exactly seven unique rows

The JSON parsed successfully. `posts` length is **7**. IDs, products, bodies, and video slots are all unique at **7/7**.

| ID | Channel | Locale | Product | Video slot | Body words |
|---|---|---|---|---|---:|
| `...01-rewrite` | `linkedin_personal` | `en` | Landing page | `MISSION_16_V3_PENDING_REMAINING_01` | 183 |
| `...02-rewrite` | `linkedin_personal` | `en` | Mobile onboarding | `MISSION_16_V3_PENDING_REMAINING_02` | 172 |
| `...03-rewrite` | `linkedin_personal` | `en` | Signup form | `MISSION_16_V3_PENDING_REMAINING_03` | 173 |
| `...04-rewrite` | `linkedin_personal` | `en` | Pricing page | `MISSION_16_V3_PENDING_REMAINING_04` | 170 |
| `...05-rewrite` | `facebook_timeline` | `vi` | Profile card | `MISSION_16_V3_PENDING_REMAINING_05` | 185 |
| `...06-rewrite` | `facebook_member_group` | `vi` | Design system | `MISSION_16_V3_PENDING_REMAINING_06` | 182 |
| `...07-rewrite` | `facebook_timeline` | `vi` | Analytics workspace | `MISSION_16_V3_PENDING_REMAINING_07` | 197 |

The four LinkedIn word counts (183, 172, 173, 170) are all within the required 120–200 range. Facebook rows are Vietnamese prose; English tokens are product and technical terms retained by the Mission 20 familiar-terminology rule (`file`, `agent`, `layer`, `component`, `Auto Layout`, `Dev Mode`, `code`, `dev`, `.fig`, and product names), not English paragraphs.

### Result-first, build-in-public, and distinct questions

All seven bodies lead with the produced product result. LinkedIn rows then explicitly say `My team and I are building DESIGN:OS Studio`; Facebook rows use `Mình và team đang build DESIGN:OS Studio`. Each body has a product-specific result paragraph and five task-to-outcome bullets.

The seven closing questions are unique. They target landing-page review, onboarding outcomes, signup validation, comparison-page scanability, profile-card content/states, design-system token/component consistency, and analytics information order. None uses the rejected generic `What would you test first on a real project...` CTA.

### Five distinct task-to-outcome bullets

Each post contains exactly five `• task → outcome` bullets. Pairwise comparison found no shared bullet string across any of the 21 post pairs. The bullet sets are specific to the seven products: landing hierarchy, onboarding states, signup states, comparison sections, profile-card states, design-system variables, and analytics workspace structure.

### Grounding and URLs

Every row declares the same grounded release fact:

`DESIGN:OS Studio 0.7.6 local-first canvas, agent workflow, Auto Layout and Dev Mode`

Every row has matching release URL:

`https://github.com/jangtrinh/design-os-studio/releases/tag/v0.7.6`

Every body includes the full repository URL:

`https://github.com/jangtrinh/design-os-studio`

Every row carries source references to `README.md:The Practical Agentic Loop`, `README.md:First Safe Use & The Practical Loop`, and `README.md:Facts Register`. `curl -LIs --max-time 20 https://github.com/jangtrinh/design-os-studio/releases/tag/v0.7.6 | head -1` returned `HTTP/2 200`; this proves transport only, not release semantics.

### Forbidden-content scan

A bounded case-insensitive scan over both rewrite files found no:

- generic `what would you test first` CTA;
- `placeholder`, `??`, or backtick characters;
- `Free To Use` or `freetouse.com`;
- paid, subscription, fee, `thu phí`, `phí`, or `thuê bao` claims.

`Pricing page` is only the named output product; copy contains no price, plan, fee, or monetization claim. Free wording is limited to `Free and open source` / `Free, mã nguồn mở`.

### Pending state and no publication

Top-level JSON state:

```text
status=CONTENT_PENDING_CLAUDE
publication=NOT_AUTHORIZED
```

Each row has `state=CONTENT_PENDING_CLAUDE`, `videoStatus=PENDING_CLAUDE_APPROVAL`, and a pending Mission 16 video slot. No permalink, post ID, publication receipt, or live metric appears. The Markdown header repeats `Status: CONTENT_PENDING_CLAUDE. Publication: NOT_AUTHORIZED.`

## Limitations

This verifies copy and metadata only. It does not prove Claude approval, approved MP4 content, visual product/video matching, account readiness, publication, permalinks, metrics, or external licensing. Pending states correctly keep publication blocked.

Status: **PASS (content gates) / PENDING (Claude/media approval and publication).**
