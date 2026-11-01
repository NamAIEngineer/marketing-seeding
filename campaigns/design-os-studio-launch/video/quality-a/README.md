# Quality A video factory

Status: PASS_QUALITY_A_WINDOW_CAPTURE (10 artifacts)

The capture target is the actual DESIGN:OS Studio window (`SCWindow` id 38128, bundle `os.design.studio`, bounds 160,25,1600x966) selected with ScreenCaptureKit `SCContentFilter(desktopIndependentWindow:)`. This avoids Claude/Orca windows covering the physical display. Each live capture was normalized to exact 30 fps, placed in the measured 1280x720 reference frame, and checked at three decoded frames for Studio-only dark chrome/canvas content.

Artifacts, hashes, QA outputs, proof grids, thumbnails, dimensions, codecs, duration, source window, and one-to-one post mapping are in `quality-a.json`. Existing quality-B variants were preserved. Audio uses the supplied reference excerpt and retains its visible `Music: Edge of Motion by Aetheric (freetouse.com)` credit; independent commercial-license evidence is UNKNOWN.
