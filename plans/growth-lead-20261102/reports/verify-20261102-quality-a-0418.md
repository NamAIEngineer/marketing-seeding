# Quality-A delivery verification — 2026-11-02 04:18 ICT

Status: `PASS_WITH_LIMITATIONS`

## Scope

Read-only audit of `campaigns/design-os-studio-launch/video/quality-a/quality-a.json`, its 10 MP4 artifacts, 10 thumbnails, 10 proof grids, and draft ID/channel mapping. No source or campaign artifact edits performed by this verifier.

## FACT

- Receipt status: `PASS_QUALITY_A_WINDOW_CAPTURE`; quality `A`; 10 artifacts listed.
- Capture source: ScreenCaptureKit `desktopIndependentWindow`; window ID `38128`; app `design:os studio`; bundle `os.design.studio`; bounds `160,25,1600x966`. This is a DESIGN:OS Studio window identifier, not Claude/Orca.
- All 10 declared MP4 paths exist. SHA-256 recomputation matched each declared digest. Hashes are pairwise unique (`10/10`).
- All 10 files independently report H.264 video, AAC audio, 1280x720, 30/1 fps via `ffprobe`.
- Receipt records all 10 QA blocks as `ffprobe=PASS`, `blackdetect=PASS_NO_BLACK_FRAMES`, `freezedetect=PASS_FREEZE_REVIEW`, and `loudness=PASS_EBUR128`.
- All 10 declared thumbnails and all 10 proof grids exist.
- Each proof grid is a three-frame strip showing the same DESIGN:OS Studio dark chrome/canvas composition. Visual inspection of proof grids (including dos-1102-01, -02, -05, -08, -10) shows the Studio window; no Claude/Orca desktop is visible. The receipt's capture description says each clip is a distinct live window capture.
- All 10 artifact IDs map to an existing draft ID `dos-1102-01` through `dos-1102-10`.
- Artifact channel mapping matches the corresponding draft `channel` values for all 10 IDs: LinkedIn personal/page and Facebook timeline/page/member group assignments.
- Artifact headlines are present and distinct per receipt; drafts carry distinct `opening`/`videoSlot` values for the same IDs.
- Quality-B variants are explicitly preserved (`qualityBPreserved=true`).

## UNKNOWN / LIMITATIONS

- This verifier did not replay every MP4 frame or independently rerun blackdetect/freeze/loudness; those checks are receipt claims, while codec/dimension/fps/audio and hashes were independently rerun.
- Audio license evidence remains `UNKNOWN` per receipt (`licenseNote`); supplied reference audio credit is retained.
- The quality-A artifact manifest is under `video/quality-a/quality-a.json`. The canonical campaign `video/video-manifest.json` and dashboard projection should be checked separately for integration/route selection; this report does not modify or promote them.
- Artifact content is bounded visual proof of the captured source window. It does not prove live social publication, permalink availability, or account readiness.

## Verdict

`PASS_WITH_LIMITATIONS`: quality-A delivery receipt and all 10 disk artifacts satisfy the requested identity, uniqueness, mapping, thumbnail/proof-grid, and independently checked media-container gates. Keep audio-license and downstream manifest/runtime integration as explicit unknowns until separately verified.
