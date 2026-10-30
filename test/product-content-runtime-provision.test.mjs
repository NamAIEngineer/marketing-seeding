import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  downloadVerifiedArtifact,
  provisionVerifiedArtifact,
  probeContentRuntime,
  repairContentRuntime,
  resolveContentRuntimePaths,
} from '../src/product-content-runtime.mjs';
import { getContentRuntimeProvenance } from '../src/product-content-runtime-provenance.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

test('Darwin arm64 managed ffmpeg pin records the public wheel and immutable bytes', () => {
  const ffmpeg = getContentRuntimeProvenance({ platform: 'darwin', arch: 'arm64' }).ffmpeg;
  assert.equal(ffmpeg.package, 'imageio-ffmpeg==0.6.0');
  assert.equal(ffmpeg.url, 'https://files.pythonhosted.org/packages/40/5c/f3d8a657d362cc93b81aab8feda487317da5b5d31c0e1fdfd5e986e55d17/imageio_ffmpeg-0.6.0-py3-none-macosx_11_0_arm64.whl');
  assert.equal(ffmpeg.sha256, 'b1ae3173414b5fc5f538a726c4e48ea97edc0d2cdc11f103afee655c463fa742');
  assert.equal(ffmpeg.executableSha256, '6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617');
  assert.match(ffmpeg.license, /BSD-2-Clause/);
});

function fixtureArtifact(kind = 'python') {
  const archive = Buffer.from(`${kind} archive fixture`);
  const executable = Buffer.from(`${kind} executable fixture`);
  return {
    version: 'fixture-1',
    archiveType: 'tar.gz',
    url: 'https://example.invalid/fixture.tar.gz',
    sha256: digest(archive),
    executable: `${kind}/bin/${kind}`,
    executableSha256: digest(executable),
    archive,
    executableBytes: executable,
  };
}

function extractorFor(artifact) {
  return async (_record, _archivePath, destination) => {
    const target = path.join(destination, artifact.executable);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, artifact.executableBytes, { mode: 0o700 });
  };
}

test('verified fixture artifact promotes only after archive and executable checks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-artifact-'));
  const artifact = fixtureArtifact();
  const result = await provisionVerifiedArtifact('python', artifact, root, {
    downloadImpl: async () => artifact.archive,
    extractImpl: extractorFor(artifact),
  });
  assert.equal(result.status, 'PROVISIONED');
  assert.equal(result.archiveSha256, artifact.sha256);
  assert.equal(result.executableSha256, artifact.executableSha256);
  assert.equal(await fs.readFile(result.path, 'utf8'), 'python executable fixture');
});

test('artifact checksum mismatch fails closed before extraction', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-artifact-mismatch-'));
  const artifact = fixtureArtifact();
  let extracted = false;
  const result = await provisionVerifiedArtifact('python', { ...artifact, sha256: '0'.repeat(64) }, root, {
    downloadImpl: async () => artifact.archive,
    extractImpl: async (...args) => { extracted = true; return extractorFor(artifact)(...args); },
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure.code, 'CONTENT_RUNTIME_CHECKSUM_MISMATCH');
  assert.equal(extracted, false);
});

test('streaming artifact download stops at the byte bound before buffering the whole response', async () => {
  const artifact = fixtureArtifact();
  const oversized = Buffer.alloc(32, 7);
  let cancelled = false;
  const response = {
    ok: true,
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: oversized };
          },
          async cancel() { cancelled = true; },
          releaseLock() {},
        };
      },
    },
  };
  await assert.rejects(
    downloadVerifiedArtifact(artifact, { fetchImpl: async () => response, maxBytes: 8 }),
    /exceeds byte bound/,
  );
  assert.equal(cancelled, true);
});

test('existing managed destination is replaced after verification and old tree is removed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-replace-'));
  const destination = path.join(root, 'toolchain-python');
  await fs.mkdir(path.join(destination, 'old'), { recursive: true });
  await fs.writeFile(path.join(destination, 'old', 'marker'), 'old');
  const artifact = fixtureArtifact();
  const result = await provisionVerifiedArtifact('python', artifact, root, {
    downloadImpl: async () => artifact.archive,
    extractImpl: extractorFor(artifact),
  });
  assert.equal(result.status, 'PROVISIONED');
  assert.equal(await fs.readFile(result.path, 'utf8'), 'python executable fixture');
  assert.equal(await fs.stat(path.join(destination, 'old')).then(() => true).catch(() => false), false);
});

test('promotion failure rolls back the old managed tree and cleans staging/backup paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-rollback-'));
  const destination = path.join(root, 'toolchain-python');
  await fs.mkdir(path.join(destination, 'old'), { recursive: true });
  await fs.writeFile(path.join(destination, 'old', 'marker'), 'old');
  const artifact = fixtureArtifact();
  let calls = 0;
  const renameImpl = async (source, target) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('destination exists'), { code: 'ENOTEMPTY' });
    if (calls === 3) throw Object.assign(new Error('promotion failed'), { code: 'EIO' });
    return fs.rename(source, target);
  };
  const result = await provisionVerifiedArtifact('python', artifact, root, {
    downloadImpl: async () => artifact.archive,
    extractImpl: extractorFor(artifact),
    renameImpl,
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure.code, 'CONTENT_RUNTIME_DOWNLOAD_FAILED');
  assert.equal(await fs.readFile(path.join(destination, 'old', 'marker'), 'utf8'), 'old');
  const entries = await fs.readdir(root);
  assert.deepEqual(entries, ['toolchain-python']);
});

test('production repair reports unsupported platform without downloading', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-platform-'));
  const paths = resolveContentRuntimePaths({ storageRoot: root, platform: 'linux', arch: 'x64', env: { PATH: '/usr/bin:/bin' } });
  let downloaded = false;
  const result = await repairContentRuntime({ mode: 'PRODUCTION', paths, repair: true, allowNetwork: true, fetchImpl: async () => { downloaded = true; } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.failure.code, 'CONTENT_RUNTIME_PLATFORM_UNSUPPORTED');
  assert.equal(downloaded, false);
});

test('production repair remains blocked offline before artifact acquisition', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-offline-'));
  const paths = resolveContentRuntimePaths({ storageRoot: root, env: { PATH: '/usr/bin:/bin' } });
  const result = await repairContentRuntime({ mode: 'PRODUCTION', paths, repair: true, allowNetwork: false });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.failure.code, 'CONTENT_RUNTIME_NETWORK_REQUIRED');
});

function fixtureFfmpegArtifact() {
  const archive = Buffer.from('imageio ffmpeg wheel fixture archive');
  const executable = Buffer.from('#!/bin/sh\necho "ffmpeg version 7.1 fixture"\n');
  return {
    version: '7.1', package: 'imageio-ffmpeg==0.6.0-fixture', archiveType: 'zip',
    url: 'https://example.invalid/imageio-ffmpeg.whl', sha256: digest(archive),
    executable: 'imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1', executableSha256: digest(executable),
    archive, executableBytes: executable,
  };
}

test('managed ffmpeg fixture is checksum verified and used with no host PATH', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-ffmpeg-'));
  const artifact = fixtureFfmpegArtifact();
  const paths = resolveContentRuntimePaths({ storageRoot: root, platform: 'darwin', arch: 'arm64', pathEnv: '/definitely-empty', env: { PATH: '/definitely-empty' }, provenance: { ffmpeg: artifact } });
  const installed = await provisionVerifiedArtifact('ffmpeg', artifact, root, { downloadImpl: async () => artifact.archive, extractImpl: extractorFor(artifact) });
  assert.equal(installed.status, 'PROVISIONED');
  assert.equal(installed.path, paths.managedFfmpegPath);
  const runtime = await probeContentRuntime({ mode: 'FIXTURE', paths, timeoutMs: 5_000 });
  assert.equal(runtime.ready, true);
  assert.equal(runtime.ffmpeg.source, 'managed-artifact');
  assert.equal(runtime.managedFfmpeg.status, 'READY');
});

test('managed ffmpeg checksum mismatch fails closed before execution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-ffmpeg-tamper-'));
  const artifact = fixtureFfmpegArtifact();
  const paths = resolveContentRuntimePaths({ storageRoot: root, platform: 'darwin', arch: 'arm64', pathEnv: '/definitely-empty', env: { PATH: '/definitely-empty' }, provenance: { ffmpeg: artifact } });
  await fs.mkdir(path.dirname(paths.managedFfmpegPath), { recursive: true });
  await fs.writeFile(paths.managedFfmpegPath, Buffer.from('tampered'), { mode: 0o700 });
  const runtime = await probeContentRuntime({ mode: 'FIXTURE', paths, timeoutMs: 5_000 });
  assert.equal(runtime.ready, false);
  assert.equal(runtime.failure.code, 'MEDIA_BACKEND_UNAVAILABLE');
  assert.equal(runtime.managedFfmpeg.status, 'FAILED');
  assert.equal(runtime.ffmpeg.status, 'FAILED');
});

test('managed ffmpeg version mismatch fails closed after checksum verification', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-ffmpeg-version-'));
  const artifact = fixtureFfmpegArtifact();
  const executable = path.join(root, 'ffmpeg.sh');
  await fs.writeFile(executable, '#!/bin/sh\necho "ffmpeg version 6.0 fixture"\n', { mode: 0o700 });
  const bytes = await fs.readFile(executable);
  const wrongVersionArtifact = { ...artifact, executableSha256: digest(bytes) };
  const paths = resolveContentRuntimePaths({ storageRoot: root, platform: 'darwin', arch: 'arm64', pathEnv: '/definitely-empty', env: { PATH: '/definitely-empty' }, provenance: { ffmpeg: wrongVersionArtifact } });
  await provisionVerifiedArtifact('ffmpeg', wrongVersionArtifact, root, { downloadImpl: async () => artifact.archive, extractImpl: extractorFor({ ...wrongVersionArtifact, executableBytes: bytes }) });
  const runtime = await probeContentRuntime({ mode: 'FIXTURE', paths, timeoutMs: 5_000 });
  assert.equal(runtime.ready, false);
  assert.equal(runtime.failure.code, 'MEDIA_BACKEND_UNAVAILABLE');
  assert.equal(runtime.ffmpeg.status, 'FAILED');
  assert.match(runtime.ffmpeg.stderr, /version does not match/);
});

test('production repair acquires managed ffmpeg when verified research artifacts already exist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-runtime-ffmpeg-repair-'));
  const ffmpeg = fixtureFfmpegArtifact();
  const base = getContentRuntimeProvenance({ platform: 'darwin', arch: 'arm64' });
  const pythonBytes = Buffer.from('#!/bin/sh\nexit 0\n');
  const chromeBytes = Buffer.from('#!/bin/sh\necho ChromeFixture\nexit 0\n');
  const provenance = {
    ...base,
    python: { ...base.python, sha256: digest(Buffer.from('unused python archive')), executableSha256: digest(pythonBytes) },
    chrome: { ...base.chrome, sha256: digest(Buffer.from('unused chrome archive')), executableSha256: digest(chromeBytes) },
    ffmpeg,
  };
  const paths = resolveContentRuntimePaths({ storageRoot: root, platform: 'darwin', arch: 'arm64', pathEnv: '/definitely-empty', env: { PATH: '/definitely-empty' }, provenance });
  await fs.mkdir(path.dirname(paths.managedPythonPath), { recursive: true });
  await fs.writeFile(paths.managedPythonPath, pythonBytes, { mode: 0o700 });
  await fs.mkdir(path.dirname(paths.managedChromePath), { recursive: true });
  await fs.writeFile(paths.managedChromePath, chromeBytes, { mode: 0o700 });
  const result = await repairContentRuntime({
    mode: 'PRODUCTION', paths, repair: true, allowNetwork: true, timeoutMs: 5_000,
    downloadImpl: async () => ffmpeg.archive, extractImpl: extractorFor(ffmpeg),
  });
  assert.equal(result.ready, true);
  assert.equal(result.status, 'READY');
  assert.equal(result.repair.actions.find((action) => action.kind === 'ffmpeg-artifact')?.status, 'PROVISIONED');
  assert.equal(result.ffmpeg.source, 'env');
  assert.equal(result.ffmpeg.path, paths.managedFfmpegPath);
});

