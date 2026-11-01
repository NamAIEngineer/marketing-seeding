# MISSION 18 / MISSION 16 v3 prototype QA receipt — 2026-11-02

Scope: read-only QA of the existing v3 prototype against `campaigns/design-os-studio-launch/reference/manual-posts-nam-gold-standard.md`, the available MISSION 16 task contract (`plans/growth-lead-20261102/video-task.md`), and the existing draft approval gate. No source, manifest, draft, status, decision, or production media was edited. v2 remains rejected and unpromoted.

## Inputs

- Gold standard: `campaigns/design-os-studio-launch/reference/manual-posts-nam-gold-standard.md`
- MISSION 16 task contract available as: `plans/growth-lead-20261102/video-task.md`; no standalone `MISSION 16` file or `CLAUDE_APPROVED` receipt was found in the workspace.
- Prototype README: `campaigns/design-os-studio-launch/video/quality-a/v3-prototype/README.md`
- Prototype MP4: `campaigns/design-os-studio-launch/video/quality-a/v3-prototype/v3-prototype-dos-1102-01.mp4`
- Prototype evidence: `v3-prototype/proof/proof-grid.png`, `v3-prototype/compare/prototype-vs-reference.png`, `v3-prototype/cards/`, `v3-prototype/scenes/`

## Bounded checks

- Prototype file exists. SHA-256: `94ef93982c597d67d5b4ea99c5d4e0a48171229812b7c4fb8f52ef63fc8b3d1d`.
- `ffprobe` reports H.264/AAC, 1280×720, 30 fps container, format duration `15.400000` s, AAC 48 kHz stereo.
- **Blocking media defect:** video stream duration is only `2.200000` s (`66` frames); audio stream duration is `15.400000` s. Seeking at 4–14.8s cannot extract video frames. The prototype therefore does not contain a 15.4s continuous video story despite the container format duration.
- Scene source clips exist: five `scene-0N.mp4` clips, each 960×540 H.264, 30 fps, 2.2s; intro/end clips each 1280×720 H.264, 30 fps, 2.2s. The muxed prototype does not retain the complete sequence in its video stream.
- Evidence files exist: proof grid `1440×135` and comparison image `640×480`. Existing proof image visibly shows intro selection frame only; it does not prove a complete 30–40s assembled film.
- Cards are present for five scene tracks (`s01`–`s05`, 33 frames each, 1280×720). Visual samples show orange pill, short headline, blue selection frame, and Studio UI area. Several sampled cards are blank before progressive text reveal; richer per-feature UI interaction is not proven by the static cards.
- Gold-standard alignment: opening selection frame present in prototype evidence; orange pill + 1–2-word headline pattern present in sampled cards; real Studio crop/zoom is described and scene source clips are present. Closing selection frame/full repository URL/`Star on GitHub` CTA are **not proven** by the available prototype proof grid/cards. README says intro/end cards retained, but no `CLAUDE_APPROVED` review receipt exists.
- Required duration is 30–40s per MISSION 18 and task instruction. Current prototype fails this requirement at both container/video-stream level.
- No `CLAUDE_APPROVED` marker, receipt, or approval file found under campaign/plans paths. Draft gate remains `CONTENT_PENDING_CLAUDE`; `MISSION_16_V3_APPROVED` is a required gate value in draft metadata, not evidence of approval.

## Gate decision

Status: **FAIL — PROTOTYPE_ONLY / CLAUDE_APPROVED MISSING**

Summary: Existing v3 prototype is the only candidate reviewed. It partially follows the gold-standard visual language, but the muxed MP4 contains only 2.2s of video followed by 15.4s audio, so it cannot satisfy the required 30–40s product-making story. Complete closing frame, full repo URL, and `Star on GitHub` CTA are not independently evidenced. No Claude approval gate exists.

Concerns/Blockers: Rebuild/mux v3 with the full intro + five real Studio crop/zoom scenes + closing selection/end card into a continuous 30–40s video stream; provide proof grid including opening, all scenes, and closing; show full `https://github.com/jangtrinh/design-os-studio` plus `Star on GitHub`; obtain and record explicit `CLAUDE_APPROVED`. Do not promote this prototype or revive v2.
