# Third-party notices

Session D uses two pinned Python source checkouts:

- **Crawl4AI** `v0.9.5` at `838869bdda93f25e6d50b3f50ae9577d9b19a586`, Apache-2.0. The distribution must retain the UncleCode/Crawl4AI attribution and Apache notice.
- **nodriver** at `0233da5bfbe98dc58341f0863526b6315a97e646`, AGPL-3.0. The worker uses a separate subprocess and temporary public-read Chrome profile. That process boundary does not decide the AGPL obligations for a selected distribution or service model.

The complete source license texts remain in the pinned reference checkouts recorded in [source-audit.md](source-audit.md). The exact installed package revisions and runtime pins are recorded in [python-dependencies.lock](python-dependencies.lock). Review distribution obligations before packaging nodriver into a product release.

The managed macOS arm64 media backend uses the public PyPI
`imageio-ffmpeg==0.6.0` wheel. Checked-in provenance records its immutable
wheel URL and SHA-256
`b1ae3173414b5fc5f538a726c4e48ea97edc0d2cdc11f103afee655c463fa742`; the
bundled `ffmpeg-macos-aarch64-v7.1` executable is pinned to SHA-256
`6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617`.
The package is BSD-2-Clause; this wheel's FFmpeg build enables GPL components
including libx264, so its FFmpeg distribution is GPL-3.0-or-later. Preserve
the package and FFmpeg license texts when redistributing the managed backend.
Metadata source: <https://pypi.org/pypi/imageio-ffmpeg/0.6.0/json>.
