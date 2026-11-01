# FFmpeg source availability offer

This file is included in the Marketing Seeding package so recipients can find
the source and license record for the managed FFmpeg 7.1 executable. It is a
source-availability record, not a written offer and not a claim that the
current unsigned internal artifact is a commercial release.

Exact artifact identity:

- `imageio-ffmpeg==0.6.0`
- wheel SHA-256:
  `b1ae3173414b5fc5f538a726c4e48ea97edc0d2cdc11f103afee655c463fa742`
- executable SHA-256:
  `6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617`

The complete observed configure flags and enabled-library inventory are in
[`FFmpeg-LIBRARY-INVENTORY.md`](FFmpeg-LIBRARY-INVENTORY.md). The inventory
contains upstream references only; exact revisions and corresponding source
for this executable have not been recovered.

## What the upstream trace proves

The wheel member is byte-identical to the `imageio-binaries` prebuilt blob at
commit `f8f64710ea88e7e4a352c0f7d8c0deac9f5fd685`:

<https://github.com/imageio/imageio-binaries/raw/f8f64710ea88e7e4a352c0f7d8c0deac9f5fd685/ffmpeg/ffmpeg-macos-aarch64-v7.1>

The Python wrapper is pinned to `imageio-ffmpeg` `v0.6.0` at commit
`ae47d8028c237ca5507ceef1b843ee427b442887`:

<https://github.com/imageio/imageio-ffmpeg/tree/ae47d8028c237ca5507ceef1b843ee427b442887>

The wrapper release copies the prebuilt blob; the traced repositories do not
contain the exact FFmpeg/dependency source trees, configure/build scripts,
compiler inputs or patches. Reproducible blob identity is therefore proven,
but corresponding source is not.

Upstream source locations:

- FFmpeg 7.1: <https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz>
- FFmpeg source tag: <https://git.ffmpeg.org/ffmpeg.git/tag/?h=n7.1>
- x264 source: <https://code.videolan.org/videolan/x264>
- x264 stable archive: <https://code.videolan.org/videolan/x264/-/archive/stable/x264-stable.tar.gz>
- imageio-ffmpeg packaging source: <https://github.com/imageio/imageio-ffmpeg>

The release owner must keep the complete corresponding source, every applied
patch, compiler/build inputs, and build/install scripts available for at least
three years after a commercial/public binary release. A valid written offer
would need a release-specific URL, contact/procedure, exact artifact identity,
and a minimum three-year validity period. This file has no such offer URL or
contact procedure. The current package deliberately retains a
`SOURCE_CORRESPONDENCE_REVIEW_REQUIRED` blocker and must not be described as a
completed GPL-compliant commercial release. The additional
`PREBUILT_BLOB_NO_BUILD_SOURCES` and `GPL_CLASSIFICATION_REVIEW_REQUIRED`
statuses remain release blockers; this checklist is not a written offer and
does not satisfy corresponding-source requirements.
