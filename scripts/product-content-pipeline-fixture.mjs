#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProductContentPipeline } from '../src/product-content-pipeline.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'marketing-seeding-pipeline-fixture-'));
await fs.mkdir(path.join(root, 'research'), { recursive: true });
await fs.mkdir(path.join(root, 'assets'), { recursive: true });
await fs.writeFile(path.join(root, 'research', 'product.html'), `<!doctype html><html><head><title>Fixture Product</title></head><body><article><h1>Bounded local product pipeline</h1><p>The pipeline grounds copy in verified local source evidence.</p><p>It renders a playable MP4 from a checked product asset.</p></article></body></html>`);
await fs.writeFile(path.join(root, 'assets', 'product.ppm'), 'P3\n2 2\n255\n255 40 40 40 255 40 40 40 255 255 255 40\n');
const outputDir = path.join(root, 'out');
const result = await runProductContentPipeline({
  mode: 'FIXTURE',
  runId: 'fixture-run-01',
  outputDir,
  product: { id: 'fixture-product', name: 'Fixture Product', repositoryPath: root },
  campaign: { id: 'fixture-campaign', name: 'Fixture Campaign', callToAction: 'Read the evidence.' },
  sources: [{ path: 'research/product.html', label: 'Product fixture' }],
  assets: [{ path: 'assets/product.ppm', name: 'Product tile' }],
  targets: [{ id: 'linkedin-fixture', channel: 'linkedin' }, { id: 'x-fixture', channel: 'x' }],
});
console.log(JSON.stringify({
  status: result.status,
  runId: result.runId || null,
  reportPath: result.reportPath,
  copyPaths: result.copyPaths,
  mp4Path: result.mp4Path,
  evidenceCount: result.evidence?.length || 0,
  media: result.media ? { bytes: result.media.bytes, sha256: result.media.sha256, durationSeconds: result.media.durationSeconds } : null,
  failure: result.failure || null,
}, null, 2));
if (result.status !== 'SUCCEEDED') process.exitCode = 1;
