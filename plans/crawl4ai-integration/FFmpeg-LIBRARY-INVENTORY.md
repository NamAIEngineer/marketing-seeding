# FFmpeg 7.1 external-library inventory

This inventory is derived from `ffmpeg-macos-aarch64-v7.1 -buildconf` in the
pinned `imageio-ffmpeg==0.6.0` arm64 wheel. It is a provenance record, not a
corresponding-source package. Every row remains `REVIEW_REQUIRED` until the
exact source revision/archive hash, patches, build inputs and applicable
license text used for this executable are recovered and published.

| Configure flag | Library | Upstream source reference | License review |
| --- | --- | --- | --- |
| `--enable-libvmaf` | libvmaf | <https://github.com/Netflix/vmaf> | REVIEW_REQUIRED |
| `--enable-libopenjpeg` | OpenJPEG | <https://github.com/uclouvain/openjpeg> | REVIEW_REQUIRED |
| `--enable-libopus` | Opus | <https://gitlab.xiph.org/xiph/opus> | REVIEW_REQUIRED |
| `--enable-libmp3lame` | LAME | <https://sourceforge.net/projects/lame/files/lame/> | REVIEW_REQUIRED |
| `--enable-libx264` | x264 | <https://code.videolan.org/videolan/x264> | GPL-2.0-or-later reference; exact revision REVIEW_REQUIRED |
| `--enable-libx265` | x265 | <https://bitbucket.org/multicoreware/x265_git> | GPL-2.0-or-later reference; exact revision REVIEW_REQUIRED |
| `--enable-libvpx` | libvpx | <https://chromium.googlesource.com/webm/libvpx/> | REVIEW_REQUIRED |
| `--enable-libwebp` | libwebp | <https://chromium.googlesource.com/webm/libwebp> | REVIEW_REQUIRED |
| `--enable-libass` | libass | <https://github.com/libass/libass> | REVIEW_REQUIRED |
| `--enable-libfreetype` | FreeType | <https://gitlab.freedesktop.org/freetype/freetype> | REVIEW_REQUIRED |
| `--enable-fontconfig` | fontconfig | <https://gitlab.freedesktop.org/fontconfig/fontconfig> | REVIEW_REQUIRED |
| `--enable-libtheora` | Theora | <https://gitlab.xiph.org/xiph/theora> | REVIEW_REQUIRED |
| `--enable-libvorbis` | Vorbis | <https://gitlab.xiph.org/xiph/vorbis> | REVIEW_REQUIRED |
| `--enable-libsnappy` | Snappy | <https://github.com/google/snappy> | REVIEW_REQUIRED |
| `--enable-libaom` | libaom | <https://aomedia.googlesource.com/aom/> | REVIEW_REQUIRED |
| `--enable-libvidstab` | vid.stab | <https://github.com/georgmartius/vid.stab> | REVIEW_REQUIRED |
| `--enable-libzimg` | zimg | <https://github.com/sekontor37/zimg> | REVIEW_REQUIRED |
| `--enable-libsvtav1` | SVT-AV1 | <https://gitlab.com/AOMediaCodec/SVT-AV1> | REVIEW_REQUIRED |
| `--enable-libharfbuzz` | HarfBuzz | <https://github.com/harfbuzz/harfbuzz> | REVIEW_REQUIRED |
| `--enable-libkvazaar` | Kvazaar | <https://github.com/ultravideo/kvazaar> | GPL-2.0-or-later reference; exact revision REVIEW_REQUIRED |

The executable also reports `--enable-gpl`, `--enable-ffplay`, and
`--enable-postproc`; those are FFmpeg configuration features and are covered by
the FFmpeg GPL/LGPL texts shipped beside this file. `--enable-libx265` and
`--enable-libkvazaar` were absent from the previous notice and are now called
out explicitly. No row constitutes a claim that the generic upstream URL is
the corresponding source for this wheel.
