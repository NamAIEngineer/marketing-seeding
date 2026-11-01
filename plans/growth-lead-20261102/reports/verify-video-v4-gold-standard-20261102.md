# MISSION 16/18 v4 long prototype verification — 2026-11-02

Scope: independent read-only review of `campaigns/design-os-studio-launch/video/quality-a/v4-long-prototype`. Compared against the supplied release-recap reference, `manual-posts-nam-gold-standard.md` (MISSION 18), and the available video task contract (MISSION 16 acceptance/task notes). No media, manifest, draft, status, or decision file changed. No promotion performed.

## Evidence reviewed

- Prototype: `campaigns/design-os-studio-launch/video/quality-a/v4-long-prototype/v4-long-prototype-dos-1102-01.mp4`
- README: `campaigns/design-os-studio-launch/video/quality-a/v4-long-prototype/README.md`
- Contact: `v4-long-prototype/contact/contact-sheet-2fps.png` (`1600x1260`)
- Comparison: `v4-long-prototype/compare/v4-vs-reference.png` (`640x1256`)
- Cards: `intro.png`, `hook.png`, `reveal.png`, `end.png`, six 45-frame card tracks (`s01`–`s06`), all `1280x720`
- Scene sources: hook/title, hook, six step clips, reveal, end, and six base clips; all hashes distinct within the scene set.

## Checks

### Container and duration

`ffprobe` on the prototype:

- Video: H.264, `1280x720`, `30/1`, `29.000000` seconds, `870` frames.
- Audio: AAC, `48000 Hz`, stereo, `30.230625` seconds, `1419` frames.
- Format duration: `30.230625` seconds.
- SHA-256: `9a01dcbaffabbbf4a3843f36f01d83444077ed8641122084d9f75d522f6a83be`.

The audio/video end offset is about `1.23s`; video is continuous and reaches the required 30–40s story range at the container level, but stream durations are not exactly equal.

### Gold-standard visual/content alignment

- **Opening:** intro card visibly uses the blue selection frame and `design:os studio`; hook card presents the result (`A SaaS dashboard.` / `From a blank file.`).
- **Six-step making story:** contact sheet and scene inventory show six numbered step tracks. Visible progression includes `Open`, `Ask`, `Build`, `Switch`, and `Check`; README identifies six real Studio capture steps: open file, ask agent, auto layout, variables, check design, Dev Mode.
- **Studio capture/crop:** contact frames visibly show the Studio UI inside the blue framed viewport, with crop/zoom treatment consistent with the supplied release-recap geometry. This is artifact evidence, not fresh live-session proof.
- **Reveal:** `reveal.png` visibly states `Dashboard complete.` / `From blank to ready.`
- **Closing:** `end.png` visibly has the blue selection frame and the `Star on GitHub` CTA. The sampled end card also visibly contains `github.com/jangtrinh/design-os-studio` and the music credit.
- **Orange pill/headline:** scene cards use the orange pill and short progressive headlines; all card images remain `1280x720`.
- **Reference comparison:** compare image exists and contact sheet covers intro, six steps, reveal/end progression. Reference file previously measured H.264/AAC, 1280x720, 30 fps, 30.336s, SHA-256 `a7014b242aca885b221fc6f1a8d93199176dcf4797b03f9af17b20a23ebafa95`.

### URL and approval gates

- End card displays the short text `github.com/jangtrinh/design-os-studio`, plus `Star on GitHub`.
- The required **full URL** `https://github.com/jangtrinh/design-os-studio` is not visibly present on the end-card bitmap or sampled contact frame. The `https://` scheme is absent from the displayed CTA.
- No explicit `CLAUDE_APPROVED` receipt, marker, or approval artifact found under `campaigns/design-os-studio-launch` or `plans/growth-lead-20261102`. Existing draft metadata remains `CONTENT_PENDING_CLAUDE` / approval required; that is not approval evidence.

## Decision

Status: **FAIL**

Summary: v4 fixes the prior v3 mux defect. It contains a continuous 29.0s video stream with 30.23s container duration, H.264/AAC media, intro/hook, six-step Studio making story, reveal, closing selection frame, orange pill/headline cards, contact sheet, compare evidence, and `Star on GitHub` CTA. Scene source hashes are distinct. It is still not eligible for promotion.

Concerns/Blockers: (1) Full repo URL requirement is unmet on the end card: displayed text omits `https://`; (2) no explicit `CLAUDE_APPROVED` gate evidence; (3) audio outlasts video by about 1.23s, requiring mux/tail review before production use; (4) one prototype only, so no ten-artifact uniqueness/one-to-one post mapping proof; (5) audio commercial-license evidence remains UNKNOWN per README/reference metadata. Keep v2 rejected and v4 prototype-only.
