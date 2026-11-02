# Candidate 4 content verification — 2026-11-02

Scope: independent read-only verification against current lead HEAD `ed76641fc885665b8ba16fcba3524b36e99fa0f6`. Artifact: `campaigns/design-os-studio-launch/drafts/drafts-2026-11-02-v3-candidate-4.json`. Drafts, video, runtime, and publication state were not modified.

## Verdict

**PASS (content gates) — publication remains blocked by explicit pending state.**

## Evidence

Current HEAD artifact parsed successfully. It contains exactly three posts:

```text
dos-1102-v3-candidate-04-01 linkedin_personal 190 words 6 bullets credits=1/1/1 MISSION_16_V3_PENDING_04_01
 dos-1102-v3-candidate-04-02 facebook_timeline 223 words 6 bullets credits=1/1/1 MISSION_16_V3_PENDING_04_02
 dos-1102-v3-candidate-04-03 facebook_member_group 245 words 6 bullets credits=1/1/1 MISSION_16_V3_PENDING_04_03
```

Body SHA-256 values:

- LinkedIn: `a6ff75db283d8e3a23b38e926c2ab99a8fbc23eba8aa74f8c84a98b84f6c54df`
- Facebook timeline: `faf3c5624b806112320ff95332e916184aa7488bc644bfd69b587f8913f34781`
- Facebook member group: `91fac152c0da36f25e2950a32cc1fd64c3bab85cef3dff6623cc3ec6b426e59`

| Gate | Evidence | Result |
|---|---|---|
| Exactly 3 posts | JSON `posts` array length is 3 | PASS |
| Channel split | One `linkedin_personal`, one `facebook_timeline`, one `facebook_member_group` | PASS |
| LinkedIn 120–200 words | `dos-1102-v3-candidate-04-01` counts 190 words using `\\b[\\w’'-]+\\b` | PASS |
| Facebook Vietnamese gate | Both Facebook bodies are Vietnamese prose. Remaining Latin tokens are bounded to product/campaign names, `.fig`, `build` in the required build-in-public sentence, `team`, `Free`, hashtags, URLs, and exact music-credit lines; no English sentence or paragraph appears | PASS |
| Distinct bodies | Three body hashes above are unique | PASS |
| Distinct video slots | `MISSION_16_V3_PENDING_04_01`, `_04_02`, `_04_03` are unique | PASS |
| v0.7.x fact/release match | All `releaseFact` values identify `DESIGN:OS Studio 0.7.6`; every `releaseUrl` is exactly `https://github.com/jangtrinh/design-os-studio/releases/tag/v0.7.6` | PASS |
| Result-first / build-in-public | LinkedIn opens with a concrete handoff result. Both Facebook posts open `Mình và team đang build ra DESIGN:OS Studio`. Each post has six `• task → outcome` bullets | PASS |
| Free/open-source only | LinkedIn: `Free, open source`; Facebook: `Free, mã nguồn mở`; no price, paid, fee, or monetization claim | PASS |
| Repository URL | Each body includes `https://github.com/jangtrinh/design-os-studio` | PASS |
| Required music credits | Each body contains exactly once: `Music from Free To Use`, `Source: https://freetouse.com/music`, `Edge of Motion by Aetheric` | PASS |
| Pending/no publication | Top-level `status=CONTENT_PENDING_CLAUDE`, `publication=NOT_AUTHORIZED`; every post `state=CONTENT_PENDING_CLAUDE`, `videoStatus=PENDING_CLAUDE_APPROVAL`; no permalink/post ID/publication receipt | PASS |

## Boundary

This is a content and metadata verification. It does not prove Claude approval, approved media, account readiness, live publication, permalink, or metrics. The explicit pending state keeps publication unauthorized.

Status: **PASS (content gates) / PENDING (approval and publication).**
