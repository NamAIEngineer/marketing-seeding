# FFmpeg 7.1 distribution record

This document travels with the Marketing Seeding runnable macOS package. It
records the managed media executable and the source/license information needed
for a release review.

## Managed artifact

- Python package: `imageio-ffmpeg==0.6.0` (BSD-2-Clause package)
- Wheel URL:
  <https://files.pythonhosted.org/packages/40/5c/f3d8a657d362cc93b81aab8feda487317da5b5d31c0e1fdfd5e986e55d17/imageio_ffmpeg-0.6.0-py3-none-macosx_11_0_arm64.whl>
- PyPI metadata: <https://pypi.org/pypi/imageio-ffmpeg/0.6.0/json>
- Wheel SHA-256:
  `b1ae3173414b5fc5f538a726c4e48ea97edc0d2cdc11f103afee655c463fa742`
- Executable member:
  `imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`
- FFmpeg version: `7.1`
- Executable SHA-256:
  `6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617`
- Observed configure flags (complete output normalized into one flag per line):
  `--prefix=/Volumes/tempdisk/sw`, `--extra-cflags=-fno-stack-check`,
  `--arch=arm64`, `--cc=/usr/bin/clang`, `--enable-gpl`, `--enable-libvmaf`,
  `--enable-libopenjpeg`, `--enable-libopus`, `--enable-libmp3lame`,
  `--enable-libx264`, `--enable-libx265`, `--enable-libvpx`, `--enable-libwebp`,
  `--enable-libass`, `--enable-libfreetype`, `--enable-fontconfig`,
  `--enable-libtheora`, `--enable-libvorbis`, `--enable-libsnappy`,
  `--enable-libaom`, `--enable-libvidstab`, `--enable-libzimg`,
  `--enable-libsvtav1`, `--enable-libharfbuzz`, `--enable-libkvazaar`,
  `--pkg-config-flags=--static`, `--enable-ffplay`, `--enable-postproc`,
  `--enable-neon`, `--enable-runtime-cpudetect`, `--disable-indev=qtkit`,
  `--disable-indev=x11grab_xcb`.

The executable is staged only after archive and executable hash checks. A
wrong hash or version fails closed before media rendering.

## License conclusion

FFmpeg's official legal guidance states that most FFmpeg code is LGPL-2.1-or-
later, while `--enable-gpl` activates GPL components and changes the resulting
binary's license to GPL-2-or-later. The observed executable includes
`libx264`, `libx265`, `libvidstab`, and `libkvazaar`, plus the other libraries
listed in `FFmpeg-LIBRARY-INVENTORY.md`. FFmpeg's official legal page identifies
the x264/x265 family as GPL-compatible; the executable therefore requires GPL
notices and corresponding-source handling for every enabled component. The
Python `imageio-ffmpeg` wrapper remains BSD-2-Clause; that wrapper license does
not change the FFmpeg executable's copyleft obligations.

Relevant texts are included in this directory:

- `FFmpeg-LICENSE.md`
- `FFmpeg-COPYING.GPLv2`
- `FFmpeg-COPYING.LGPLv2.1`
- `x264-COPYING`
- `FFmpeg-LIBRARY-INVENTORY.md` — every enabled external library and its
  upstream reference. All exact source revisions remain review-required.

This package does not claim that MP4/H.264 patent rights are granted by these
software licenses. Patent and codec distribution review remains the release
owner's responsibility.

## Official source links

- FFmpeg legal page: <https://ffmpeg.org/legal.html>
- FFmpeg 7.1 source archive: <https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz>
- FFmpeg 7.1 source tag: <https://git.ffmpeg.org/ffmpeg.git/tag/?h=n7.1>
- x264 project: <https://code.videolan.org/videolan/x264>
- x265 project: <https://bitbucket.org/multicoreware/x265_git>
- x264 stable source archive: <https://code.videolan.org/videolan/x264/-/archive/stable/x264-stable.tar.gz>
- imageio-ffmpeg source: <https://github.com/imageio/imageio-ffmpeg>
- GPLv2 text: <https://www.gnu.org/licenses/old-licenses/gpl-2.0.html>

## Source-offer status

The runnable package includes immutable artifact hashes, these official source
references, and the applicable FFmpeg/x264 license texts. The full configure
flags and external-library inventory are now recorded, but the links identify
upstream projects only; they are not evidence that this checkout has mirrored
the exact source trees, source revisions, patches, compiler inputs, or build
scripts used to produce the wheel's executable. Before a commercial or signed public release, the release owner
must either:

1. publish or mirror the complete corresponding FFmpeg/x264 source and build
   scripts at a stable URL distributed with the package; or
2. publish a release-specific written offer, valid for at least three years,
   describing how recipients can obtain that complete corresponding source.

Until one of those actions is completed and reviewed, this artifact remains a
runnable/internal package. The app and CI intentionally preserve this
fail-closed release status.
