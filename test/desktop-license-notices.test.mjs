import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getContentRuntimeProvenance } from '../src/product-content-runtime-provenance.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const noticesRoot = path.join(root, 'plans', 'crawl4ai-integration');

test('FFmpeg distribution notice manifest is present and non-empty', async () => {
  const ffmpeg = getContentRuntimeProvenance({ platform: 'darwin', arch: 'arm64' }).ffmpeg;
  assert.equal(ffmpeg.sourceOfferStatus, 'SOURCE_CORRESPONDENCE_REVIEW_REQUIRED');
  assert.ok(ffmpeg.noticeFiles.length >= 8);
  for (const file of ffmpeg.noticeFiles) {
    const contents = await readFile(path.join(noticesRoot, file), 'utf8');
    assert.ok(contents.trim().length > 0, `${file} must not be empty`);
  }
  assert.match(await readFile(path.join(noticesRoot, 'FFmpeg-LIBRARY-INVENTORY.md'), 'utf8'), /libx265/);
  assert.match(await readFile(path.join(noticesRoot, 'FFmpeg-LIBRARY-INVENTORY.md'), 'utf8'), /libkvazaar/);
});

test('built app and ZIP carry every FFmpeg notice when artifact gate is enabled', async (t) => {
  if (process.env.SEEDING_REQUIRE_DESKTOP_ARTIFACT !== 'true') {
    t.skip('set SEEDING_REQUIRE_DESKTOP_ARTIFACT=true after desktop build');
    return;
  }
  const ffmpeg = getContentRuntimeProvenance({ platform: 'darwin', arch: 'arm64' }).ffmpeg;
  const appRoot = path.join(root, 'desktop', 'dist', 'Marketing Seeding OS.app', 'Contents', 'Resources', 'app', 'plans', 'crawl4ai-integration');
  const zip = path.join(root, 'desktop', 'dist', 'Marketing-Seeding-OS-macOS.zip');
  await access(zip);
  for (const file of ffmpeg.noticeFiles) {
    const installed = await readFile(path.join(appRoot, file), 'utf8');
    assert.ok(installed.trim().length > 0, `app notice ${file} must not be empty`);
  }
  const { stdout } = await execFileAsync('/usr/bin/unzip', ['-Z1', zip]);
  for (const file of ffmpeg.noticeFiles) {
    assert.match(stdout, new RegExp(`Marketing Seeding OS\\.app/Contents/Resources/app/plans/crawl4ai-integration/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\r?\\n|$)`));
  }
});
