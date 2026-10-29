# Product to content pipeline

`src/product-content-pipeline.mjs` is a local, side-effect-free adapter for the core app. It performs four bounded stages:

1. Read local source snapshots (fixture mode) or call the checked-in Crawl4AI and nodriver workers (local/production mode).
2. Hash source bytes and derive sentence-level claims. Every claim carries an `evidenceRefs` ID.
3. Generate draft copy per requested channel. Copy contains no fabricated metrics, permalink, or performance result.
4. Verify a product asset, then render a real H.264 MP4 with local `ffmpeg`.

The pipeline never publishes, opens a browser, or writes outside `outputDir`. Output files use mode `0600`; temporary fixture repositories are caller-owned.

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
