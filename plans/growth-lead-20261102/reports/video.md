# W2 video factory evidence — 2026-11-01

## Ledger

- **FACT:** Reference exists at `campaigns/design-os-studio-launch/reference/release-recap-reference.mp4`.
- **FACT:** Reference SHA-256: `a7014b242aca885b221fc6f1a8d93199176dcf4797b03f9af17b20a23ebafa95`.
- **FACT:** Reference probe: H.264 video + AAC audio; 1280x720; 30/1 fps; 30.336 seconds; 1,546,751 bytes; `yuv420p`.
- **FACT:** Ten output MP4s exist under `campaigns/design-os-studio-launch/video/variants/`; SHA-256 values are all unique.
- **FACT:** Ten thumbnail previews exist under `campaigns/design-os-studio-launch/video/thumbnails/`; manifest is `campaigns/design-os-studio-launch/video/video-manifest.json`.
- **FACT:** Bounded ffprobe and ffmpeg checks completed after the final media change. All outputs decode as H.264 + AAC, 30 fps, with valid duration and dimensions; audio integrated loudness measured around -14 LUFS.
- **FACT:** Output generation used local ffmpeg trims/crops/filters from the supplied reference. No external publish, upload, credential use, or runtime/content/community edit occurred.
- **UNKNOWN:** A real `designos-studio` screen capture was not available in this workspace. No output may be described as real screen capture.
- **INFERENCE:** Outputs are distinct, template-derived quality-B temporary artifacts. They satisfy one-to-one hash and aspect-ratio evidence but do not satisfy the brief's preferred real-screen-capture quality-A bar.

## Reference measurement

| Item | Evidence |
|---|---|
| File | `campaigns/design-os-studio-launch/reference/release-recap-reference.mp4` |
| SHA-256 | `a7014b242aca885b221fc6f1a8d93199176dcf4797b03f9af17b20a23ebafa95` |
| Video | H.264, 1280x720, `yuv420p`, 30/1 fps |
| Audio | AAC |
| Duration | 30.336 s |
| Size | 1,546,751 bytes |

## Ten distinct artifacts and one-to-one mapping

The `postId` values are deterministic queue placeholders. A future queued draft must bind exactly one row to exactly one artifact; these files must not be reused across posts.

| Post ID | Artifact | SHA-256 | Dimensions / fps | Duration | Aspect / eligible surface | Preview | QA |
|---|---|---|---|---:|---|---|---|
| growth-20261102-01 | `video/variants/w2-video-01-linkedin-personal.mp4` | `713b735e5dfc8341b680171f0c34955fb5a05d6c468c320427f85b6a44481692` | 1280x720 / 30 | 20.0 s | 16:9 / LinkedIn personal | `video/thumbnails/w2-video-01-linkedin-personal.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-02 | `video/variants/w2-video-02-linkedin-page.mp4` | `797cb56bb8feeab6604d00650a6ff42ca749b98ba56e601d29d947b893a8c64a` | 1280x720 / 30 | 20.0 s | 16:9 / LinkedIn Page | `video/thumbnails/w2-video-02-linkedin-page.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-03 | `video/variants/w2-video-03-facebook-timeline.mp4` | `8d19bb55f8ff14e7cdb429d2edffbf2241b90ce2c5fa5a2f7f541fd0080a6833` | 1280x720 / 30 | 18.0 s | 16:9 / Facebook timeline | `video/thumbnails/w2-video-03-facebook-timeline.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-04 | `video/variants/w2-video-04-facebook-page.mp4` | `00922075b3c407169695ec90af2d4f2c9cc53c6f3f565346f9a57eb5e131bb5d` | 1280x720 / 30 | 20.0 s | 16:9 / Facebook Page | `video/thumbnails/w2-video-04-facebook-page.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-05 | `video/variants/w2-video-05-facebook-group-a.mp4` | `e72b59b9caba7f8b47ed7c44f5feff275a04d2aafbcbc3f029be92405ce2ef90` | 1280x720 / 30 | 20.0 s | 16:9 / Facebook member Group | `video/thumbnails/w2-video-05-facebook-group-a.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-06 | `video/variants/w2-video-06-facebook-group-b.mp4` | `498e3ae834c619a64026e1c9ed79185ebcecd9732db09c4472b892ca80f0ef82` | 1080x1080 / 30 | 20.0 s | 1:1 / Facebook member Group | `video/thumbnails/w2-video-06-facebook-group-b.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-07 | `video/variants/w2-video-07-facebook-group-c.mp4` | `292886e1ce2c79d9eae0a591574c9a5128e5bbf5bdb6b341a76d4d935c749f82` | 1080x1080 / 30 | 20.0 s | 1:1 / Facebook member Group | `video/thumbnails/w2-video-07-facebook-group-c.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-08 | `video/variants/w2-video-08-facebook-group-d.mp4` | `8b1423ee42c43f7ca7927e2fea5fbf0a42c8390e5e90ee53d3d9d9568eb367fa` | 1080x1080 / 30 | 18.0 s | 1:1 / Facebook member Group | `video/thumbnails/w2-video-08-facebook-group-d.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-09 | `video/variants/w2-video-09-linkedin-square.mp4` | `589e095960647f45a22d24a5d3cced7b56fe55507e7c1f7c03d65e905d311a24` | 1080x1350 / 30 | 20.0 s | 4:5 / LinkedIn or Facebook feed | `video/thumbnails/w2-video-09-linkedin-square.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |
| growth-20261102-10 | `video/variants/w2-video-10-facebook-portrait.mp4` | `fdfba104fef9a1fa7978e32b780caceed526973871e52536738b64c037cd482a` | 1080x1350 / 30 | 18.0 s | 4:5 / Facebook feed | `video/thumbnails/w2-video-10-facebook-portrait.jpg` | PASS_BOUNDED_DERIVED_QUALITY_B |

All ten are H.264/AAC, `yuv420p`, 30 fps. Full machine-readable details: `campaigns/design-os-studio-launch/video/video-manifest.json`.

## Exact bounded verification

1. Reference measurement:

   `shasum -a 256 campaigns/design-os-studio-launch/reference/release-recap-reference.mp4` — exit `0`, SHA above.

   `ffprobe -v error -show_entries format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt -of json campaigns/design-os-studio-launch/reference/release-recap-reference.mp4` — exit `0`, reference spec above.

2. Artifact QA:

   `ffprobe -v error -show_entries format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,pix_fmt -of compact=p=0:nk=0 campaigns/design-os-studio-launch/video/variants/*.mp4` (per-file loop) — exit `0` for all 10.

   `ffmpeg -hide_banner -nostats -i <artifact> -vf 'blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.003:d=1' -af 'ebur128=framelog=verbose' -f null -` (per-file loop) — exit `0` for all 10; no blackdetect intervals; integrated loudness approximately `-14.0` to `-14.2 LUFS`. Freeze markers are reported because source footage includes still intervals; this is why outputs remain quality B and are not promoted as real screen capture.

   `sha256sum campaigns/design-os-studio-launch/video/variants/*.mp4` — exit `0`; `files=10 unique_sha256=10`.

Full command output is retained in `campaigns/design-os-studio-launch/video/qa-evidence.txt`.

## Acceptance and limits

- **A8:** `DONE_WITH_CONCERNS`: 10 distinct MP4 artifacts, hashes, dimensions/fps/codecs/durations, QA results, previews, eligible aspect ratios, and one-to-one post mapping are present. Preferred real screen capture is blocked; all artifacts explicitly carry quality `B` and derived-source disclosure.
- **A9:** Video mapping uses only LinkedIn/Facebook surfaces. No paused surface is mapped.
- **V4:** This report ends with the required status line.
- **V5:** No account or publication state is asserted here; publication remains outside this lane.
- **V6:** Reference hash/spec, each output hash/spec, ffprobe/ffmpeg evidence, thumbnail routes, and one-to-one mapping are present.

## Out of scope

Credentials, MFA/CAPTCHA/OTP, uploads, publication, external messaging, deployment, merge, push, runtime/content/community/Overview code, and real screen capture setup.

Status: DONE_WITH_CONCERNS

## 2026-11-02 03:05 ICT reconciliation

- **FACT:** `campaigns/design-os-studio-launch/video/quality-a/quality-a.json`
  records `BLOCKED_CAPTURE_TARGET_UNAVAILABLE` with no promoted artifacts.
- **FACT:** Direct decoded end frames from all ten
  `video/real-captures/*.mov` files show the Claude/Orca desktop. The captures
  are not evidence of a Design OS Studio window.
- **FACT:** The historical manifest still contains ten labels
  `PASS_REAL_SCREEN_CAPTURE_BOUNDED` / `quality=A`; those labels conflict with
  the current intake receipt and are not treated as current QA proof.
- **FACT:** The projection now fails closed when the blocker receipt exists:
  `qaFail=10`, `bufferTomorrow=0`, each artifact `quality=UNVERIFIED` and
  `qa=BLOCKED_CAPTURE_TARGET_UNAVAILABLE`. Files remain available for forensic
  inspection; none were deleted or overwritten.
- **UNKNOWN:** A new Design OS Studio capture run; no quality-A claim is made
  until its target window is directly evidenced.

Status: DONE_WITH_CONCERNS
