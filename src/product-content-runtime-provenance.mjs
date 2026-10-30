/**
 * Immutable public artifacts used by the optional content-runtime bootstrap.
 *
 * These values are deliberately explicit.  They came from the official
 * Astral python-build-standalone release, Google's Chrome for Testing
 * known-good metadata, and the PyPI imageio-ffmpeg wheel on 2026-10-30.  A release must update the values and
 * the accompanying source audit together; user-writable metadata is never a
 * source of trust.
 */
export const CONTENT_RUNTIME_PROVENANCE_VERSION = 1;

const DARWIN_ARM64 = Object.freeze({
  platform: 'darwin',
  arch: 'arm64',
  python: Object.freeze({
    version: '3.12.15',
    release: '20261013',
    archiveType: 'tar.gz',
    url: 'https://releases.astral.sh/github/python-build-standalone/releases/download/20261013/cpython-3.12.15%2B20261013-aarch64-apple-darwin-install_only_stripped.tar.gz',
    source: 'Astral python-build-standalone GitHub release 20261013',
    sha256: '9866e11cf2ae9caa1e671383786f248859a52dd8bfb702fb4c0dc2c65f1d36de',
    executable: 'python/bin/python3.12',
    executableSha256: '3274dde21f9767655564d093e63c9a5faacefbf1d41bc1e6bf8b6f6e5a441903',
  }),
  chrome: Object.freeze({
    version: '156.0.8078.80',
    archiveType: 'zip',
    url: 'https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.80/mac-arm64/chrome-mac-arm64.zip',
    metadataUrl: 'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json',
    source: 'Google Chrome for Testing known-good version metadata',
    sha256: '8bc590d1b1acac042a000234c768f31830f25a3983a83ed5e067114c87c4cad1',
    executable: 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    executableSha256: 'c6279ef2230d17c6007ea1dc5342b67b0e6b0860741392de8eb0306aaeced292',
  }),
  ffmpeg: Object.freeze({
    version: '7.1',
    package: 'imageio-ffmpeg==0.6.0',
    archiveType: 'zip',
    url: 'https://files.pythonhosted.org/packages/40/5c/f3d8a657d362cc93b81aab8feda487317da5b5d31c0e1fdfd5e986e55d17/imageio_ffmpeg-0.6.0-py3-none-macosx_11_0_arm64.whl',
    metadataUrl: 'https://pypi.org/pypi/imageio-ffmpeg/0.6.0/json',
    source: 'PyPI imageio-ffmpeg 0.6.0 macOS arm64 wheel; bundled FFmpeg 7.1',
    sha256: 'b1ae3173414b5fc5f538a726c4e48ea97edc0d2cdc11f103afee655c463fa742',
    executable: 'imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1',
    executableSha256: '6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617',
    license: 'BSD-2-Clause wrapper; bundled FFmpeg built with GPL components; final GPL/LGPL classification requires component review',
    licenseReviewStatus: 'GPL_CLASSIFICATION_REVIEW_REQUIRED',
    licenseUrl: 'https://ffmpeg.org/legal.html',
    sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz',
    x264SourceUrl: 'https://code.videolan.org/videolan/x264',
    sourceOfferStatus: 'SOURCE_CORRESPONDENCE_REVIEW_REQUIRED',
    packageSourceUrl: 'https://github.com/imageio/imageio-ffmpeg/tree/ae47d8028c237ca5507ceef1b843ee427b442887',
    packageSourceCommit: 'ae47d8028c237ca5507ceef1b843ee427b442887',
    binarySourceUrl: 'https://github.com/imageio/imageio-binaries/raw/f8f64710ea88e7e4a352c0f7d8c0deac9f5fd685/ffmpeg/ffmpeg-macos-aarch64-v7.1',
    binarySourceCommit: 'f8f64710ea88e7e4a352c0f7d8c0deac9f5fd685',
    binarySourceStatus: 'PREBUILT_BLOB_NO_BUILD_SOURCES',
    // Captured from the pinned executable with `ffmpeg -buildconf`. This is
    // provenance only: it does not prove that corresponding source, patches,
    // compiler inputs, or an offer are available to recipients.
    buildFlags: Object.freeze([
      '--prefix=/Volumes/tempdisk/sw',
      '--extra-cflags=-fno-stack-check',
      '--arch=arm64',
      '--cc=/usr/bin/clang',
      '--enable-gpl',
      '--enable-libvmaf',
      '--enable-libopenjpeg',
      '--enable-libopus',
      '--enable-libmp3lame',
      '--enable-libx264',
      '--enable-libx265',
      '--enable-libvpx',
      '--enable-libwebp',
      '--enable-libass',
      '--enable-libfreetype',
      '--enable-fontconfig',
      '--enable-libtheora',
      '--enable-libvorbis',
      '--enable-libsnappy',
      '--enable-libaom',
      '--enable-libvidstab',
      '--enable-libzimg',
      '--enable-libsvtav1',
      '--enable-libharfbuzz',
      '--enable-libkvazaar',
      '--pkg-config-flags=--static',
      '--enable-ffplay',
      '--enable-postproc',
      '--enable-neon',
      '--enable-runtime-cpudetect',
      '--disable-indev=qtkit',
      '--disable-indev=x11grab_xcb',
    ]),
    // The URLs are stable upstream references, not corresponding-source
    // delivery. `reviewStatus` intentionally remains unresolved until exact
    // source revisions, patches, and build inputs are mirrored or a valid
    // release-specific written offer is published.
    externalLibraries: Object.freeze([
      { name: 'libvmaf', configureFlag: '--enable-libvmaf', license: 'BSD-2-Clause', sourceUrl: 'https://github.com/Netflix/vmaf', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libopenjpeg', configureFlag: '--enable-libopenjpeg', license: 'BSD-2-Clause', sourceUrl: 'https://github.com/uclouvain/openjpeg', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libopus', configureFlag: '--enable-libopus', license: 'BSD-3-Clause', sourceUrl: 'https://gitlab.xiph.org/xiph/opus', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libmp3lame', configureFlag: '--enable-libmp3lame', license: 'LGPL-2.0-or-later', sourceUrl: 'https://sourceforge.net/projects/lame/files/lame/', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libx264', configureFlag: '--enable-libx264', license: 'GPL-2.0-or-later', sourceUrl: 'https://code.videolan.org/videolan/x264', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libx265', configureFlag: '--enable-libx265', license: 'GPL-2.0-or-later', sourceUrl: 'https://bitbucket.org/multicoreware/x265_git', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libvpx', configureFlag: '--enable-libvpx', license: 'BSD-3-Clause', sourceUrl: 'https://chromium.googlesource.com/webm/libvpx/', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libwebp', configureFlag: '--enable-libwebp', license: 'BSD-3-Clause', sourceUrl: 'https://chromium.googlesource.com/webm/libwebp', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libass', configureFlag: '--enable-libass', license: 'ISC', sourceUrl: 'https://github.com/libass/libass', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libfreetype', configureFlag: '--enable-libfreetype', license: 'FTL-or-GPL-2.0-or-later', sourceUrl: 'https://gitlab.freedesktop.org/freetype/freetype', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'fontconfig', configureFlag: '--enable-fontconfig', license: 'MIT', sourceUrl: 'https://gitlab.freedesktop.org/fontconfig/fontconfig', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libtheora', configureFlag: '--enable-libtheora', license: 'BSD-3-Clause', sourceUrl: 'https://gitlab.xiph.org/xiph/theora', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libvorbis', configureFlag: '--enable-libvorbis', license: 'BSD-3-Clause', sourceUrl: 'https://gitlab.xiph.org/xiph/vorbis', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libsnappy', configureFlag: '--enable-libsnappy', license: 'BSD-3-Clause', sourceUrl: 'https://github.com/google/snappy', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libaom', configureFlag: '--enable-libaom', license: 'BSD-2-Clause', sourceUrl: 'https://aomedia.googlesource.com/aom/', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libvidstab', configureFlag: '--enable-libvidstab', license: 'GPL-2.0-or-later', sourceUrl: 'https://github.com/georgmartius/vid.stab', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libzimg', configureFlag: '--enable-libzimg', license: 'WTFPL-2.0', sourceUrl: 'https://github.com/sekontor37/zimg', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libsvtav1', configureFlag: '--enable-libsvtav1', license: 'BSD-2-Clause', sourceUrl: 'https://gitlab.com/AOMediaCodec/SVT-AV1', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libharfbuzz', configureFlag: '--enable-libharfbuzz', license: 'MIT', sourceUrl: 'https://github.com/harfbuzz/harfbuzz', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
      { name: 'libkvazaar', configureFlag: '--enable-libkvazaar', license: 'GPL-2.0-or-later', sourceUrl: 'https://github.com/ultravideo/kvazaar', reviewStatus: 'UNPINNED_UPSTREAM_REFERENCE' },
    ]),
    noticeFiles: Object.freeze([
      'THIRD-PARTY-NOTICES.md',
      'FFmpeg-DISTRIBUTION.md',
      'FFmpeg-SOURCE-OFFER.md',
      'FFmpeg-LIBRARY-INVENTORY.md',
      'FFmpeg-LICENSE.md',
      'FFmpeg-COPYING.GPLv2',
      'FFmpeg-COPYING.LGPLv2.1',
      'x264-COPYING',
      'imageio-ffmpeg-LICENSE.md',
    ]),
  }),
});

export const CONTENT_RUNTIME_PROVENANCE = Object.freeze({
  'darwin-arm64': DARWIN_ARM64,
});

export function contentRuntimePlatformKey({ platform = process.platform, arch = process.arch } = {}) {
  return `${platform}-${arch}`;
}

export function getContentRuntimeProvenance({ platform = process.platform, arch = process.arch } = {}) {
  return CONTENT_RUNTIME_PROVENANCE[contentRuntimePlatformKey({ platform, arch })] || null;
}

