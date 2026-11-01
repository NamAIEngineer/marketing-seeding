# Video quality-A replacement attempt

## Acceptance IDs addressed

`A8`, `V6` — inspect the reference, attempt ten distinct quality-A captures,
preserve evidence, and fail closed when the capture target is unavailable.

## Outcome

`BLOCKED_CAPTURE_TARGET_UNAVAILABLE`. The requested ten quality-A replacements were not fabricated or promoted. The reference template and audio measurements are recorded at `campaigns/design-os-studio-launch/video/quality-a/template-spec.json`; quality-A artifact metadata is explicitly empty in `campaigns/design-os-studio-launch/video/quality-a/quality-a.json`.

## Evidence

- Reference: SHA-256 `a7014b242aca885b221fc6f1a8d93199176dcf4797b03f9af17b20a23ebafa95`; 1280x720; 30 fps; 30.336 s; H.264/AAC; mean audio `-15.1 dB`; max `-0.5 dB`.
- Proof grid: `campaigns/design-os-studio-launch/video/quality-a/reference-proof-grid.png`.
- Feature frame: `campaigns/design-os-studio-launch/video/quality-a/reference-feature-frame.png`.
- Screen-capture probe: `raw/foreground-check.mp4` decoded to 1920x1080, 30 fps, 1.966668 s; frame `raw/foreground-check.jpg` visibly shows Claude desktop. Device 1 test similarly showed Orca desktop. Device 0/1 are physical displays; Design OS Studio is visible only in isolated computer-use surface.
- No quality-B artifact or manifest was overwritten.

## Confidence

`confident` for the blocker: the decoded proof frames identify the physical
display contents. The Design OS Studio window itself remains unavailable to the
physical capture devices.

## Out of scope noticed

No account login, credential read, publication, upload, group join, reply, or
runtime state mutation was performed.

## Status

Status: BLOCKED
