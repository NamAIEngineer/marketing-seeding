# Quality-A replacement attempt

Status: **BLOCKED_CAPTURE_TARGET_UNAVAILABLE**.

`ffmpeg -f avfoundation` was verified at 30 fps with cursor capture, but the physical screen devices expose the Claude and Orca desktops. Design OS Studio is visible only through the isolated computer-use app surface and is not present on either avfoundation display device. `raw/foreground-check.jpg` is the decoded proof frame showing the wrong desktop. No quality-A artifact is claimed or placed in `quality-a.json`; prior quality-B variants remain untouched.

Reference geometry, timing, audio levels, and observed music credit are recorded in `template-spec.json`; reference proof images are `reference-proof-grid.png` and `reference-feature-frame.png`.
