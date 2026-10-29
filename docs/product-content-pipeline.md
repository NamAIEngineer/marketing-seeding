# Product to content pipeline

`src/product-content-pipeline.mjs` is a local, side-effect-free adapter for the core app. It performs four bounded stages:

1. Read local source snapshots (fixture mode) or call the checked-in Crawl4AI and nodriver workers (local/production mode).
2. Hash source bytes and derive sentence-level claims. Every claim carries an `evidenceRefs` ID.
3. Generate draft copy per requested channel. Copy contains no fabricated metrics, permalink, or performance result.
4. Verify a product asset, then render a real H.264 MP4 with local `ffmpeg`.

The pipeline never publishes, opens a browser, or writes outside `outputDir`. Output files use mode `0600`; temporary fixture repositories are caller-owned.

## Downloaded-app runtime provisioning

`src/product-content-runtime.mjs` resolves and preflights backend paths before
the pipeline runs. Default storage is per-user (`~/Library/Application
Support/Marketing Seeding/content-runtime/v1` on macOS); app bundles can pass
`resourcesDir` to use staged `python/` and `bin/` resources. Exact overrides:

```text
SEEDING_CONTENT_RUNTIME_ROOT  per-user runtime root
SEEDING_CONTENT_RESOURCES     read-only app resources directory
SEEDING_CONTENT_PYTHON        Python executable (venv or bundled)
SEEDING_CONTENT_FFMPEG        ffmpeg executable (staged or bundled)
SEEDING_CONTENT_PYTHON_BOOTSTRAP  Python used for opt-in repair
SEEDING_CONTENT_LOCK          pinned dependency lock path
SEEDING_CONTENT_NOTICES       third-party notices path
SEEDING_NODRIVER_CHROME       Chrome/Chromium executable for PRODUCTION
```

Worker A startup wiring is one line:

```js
const runtime = await ensureContentRuntime({ mode, storageRoot: appUserDataPath, resourcesDir: process.resourcesPath, repair: false });
```

Pass `runtime.paths` to `runProductContentPipeline` as
`contentRuntimePaths`. For `LOCAL`, Python must import `crawl4ai` and `bs4`;
for `PRODUCTION`, it must also import `nodriver` and a public Chrome/Chromium
binary must answer `--version`; both modes require ffmpeg. A missing backend
returns `RESEARCH_BACKEND_UNAVAILABLE` or `MEDIA_BACKEND_UNAVAILABLE` before
research/media work starts.

The explicit repair path is `repairContentRuntime({ repair: true,
allowNetwork: true })`. It creates the venv in the per-user root and installs
the checked-in `plans/crawl4ai-integration/python-dependencies.lock`; network
installation is blocked unless the caller opts in. The lock SHA-256 is
`be16f50383aab98f74a712257acb89a3c774cedf04412eefc86772a07a721598`; notices
retain Crawl4AI Apache-2.0 and nodriver AGPL-3.0 obligations. Binary staging
requires a caller-supplied exact SHA-256 through `stageVerifiedBinary`.

Read-only preflight command:

```sh
node scripts/content-runtime-preflight.mjs --mode LOCAL
```

Exit `0` means all required backends are verified; exit `2` means unavailable
or blocked. The command never installs or claims success from package metadata.

## API

```js
import { runProductContentPipeline } from './src/product-content-pipeline.mjs';

const result = await runProductContentPipeline({
  mode: 'FIXTURE', // FIXTURE, LOCAL, or PRODUCTION
  runId: 'campaign-run-01',
  outputDir: '/tmp/product-content-run',
  product: { id: 'product-1', name: 'Example', repositoryPath: '/path/to/product' },
  campaign: { id: 'campaign-1', name: 'Launch', callToAction: 'Read the evidence.' },
  sources: [{ path: 'research/product.html', label: 'Product docs' }],
  assets: [{ path: 'media/hero.png', name: 'Hero image' }],
  targets: [{ id: 'linkedin-1', channel: 'linkedin' }],
});
```

Success returns `status: "SUCCEEDED"`, `reportPath`, `copyPaths`, `mp4Path`, `report`, `copies`, `media`, and source `evidence`. `externalSideEffects` is always `false`.

Failure returns `status: "FAILED"` and a typed `failure` object:

```json
{"code":"MEDIA_BACKEND_UNAVAILABLE","stage":"media","message":"..."}
```

Codes include `NO_SOURCE_EVIDENCE`, `RESEARCH_BACKEND_UNAVAILABLE`, `RESEARCH_FAILED`, `REMOTE_SOURCE_BLOCKED`, `ASSET_MISSING`, `ASSET_INVALID`, `MEDIA_BACKEND_UNAVAILABLE`, `MEDIA_RENDER_FAILED`, and `MEDIA_OUTPUT_INVALID`.

## Modes and backends

- `FIXTURE`: local source files only. Does not fabricate remote results. Used for deterministic end-to-end tests.
- `LOCAL`: local source files through `scripts/crawl4ai_extract.py`; returns `RESEARCH_BACKEND_UNAVAILABLE` when Crawl4AI dependencies are absent.
- `PRODUCTION`: public URLs through `scripts/nodriver_fetcher.py`, then Crawl4AI extraction. Login, bot challenge, private destination, and redirect failures remain typed and grounded.

The first asset is rendered to MP4. Supported image inputs are PNG, JPEG, WebP, PPM/PGM, and BMP; video inputs are MP4, MOV, WebM, and M4V. Override the encoder with `ffmpegPath` or `FFMPEG_PATH`, and bound duration with `durationSeconds`.

## Exact fixture proof

```sh
node scripts/product-content-pipeline-fixture.mjs
node --test test/product-content-pipeline.test.mjs
```

The fixture command prints the absolute report, copy, and MP4 paths plus byte count and SHA-256. The focused test checks the MP4 `ftyp` and `moov` boxes, evidence bindings, copy channels, and truthful unavailable-backend behavior.
