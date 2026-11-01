#!/usr/bin/env node
import { probeContentRuntime, repairContentRuntime, resolveContentRuntimePaths } from '../src/product-content-runtime.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith('--')) continue;
  const key = token.slice(2);
  args.set(key, process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[++index] : true);
}

const mode = String(args.get('mode') || process.env.SEEDING_CONTENT_MODE || 'LOCAL').toUpperCase();
const paths = resolveContentRuntimePaths({
  storageRoot: args.get('storage-root') || process.env.SEEDING_CONTENT_RUNTIME_ROOT,
  resourcesDir: args.get('resources-dir') || process.env.SEEDING_CONTENT_RESOURCES,
});
const result = args.get('repair')
  ? await repairContentRuntime({ mode, paths, repair: true, allowNetwork: args.get('allow-network') === true, ffmpegSourcePath: args.get('ffmpeg-source'), ffmpegSha256: args.get('ffmpeg-sha256') })
  : await probeContentRuntime({ mode, paths });
console.log(JSON.stringify({
  status: result.status,
  ready: result.ready,
  mode: result.mode,
  paths: { storageRoot: result.paths?.storageRoot, pythonPath: result.python?.path || result.paths?.pythonPath, ffmpegPath: result.ffmpeg?.path || result.paths?.ffmpegPath, chromePath: result.chrome?.path || null },
  python: result.python?.status,
  ffmpeg: result.ffmpeg?.status,
  chrome: result.chrome?.status,
  failure: result.failure || null,
  repair: result.repair ? { attempted: result.repair.attempted, actions: result.repair.actions, manifestPath: result.repair.manifestPath || null, lock: result.repair.metadata?.lock || null, notices: result.repair.metadata?.notices || null } : null,
}, null, 2));
if (!result.ready) process.exitCode = 2;
