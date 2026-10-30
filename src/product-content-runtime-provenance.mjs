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
    license: 'BSD-2-Clause package; bundled FFmpeg GPL-3.0-or-later build',
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

