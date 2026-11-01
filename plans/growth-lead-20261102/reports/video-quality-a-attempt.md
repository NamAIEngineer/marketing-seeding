# Video Quality A attempt — 2026-11-02

## Result

PASS_QUALITY_A_WINDOW_CAPTURE: ten distinct MP4 artifacts produced for `dos-1102-01` through `dos-1102-10`.

## Capture proof

`raw/window-capture.swift` uses ScreenCaptureKit `SCShareableContent` and `SCContentFilter(desktopIndependentWindow:)`; resolved Studio window id `38128`, app `design:os studio`, bundle `os.design.studio`, bounds `160,25,1600x966`. `live-01.mp4` … `live-10.mp4` each log the same target and decode as Studio-only window captures. Three-frame proof grids are under `video/quality-a/proof-grid/`.

## QA

Every artifact was checked with `ffprobe`, `blackdetect`, `freezedetect`, and loudness filter execution. Outputs are H.264/AAC, 1280x720, 30 fps, 4.4 s, with unique SHA-256 values in `quality-a.json`. One-to-one post mapping and thumbnails are recorded there.

## Limitation

The supplied reference audio was reused to match the requested musical profile and its visible credit. Separate commercial-license evidence was not retrieved; this remains UNKNOWN. Quality-B files remain preserved; the canonical `video-manifest.json` now points to the replacement quality-A artifacts.

## Integration

- Manifest artifact rows `growth-20261102-01` through `growth-20261102-10` now
  point to the ten ScreenCaptureKit files under `video/quality-a/artifacts/`.
- The first ten drafts now carry the matching quality-A path, hash, thumbnail,
  proof grid, source window and QA fields. The previous quality-B files remain
  on disk and are not deleted.
- Fresh checks: all ten disk hashes match the receipt; all hashes are unique;
  ffprobe reports H.264/AAC, 1280x720, 30/1 fps, 4.4 seconds; thumbnails and
  proof grids exist for every post.

Status: DONE_WITH_CONCERNS
