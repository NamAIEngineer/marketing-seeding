# Video v5 rework receipt — 2026-11-02

Scope: focused bounded v5 rework/verification in the existing video media scope. No drafts, manifests, production status, decisions, or publication state changed. No `CLAUDE_APPROVED` was added.

## Attempt

- Real app process observed: `/Users/nam/Applications/designos.app/Contents/MacOS/designos-studio` (PID 87873).
- Existing ScreenCaptureKit recorder: `campaigns/design-os-studio-launch/video/quality-a/raw/window-capture`.
- Command attempted:

  `campaigns/design-os-studio-launch/video/quality-a/raw/window-capture --app 'design:os studio' --seconds 3 --output /tmp/designos-v5-probe-20261102.mp4`

- Recorder did resolve the real target: `WINDOW id=38128 app=design:os studio bundle=os.design.studio frame=(160.0,25.0,1600.0,966.0) output=1600x966`.
- Recorder returned `CAPTURE_DONE frames=5 status=2` with shell exit `0`.
- Probe output `/tmp/designos-v5-probe-20261102.mp4` is H.264 video only, `1600x966`, `107/4` fps, `0.265000s`, 5 frames; no audio stream. SHA-256 `31f802555e10a90e88f96833fc564b9162ada6d4066756e4decfca6510e1abff`.

## v5 gate result

Status: **BLOCKED — V5_NOT_PRODUCED / PENDING**

Summary: Actual `os.design.studio` target resolution works, but the available capture path fails the requested duration and has no audio. No v5 production artifact was created. Existing v4 remains prototype-only; v2 remains rejected.

Concerns/Blockers:

1. Capture recorder requested 3s but emitted only 0.265s/5 frames; it cannot currently supply six real capture steps at 30–40s duration.
2. Probe has no audio. A/V-aligned v5 requires a separately verified audio mux step with equal stream durations.
3. No v5 directory, 10 unique MP4 outputs, one-to-one mapping, or v5 contact/compare proof exists in the target workspace.
4. Full `https://github.com/jangtrinh/design-os-studio` end-card asset and `Star on GitHub` still need to be rendered into v5; no v5 end card was produced.
5. Supplied reference audio remains credited but independently licensed evidence is absent (`UNKNOWN`); no new license evidence was found in the reference or v4 prototype paths.
6. `CLAUDE_APPROVED` remains absent by design and must be supplied separately before promotion.

Next artifact required: repaired long-running ScreenCaptureKit recorder receipt with stable frame count for the full run; then a v5 assembly receipt proving 30–40s continuous video, equal A/V durations, full HTTPS end card, six-step story, 10 unique hashes/mappings, contact/compare grids, and audio-license evidence. Do not alter draft bindings or manifests until those gates pass.
