import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  provisionVerifiedArtifact,
  repairContentRuntime,
  resolveContentRuntimePaths,
} from '../src/product-content-runtime.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

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

