import { createHash } from 'node:crypto';
import { promises as fs, constants as FS_CONSTANTS } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONTENT_RUNTIME_PROVENANCE_VERSION, getContentRuntimeProvenance } from './product-content-runtime-provenance.mjs';

/**
 * Provisioning and preflight for the content lane's local backends.
 *
 * This module owns no network or publishing policy.  `probeContentRuntime`
 * is read-only.  `repairContentRuntime` only mutates the caller supplied
 * per-user storage root and requires `allowNetwork: true` before creating a
 * virtualenv or running pip.  A downloaded app can pass app-resources paths;
 * development shells can use the exact SEEDING_CONTENT_* environment paths.
 */

export const CONTENT_RUNTIME_VERSION = 1;
export const CONTENT_RUNTIME_STATUSES = Object.freeze(['READY', 'PARTIAL', 'UNAVAILABLE', 'BLOCKED']);
export const CONTENT_RUNTIME_FAILURE_CODES = Object.freeze([
  'RESEARCH_BACKEND_UNAVAILABLE',
  'MEDIA_BACKEND_UNAVAILABLE',
  'CONTENT_RUNTIME_UNAVAILABLE',
  'CONTENT_RUNTIME_NETWORK_REQUIRED',
  'CONTENT_RUNTIME_CHECKSUM_REQUIRED',
  'CONTENT_RUNTIME_CHECKSUM_MISMATCH',
  'CONTENT_RUNTIME_INSTALL_FAILED',
  'CONTENT_RUNTIME_PLATFORM_UNSUPPORTED',
  'CONTENT_RUNTIME_PROVENANCE_REQUIRED',
  'CONTENT_RUNTIME_DOWNLOAD_FAILED',
]);

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOCK_PATH = path.join(APP_ROOT, 'plans', 'crawl4ai-integration', 'python-dependencies.lock');
const DEFAULT_NOTICES_PATH = path.join(APP_ROOT, 'plans', 'crawl4ai-integration', 'THIRD-PARTY-NOTICES.md');
const DEFAULT_RUNTIME_NAME = 'Marketing Seeding';
const DEFAULT_RUNTIME_VERSION = 'v1';
const MAX_LOCK_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;
// SHA-256 of plans/crawl4ai-integration/python-dependencies.lock at the
// checked-in backend revisions. Update this constant only with a reviewed pin
// and matching third-party notice change.
const EXPECTED_LOCK_SHA256 = 'be16f50383aab98f74a712257acb89a3c774cedf04412eefc86772a07a721598';
const PYTHON_PACKAGES = Object.freeze({
  crawl4ai: { importName: 'crawl4ai', revision: 'v0.9.5@838869bdda93f25e6d50b3f50ae9577d9b19a586', license: 'Apache-2.0' },
  nodriver: { importName: 'nodriver', revision: '0233da5bfbe98dc58341f0863526b6315a97e646', license: 'AGPL-3.0' },
  bs4: { importName: 'bs4', revision: 'beautifulsoup4==4.15.0', license: 'MIT' },
});
const BACKEND_SCRIPTS = Object.freeze({
  extractor: path.join(APP_ROOT, 'scripts', 'crawl4ai_extract.py'),
  fetcher: path.join(APP_ROOT, 'scripts', 'nodriver_fetcher.py'),
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function clean(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function failure(code, message, details = null) {
  return { code, message: clean(message, 500), details };
}

function safePath(value, fallback) {
  const candidate = String(value || '').trim();
  return candidate ? path.resolve(candidate) : path.resolve(fallback);
}

function platformUserRoot({ homeDir = os.homedir(), appName = DEFAULT_RUNTIME_NAME, version = DEFAULT_RUNTIME_VERSION } = {}) {
  if (process.platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', appName, 'content-runtime', version);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), appName, 'content-runtime', version);
  return path.join(process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), appName, 'content-runtime', version);
}

async function existsExecutable(candidate) {
  if (!candidate) return false;
  try {
    await fs.access(candidate, FS_CONSTANTS.F_OK | FS_CONSTANTS.X_OK);
    const stat = await fs.stat(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function existsFile(candidate) {
  if (!candidate) return false;
  try { return (await fs.stat(candidate)).isFile(); } catch { return false; }
}

async function findOnPath(name, envPath = process.env.PATH || '') {
  if (!name) return null;
  if (path.isAbsolute(name)) return await existsExecutable(name) ? name : null;
  for (const directory of String(envPath).split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    if (await existsExecutable(candidate)) return candidate;
  }
  return null;
}

function pythonStoragePath(root) {
  return process.platform === 'win32' ? path.join(root, 'python', 'Scripts', 'python.exe') : path.join(root, 'python', 'bin', 'python');
}

function managedPythonPath(root, provenance) {
  const executable = provenance?.python?.executable;
  if (!executable) return null;
  return path.join(root, 'toolchain-python', executable);
}

function managedChromePath(root, provenance) {
  const executable = provenance?.chrome?.executable;
  if (!executable) return null;
  return path.join(root, 'browser', executable);
}

function managedFfmpegPath(root, provenance) {
  const executable = provenance?.ffmpeg?.executable;
  if (!executable) return null;
  return path.join(root, 'toolchain-ffmpeg', executable);
}

function chromeCandidates({ root, resourcesDir, env, envPath }) {
  return [
    env.SEEDING_NODRIVER_CHROME,
    { value: path.join(resourcesDir, 'bin', 'chrome'), source: 'app-resources' },
    { value: path.join(root, 'bin', 'chrome'), source: 'user-storage' },
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
    process.platform === 'darwin' ? '/Applications/Chromium.app/Contents/MacOS/Chromium' : null,
    'google-chrome', 'chromium', 'chromium-browser'
  ].filter(Boolean).map((candidate) => typeof candidate === 'string' ? ({ candidate, path: candidate, source: 'system' }) : ({ candidate: candidate.value, path: candidate.value, source: candidate.source }));
}

/** Resolve every path the pipeline may use. This function does no I/O. */
export function resolveContentRuntimePaths({ storageRoot, resourcesDir = APP_ROOT, env = process.env, appName, version, pathEnv, provenance = null, platform = process.platform, arch = process.arch } = {}) {
  const root = safePath(storageRoot, platformUserRoot({ appName, version }));
  const resources = safePath(resourcesDir, APP_ROOT);
  const artifactProvenance = provenance || getContentRuntimeProvenance({ platform, arch });
  const envPath = String(pathEnv || env.PATH || process.env.PATH || '');
  const pythonCandidates = [
    { value: env.SEEDING_CONTENT_PYTHON || env.SEEDING_LISTENING_PYTHON, source: 'env' },
    { value: pythonStoragePath(root), source: 'user-storage' },
    { value: managedPythonPath(root, artifactProvenance), source: 'managed-artifact' },
    { value: path.join(resources, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python'), source: 'app-resources' },
    { value: 'python3', source: 'system-path' },
  ].filter((item) => item.value);
  const ffmpegCandidates = [
    { value: env.SEEDING_CONTENT_FFMPEG || env.FFMPEG_PATH, source: 'env' },
    { value: managedFfmpegPath(root, artifactProvenance), source: 'managed-artifact' },
    { value: path.join(root, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), source: 'user-storage' },
    { value: path.join(resources, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), source: 'app-resources' },
    { value: 'ffmpeg', source: 'system-path' },
  ].filter((item) => item.value);
  const pick = (candidates) => candidates[0];
  const chrome = chromeCandidates({ root, resourcesDir: resources, env, envPath });
  const managedChrome = managedChromePath(root, artifactProvenance);
  if (managedChrome) {
    const envIndex = chrome.findIndex((candidate) => candidate.source === 'env');
    chrome.splice(envIndex >= 0 ? envIndex : 0, 0, { candidate: managedChrome, path: managedChrome, source: 'managed-artifact' });
  }
  return Object.freeze({
    version: CONTENT_RUNTIME_VERSION,
    storageRoot: root,
    resourcesDir: resources,
    lockPath: path.resolve(String(env.SEEDING_CONTENT_LOCK || path.join(resources, 'plans', 'crawl4ai-integration', 'python-dependencies.lock'))),
    noticesPath: path.resolve(String(env.SEEDING_CONTENT_NOTICES || path.join(resources, 'plans', 'crawl4ai-integration', 'THIRD-PARTY-NOTICES.md'))),
    pythonPath: pick(pythonCandidates)?.value || 'python3',
    pythonSource: pick(pythonCandidates)?.source || 'system-path',
    pythonCandidates: pythonCandidates.map((item) => ({ ...item })),
    ffmpegPath: pick(ffmpegCandidates)?.value || 'ffmpeg',
    ffmpegSource: pick(ffmpegCandidates)?.source || 'system-path',
    ffmpegCandidates: ffmpegCandidates.map((item) => ({ ...item })),
    pythonBootstrapPath: env.SEEDING_CONTENT_PYTHON_BOOTSTRAP || 'python3',
    managedPythonPath: managedPythonPath(root, artifactProvenance),
    managedChromePath: managedChrome,
    managedFfmpegPath: managedFfmpegPath(root, artifactProvenance),
    provenance: artifactProvenance,
    runtimeManifestPath: path.join(root, 'runtime-manifest.json'),
    chromeCandidates: chrome,
    extractorScript: path.join(resources, 'scripts', 'crawl4ai_extract.py'),
    fetcherScript: path.join(resources, 'scripts', 'nodriver_fetcher.py'),
    pathEnv: envPath,
  });
}

function runBounded(binary, args, { cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS, maxOutputBytes = 24_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const stdout = [];
    const stderr = [];
    const child = spawnImpl(binary, args, { cwd, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env });
    const terminate = (signal) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch {}
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout: Buffer.concat(stdout).toString('utf8').slice(0, maxOutputBytes), stderr: Buffer.concat(stderr).toString('utf8').slice(0, maxOutputBytes) });
    };
    const timer = setTimeout(() => {
      terminate('SIGTERM');
      finish({ status: 'TIMEOUT', code: null });
    }, Math.max(100, timeoutMs));
    child.stdout?.on('data', (chunk) => { if (Buffer.concat(stdout).length <= maxOutputBytes) stdout.push(Buffer.from(chunk)); });
    child.stderr?.on('data', (chunk) => { if (Buffer.concat(stderr).length <= maxOutputBytes) stderr.push(Buffer.from(chunk)); });
    child.on('error', (error) => finish({ status: 'ERROR', code: error.code || null, error: clean(error.message, 500) }));
    child.on('close', (code, signal) => finish({ status: code === 0 ? 'OK' : 'FAILED', code, signal }));
  });
}

async function probeExecutable(candidate, args, options = {}) {
  const absolute = path.isAbsolute(candidate) ? candidate : await findOnPath(candidate, options.pathEnv);
  if (!absolute || !(await existsExecutable(absolute))) return { status: 'MISSING', path: absolute || candidate, version: null, stderr: 'executable not found' };
  const env = { PATH: options.pathEnv || process.env.PATH || '', PYTHONDONTWRITEBYTECODE: '1' };
  const result = await runBounded(absolute, args, { ...options, env });
  const output = clean(`${result.stdout}\n${result.stderr}`, 1_000);
  return {
    status: result.status === 'OK' ? 'READY' : result.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
    path: absolute,
    version: result.status === 'OK' ? clean(result.stdout || result.stderr, 240) : null,
    stderr: result.status === 'OK' ? null : output,
    exitCode: result.code,
  };
}

async function probeFirstCandidate(candidates, args, options = {}) {
  const attempts = [];
  for (const candidate of candidates || []) {
    const result = await probeExecutable(candidate.value || candidate.path, args, options);
    attempts.push({ ...result, source: candidate.source || null });
    if (result.status === 'READY') return { ...result, source: candidate.source || null, attempts };
  }
  return { ...(attempts[attempts.length - 1] || { status: 'MISSING', path: null }), attempts };
}

async function verifyManagedArtifact(filePath, expectedSha256) {
  if (!filePath || !expectedSha256) return { status: 'NOT_CONFIGURED', path: filePath || null, sha256: null };
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { status: 'MISSING', path: filePath, sha256: null };
    const digest = sha256(await fs.readFile(filePath));
    return { status: digest === expectedSha256 ? 'READY' : 'FAILED', path: filePath, sha256: digest, expectedSha256 };
  } catch (error) {
    return { status: 'MISSING', path: filePath, sha256: null, error: error.code || 'ENOENT' };
  }
}

async function downloadArtifact(artifact, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS, maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(artifact.url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`artifact download returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('artifact exceeds byte bound');
    const body = response.body;
    if (!body) throw new Error('artifact download returned no body');
    const chunks = [];
    let total = 0;
    const append = (chunk) => {
      const bytes = Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maxBytes) throw new Error('artifact exceeds byte bound');
      chunks.push(bytes);
    };
    if (typeof body.getReader === 'function') {
      const reader = body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          append(next.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock?.();
      }
    } else if (typeof body[Symbol.asyncIterator] === 'function') {
      for await (const chunk of body) append(chunk);
    } else {
      throw new Error('artifact download body is not streamable');
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
  }
}

/** Checksum bootstrap download with bounded streaming response handling. */
export const downloadVerifiedArtifact = downloadArtifact;

async function extractArtifact(artifact, archivePath, destination, { timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS, spawnImpl = spawn } = {}) {
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  const command = artifact.archiveType === 'zip' ? 'unzip' : 'tar';
  const args = artifact.archiveType === 'zip' ? ['-q', archivePath, '-d', destination] : ['-xzf', archivePath, '-C', destination];
  const result = await runBounded(command, args, { cwd: destination, env: sanitizedEnv(process.env.PATH), timeoutMs, spawnImpl });
  if (result.status !== 'OK') throw new Error(`${command} extraction failed: ${clean(result.stderr || result.stdout, 500)}`);
}

async function cleanStalePromotionPaths(root, kind, destination) {
  const stagingPrefix = `.content-runtime-${kind}-`;
  const backupPrefix = `${path.basename(destination)}.previous-`;
  let entries = [];
  try { entries = await fs.readdir(root); } catch { return; }
  await Promise.all(entries
    .filter((entry) => entry.startsWith(stagingPrefix) || entry.startsWith(backupPrefix))
    .map((entry) => fs.rm(path.join(root, entry), { recursive: true, force: true }).catch(() => {})));
}

async function provisionArtifact(kind, artifact, root, { downloadImpl = downloadArtifact, extractImpl = extractArtifact, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS, spawnImpl = spawn, renameImpl = fs.rename } = {}) {
  if (!artifact || !artifact.url || !/^[a-f0-9]{64}$/i.test(artifact.sha256 || '') || !artifact.executable || !/^[a-f0-9]{64}$/i.test(artifact.executableSha256 || '')) {
    return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_PROVENANCE_REQUIRED', `${kind} artifact provenance is incomplete`) };
  }
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const destination = path.join(root, kind === 'python' ? 'toolchain-python' : kind === 'chrome' ? 'browser' : 'toolchain-ffmpeg');
  await cleanStalePromotionPaths(root, kind, destination);
  const staging = await fs.mkdtemp(path.join(root, `.content-runtime-${kind}-`));
  const archivePath = path.join(staging, `artifact.${artifact.archiveType === 'zip' ? 'zip' : 'tar.gz'}`);
  const extractRoot = path.join(staging, 'extract');
  try {
    const result = await downloadImpl(artifact, { timeoutMs, maxBytes: MAX_DOWNLOAD_BYTES });
    const bytes = Buffer.isBuffer(result) ? result : Buffer.from(result);
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('artifact exceeds byte bound');
    const archiveSha256 = sha256(bytes);
    if (archiveSha256 !== artifact.sha256.toLowerCase()) return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_CHECKSUM_MISMATCH', `${kind} archive checksum does not match the pinned digest`, { expectedSha256: artifact.sha256, actualSha256: archiveSha256 }) };
    await fs.writeFile(archivePath, bytes, { mode: 0o600 });
    await extractImpl(artifact, archivePath, extractRoot, { timeoutMs, spawnImpl });
    const executable = path.join(extractRoot, artifact.executable);
    const verified = await verifyManagedArtifact(executable, artifact.executableSha256.toLowerCase());
    if (verified.status !== 'READY') return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_CHECKSUM_MISMATCH', `${kind} executable checksum does not match the pinned digest`, { expectedSha256: artifact.executableSha256, actualSha256: verified.sha256 }) };
    const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
    let previousMoved = false;
    try {
      await renameImpl(extractRoot, destination);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      await renameImpl(destination, previous);
      previousMoved = true;
      try {
        await renameImpl(extractRoot, destination);
      } catch (promoteError) {
        await renameImpl(previous, destination).catch(() => {});
        previousMoved = false;
        throw promoteError;
      }
    }
    if (previousMoved) await fs.rm(previous, { recursive: true, force: true }).catch(() => {});
    try { await fs.chmod(path.join(destination, artifact.executable), 0o700); } catch {}
    return { status: 'PROVISIONED', path: path.join(destination, artifact.executable), archiveSha256, executableSha256: verified.sha256, version: artifact.version };
  } catch (error) {
    return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_DOWNLOAD_FAILED', `${kind} artifact provisioning failed`, { cause: clean(error.message, 500) }) };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Checksum-first artifact installation primitive. Callers may inject a
 * deterministic downloader/extractor for tests; production defaults use
 * fetch plus the platform archive tool. The returned path is promoted only
 * after both archive and executable bytes match immutable pins.
 */
export const provisionVerifiedArtifact = provisionArtifact;

function modeRequirements(mode) {
  const normalized = String(mode || 'LOCAL').toUpperCase();
  if (normalized === 'FIXTURE') return { python: [], chrome: false, ffmpeg: true };
  if (normalized === 'PRODUCTION') return { python: ['crawl4ai', 'nodriver', 'bs4', 'lxml'], chrome: true, ffmpeg: true };
  return { python: ['crawl4ai', 'bs4', 'lxml'], chrome: false, ffmpeg: true };
}

/** Read-only dependency preflight. Never installs, downloads, or creates files. */
export async function probeContentRuntime({ mode = 'LOCAL', paths = null, storageRoot, resourcesDir, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = spawn } = {}) {
  const requirements = modeRequirements(mode);
  const resolved = paths || resolveContentRuntimePaths({ storageRoot, resourcesDir, env });
  // Check managed bytes before attempting to execute any candidate. This
  // prevents a tampered managed executable from being run for `-version`.
  const managedFfmpeg = await verifyManagedArtifact(resolved.managedFfmpegPath, resolved.provenance?.ffmpeg?.executableSha256);
  const [python, initialFfmpeg] = await Promise.all([
    requirements.python.length
      ? probeFirstCandidate(resolved.pythonCandidates || [{ value: resolved.pythonPath, source: resolved.pythonSource }], ['-c', `import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ is required'; ${requirements.python.map((name) => `import ${name}`).join('; ')}; print('CONTENT_RUNTIME_IMPORTS_OK')`], { pathEnv: resolved.pathEnv, timeoutMs, spawnImpl })
      : Promise.resolve({ status: 'NOT_REQUIRED', path: resolved.pythonPath, imports: [] }),
    requirements.ffmpeg
      ? managedFfmpeg.status === 'FAILED'
        ? Promise.resolve({ status: 'FAILED', path: managedFfmpeg.path, source: 'managed-artifact', stderr: 'managed ffmpeg checksum does not match the reviewed pin', managed: managedFfmpeg })
        : probeFirstCandidate(resolved.ffmpegCandidates || [{ value: resolved.ffmpegPath, source: resolved.ffmpegSource }], ['-version'], { pathEnv: resolved.pathEnv, timeoutMs, spawnImpl })
      : Promise.resolve({ status: 'NOT_REQUIRED', path: resolved.ffmpegPath }),
  ]);
  let ffmpeg = initialFfmpeg;
  const managedFfmpegVersion = resolved.provenance?.ffmpeg?.version;
  if (ffmpeg.status === 'READY' && ffmpeg.source === 'managed-artifact' && managedFfmpegVersion && !String(ffmpeg.version || '').includes(String(managedFfmpegVersion))) {
    ffmpeg = {
      ...ffmpeg,
      status: 'FAILED',
      stderr: `managed ffmpeg version does not match the reviewed ${managedFfmpegVersion} pin`,
    };
  }
  // A managed file with the wrong immutable bytes must never fall through to
  // a different candidate or be executed. A missing managed file may use the
  // existing host fallback when that candidate is available.
  const managedPython = await verifyManagedArtifact(resolved.managedPythonPath, resolved.provenance?.python?.executableSha256);
  const managedChrome = await verifyManagedArtifact(resolved.managedChromePath, resolved.provenance?.chrome?.executableSha256);
  let chrome = { status: 'NOT_REQUIRED', path: null };
  if (requirements.chrome) {
    const chromeCandidates = Array.isArray(resolved.chromeCandidates) ? resolved.chromeCandidates : [];
    chrome = chromeCandidates.length
      ? await probeFirstCandidate(chromeCandidates.map((item) => ({ value: item.path, source: item.source || null })), ['--version'], { pathEnv: resolved.pathEnv, timeoutMs, spawnImpl })
      : { status: 'MISSING', path: null, stderr: 'Chrome executable not configured' };
  }
  const managedRequired = String(mode).toUpperCase() === 'PRODUCTION' && Boolean(resolved.provenance);
  const artifactPythonInvalid = requirements.python.length > 0 && managedRequired && managedPython.status !== 'READY';
  const artifactChromeInvalid = requirements.chrome && managedRequired && managedChrome.status !== 'READY';
  const missingPython = requirements.python.length > 0 && (python.status !== 'READY' || artifactPythonInvalid);
  const missingMedia = requirements.ffmpeg && ffmpeg.status !== 'READY';
  const missingChrome = requirements.chrome && (chrome.status !== 'READY' || artifactChromeInvalid);
  const status = !missingPython && !missingMedia && !missingChrome ? 'READY' : 'UNAVAILABLE';
  let runtimeFailure = null;
  if (missingPython || missingChrome) runtimeFailure = failure('RESEARCH_BACKEND_UNAVAILABLE', 'content research backend is unavailable', { python, chrome, mode: String(mode).toUpperCase() });
  else if (missingMedia) runtimeFailure = failure('MEDIA_BACKEND_UNAVAILABLE', 'content media backend is unavailable', { ffmpeg });
  return {
    version: CONTENT_RUNTIME_VERSION,
    status,
    ready: status === 'READY',
    mode: String(mode).toUpperCase(),
    paths: resolved,
    python,
    managedPython,
    ffmpeg,
    chrome,
    managedChrome,
    managedFfmpeg,
    requirements,
    failure: runtimeFailure,
    readOnly: true,
  };
}

async function readPinnedMetadata(lockPath, noticesPath) {
  let lock;
  try {
    const data = await fs.readFile(lockPath);
    if (data.byteLength > MAX_LOCK_BYTES) throw new Error('dependency lock exceeds byte bound');
    const digest = sha256(data);
    lock = { path: lockPath, sha256: digest, expectedSha256: EXPECTED_LOCK_SHA256, bytes: data.byteLength, verified: digest === EXPECTED_LOCK_SHA256 };
  } catch (error) {
    return { lock: null, notices: null, error: clean(error.message, 300) };
  }
  let notices = null;
  try {
    const data = await fs.readFile(noticesPath);
    notices = { path: noticesPath, sha256: sha256(data), bytes: data.byteLength };
  } catch (error) {
    notices = { path: noticesPath, missing: true, error: clean(error.message, 300) };
  }
  return { lock, notices, error: null };
}

async function writeJsonAtomic(filePath, value) {
  const target = path.resolve(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, target);
  return target;
}

function sanitizedEnv(pathEnv) {
  return { PATH: pathEnv || process.env.PATH || '', PYTHONUNBUFFERED: '1' };
}

async function installPythonRuntime(paths, { pythonBootstrap = null, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS, allowNetwork = false, spawnImpl = spawn } = {}) {
  if (!allowNetwork) return { status: 'BLOCKED', failure: failure('CONTENT_RUNTIME_NETWORK_REQUIRED', 'Python backend repair requires allowNetwork: true', { lockPath: paths.lockPath }) };
  const bootstrap = pythonBootstrap || paths.pythonBootstrapPath || paths.pythonPath || 'python3';
  if (!(await existsExecutable(await findOnPath(bootstrap, paths.pathEnv) || bootstrap))) return { status: 'UNAVAILABLE', failure: failure('RESEARCH_BACKEND_UNAVAILABLE', 'Python bootstrap executable is unavailable', { pythonPath: bootstrap }) };
  await fs.mkdir(paths.storageRoot, { recursive: true, mode: 0o700 });
  const compatibility = await runBounded(bootstrap, ['-c', "import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ is required'"], { cwd: paths.storageRoot, env: sanitizedEnv(paths.pathEnv), timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS), spawnImpl });
  if (compatibility.status !== 'OK') return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_INSTALL_FAILED', 'Python bootstrap is too old for pinned content backends', { stderr: clean(compatibility.stderr, 800), exitCode: compatibility.code }) };
  const venvRoot = path.join(paths.storageRoot, 'python');
  const create = await runBounded(bootstrap, ['-m', 'venv', '--clear', venvRoot], { cwd: paths.storageRoot, env: sanitizedEnv(paths.pathEnv), timeoutMs, spawnImpl });
  if (create.status !== 'OK') return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_INSTALL_FAILED', 'Python virtualenv creation failed', { stderr: clean(create.stderr, 800), exitCode: create.code }) };
  const python = pythonStoragePath(paths.storageRoot);
  const lock = await existsFile(paths.lockPath);
  if (!lock) return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_INSTALL_FAILED', 'Pinned Python dependency lock is unavailable', { lockPath: paths.lockPath }) };
  const install = await runBounded(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', paths.lockPath], { cwd: paths.storageRoot, env: sanitizedEnv(paths.pathEnv), timeoutMs, spawnImpl });
  if (install.status !== 'OK') return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_INSTALL_FAILED', 'Pinned Python dependency installation failed', { stderr: clean(install.stderr, 1_000), exitCode: install.code }) };
  return { status: 'PROVISIONED', pythonPath: python };
}

/** Stage a caller supplied, checksum-pinned executable into user storage. */
export async function stageVerifiedBinary({ sourcePath, destinationPath, expectedSha256, maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
  const rawSource = String(sourcePath || '').trim();
  const rawDestination = String(destinationPath || '').trim();
  if (!rawSource || !rawDestination) return { status: 'FAILED', failure: failure('MEDIA_BACKEND_UNAVAILABLE', 'sourcePath and destinationPath are required') };
  const source = path.resolve(rawSource);
  const destination = path.resolve(rawDestination);
  if (!/^[a-f0-9]{64}$/i.test(String(expectedSha256 || ''))) return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_CHECKSUM_REQUIRED', 'binary staging requires an exact SHA-256 checksum') };
  let data;
  try {
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size > maxBytes) return { status: 'FAILED', failure: failure('MEDIA_BACKEND_UNAVAILABLE', 'source binary is missing or exceeds byte bound', { bytes: stat.size }) };
    data = await fs.readFile(source);
  } catch (error) {
    return { status: 'FAILED', failure: failure('MEDIA_BACKEND_UNAVAILABLE', 'source binary is unavailable', { cause: error.code || 'ENOENT' }) };
  }
  const digest = sha256(data).toLowerCase();
  if (digest !== String(expectedSha256).toLowerCase()) return { status: 'FAILED', failure: failure('CONTENT_RUNTIME_CHECKSUM_MISMATCH', 'source binary checksum does not match the pinned digest', { expectedSha256, actualSha256: digest }) };
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.writeFile(destination, data, { mode: 0o700 });
  try { await fs.chmod(destination, 0o700); } catch {}
  return { status: 'STAGED', path: destination, bytes: data.byteLength, sha256: digest };
}

/**
 * Explicit repair path. It is safe to call at app startup with
 * `repair:false`; no files are written in that mode. Network installation is
 * opt-in and always uses the checked-in, hashed lock metadata.
 */
export async function repairContentRuntime({ mode = 'LOCAL', storageRoot, resourcesDir, env = process.env, paths = null, repair = false, allowNetwork = false, pythonBootstrap = null, ffmpegSourcePath = null, ffmpegSha256 = null, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS, spawnImpl = spawn, fetchImpl = globalThis.fetch, downloadImpl = null, extractImpl = extractArtifact } = {}) {
  const resolved = paths || resolveContentRuntimePaths({ storageRoot, resourcesDir, env });
  const before = await probeContentRuntime({ mode, paths: resolved, timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS), spawnImpl });
  const metadata = await readPinnedMetadata(resolved.lockPath, resolved.noticesPath);
  if (metadata.lock && metadata.lock.verified === false) {
    return { ...before, status: 'BLOCKED', ready: false, failure: failure('CONTENT_RUNTIME_CHECKSUM_MISMATCH', 'dependency lock does not match the reviewed pin', metadata.lock), repair: { attempted: false, actions: [], metadata } };
  }
  if (repair && !metadata.lock) {
    return { ...before, status: 'BLOCKED', ready: false, failure: failure('CONTENT_RUNTIME_INSTALL_FAILED', 'pinned dependency lock is unavailable; repair was not attempted', metadata), repair: { attempted: false, actions: [], metadata } };
  }
  if (!repair) return { ...before, repair: { attempted: false, actions: [], metadata } };
  if (!allowNetwork) {
    return { ...before, status: 'BLOCKED', ready: false, failure: failure('CONTENT_RUNTIME_NETWORK_REQUIRED', 'content runtime repair requires allowNetwork: true', { mode: String(mode).toUpperCase() }), repair: { attempted: true, actions: [], metadata } };
  }
  if (String(mode).toUpperCase() === 'PRODUCTION' && !resolved.provenance) {
    return { ...before, status: 'BLOCKED', ready: false, failure: failure('CONTENT_RUNTIME_PLATFORM_UNSUPPORTED', 'no verified content-runtime artifacts are published for this platform', { platform: `${process.platform}-${process.arch}` }), repair: { attempted: true, actions: [], metadata } };
  }
  const actions = [];
  if (String(mode).toUpperCase() === 'PRODUCTION' && (!before.managedPython || before.managedPython.status !== 'READY')) {
    const installed = await provisionArtifact('python', resolved.provenance.python, resolved.storageRoot, { downloadImpl: downloadImpl || ((artifact, options) => downloadArtifact(artifact, { ...options, fetchImpl })), extractImpl, timeoutMs, spawnImpl });
    actions.push({ kind: 'python-artifact', ...installed });
    if (installed.status !== 'PROVISIONED') return { ...before, status: 'BLOCKED', ready: false, failure: installed.failure, repair: { attempted: true, actions, metadata } };
  }
  if (String(mode).toUpperCase() === 'PRODUCTION' && (!before.managedChrome || before.managedChrome.status !== 'READY')) {
    const installed = await provisionArtifact('chrome', resolved.provenance.chrome, resolved.storageRoot, { downloadImpl: downloadImpl || ((artifact, options) => downloadArtifact(artifact, { ...options, fetchImpl })), extractImpl, timeoutMs, spawnImpl });
    actions.push({ kind: 'chrome-artifact', ...installed });
    if (installed.status !== 'PROVISIONED') return { ...before, status: 'BLOCKED', ready: false, failure: installed.failure, repair: { attempted: true, actions, metadata } };
  }
  const artifactPython = resolved.managedPythonPath && (await existsExecutable(resolved.managedPythonPath)) ? resolved.managedPythonPath : null;
  const pythonProvisioned = actions.some((action) => action.kind === 'python-artifact' && action.status === 'PROVISIONED');
  if (pythonProvisioned || !before.python || before.python.status !== 'READY') {
    const installed = await installPythonRuntime(resolved, { pythonBootstrap: artifactPython || pythonBootstrap, timeoutMs, allowNetwork, spawnImpl });
    actions.push({ kind: 'python', ...installed });
    if (installed.status === 'BLOCKED' || installed.status === 'FAILED' || installed.status === 'UNAVAILABLE') {
      return { ...before, status: 'BLOCKED', ready: false, failure: installed.failure, repair: { attempted: true, actions, metadata } };
    }
  }
  if (!before.ffmpeg || before.ffmpeg.status !== 'READY') {
    let installed;
    if (String(mode).toUpperCase() === 'PRODUCTION' && resolved.provenance?.ffmpeg) {
      installed = await provisionArtifact('ffmpeg', resolved.provenance.ffmpeg, resolved.storageRoot, { downloadImpl: downloadImpl || ((artifact, options) => downloadArtifact(artifact, { ...options, fetchImpl })), extractImpl, timeoutMs, spawnImpl });
    } else if (ffmpegSourcePath) {
      const staged = await stageVerifiedBinary({ sourcePath: ffmpegSourcePath, destinationPath: path.join(resolved.storageRoot, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), expectedSha256: ffmpegSha256 });
      installed = { kind: 'ffmpeg', ...staged };
    } else {
      return { ...before, status: 'BLOCKED', ready: false, failure: failure('MEDIA_BACKEND_UNAVAILABLE', 'ffmpeg is unavailable and no checksum-pinned binary was supplied', { destination: resolved.managedFfmpegPath || path.join(resolved.storageRoot, 'bin', 'ffmpeg') }), repair: { attempted: true, actions, metadata } };
    }
    if (!installed.kind) installed = { kind: 'ffmpeg-artifact', ...installed };
    actions.push(installed);
    if (installed.status !== 'PROVISIONED' && installed.status !== 'STAGED') {
      const mediaFailure = installed.failure?.code === 'CONTENT_RUNTIME_CHECKSUM_MISMATCH'
        ? failure('MEDIA_BACKEND_UNAVAILABLE', installed.failure.message, installed.failure.details)
        : installed.failure;
      return { ...before, status: 'BLOCKED', ready: false, failure: mediaFailure, repair: { attempted: true, actions, metadata } };
    }
  }
  const stagedFfmpeg = actions.find((action) => ['ffmpeg', 'ffmpeg-artifact'].includes(action.kind) && ['STAGED', 'PROVISIONED'].includes(action.status))?.path;
  const afterPaths = resolveContentRuntimePaths({
    storageRoot: resolved.storageRoot,
    resourcesDir: resolved.resourcesDir,
    provenance: resolved.provenance,
    env: {
      ...env,
      SEEDING_CONTENT_PYTHON: pythonStoragePath(resolved.storageRoot),
      SEEDING_CONTENT_FFMPEG: stagedFfmpeg || before.ffmpeg?.path || env.SEEDING_CONTENT_FFMPEG,
    }
  });
  const after = await probeContentRuntime({ mode, paths: afterPaths, timeoutMs: Math.min(timeoutMs, DEFAULT_TIMEOUT_MS), spawnImpl });
  const manifestPath = await writeJsonAtomic(path.join(resolved.storageRoot, 'runtime-manifest.json'), {
    version: CONTENT_RUNTIME_VERSION,
    createdAt: new Date().toISOString(),
    paths: { pythonPath: after.paths.pythonPath, ffmpegPath: after.paths.ffmpegPath, chromePath: after.chrome?.path || null },
    packagePins: PYTHON_PACKAGES,
    provenance: resolved.provenance,
    lock: metadata.lock,
    notices: metadata.notices,
    actions: actions.map(({ kind, status, path: stagedPath, bytes, sha256: digest }) => ({ kind, status, path: stagedPath || null, bytes: bytes || null, sha256: digest || null })),
  });
  return { ...after, repair: { attempted: true, actions, metadata, manifestPath } };
}

/** Alias with startup-friendly naming. */
export const ensureContentRuntime = repairContentRuntime;

export const contentRuntimeManifest = Object.freeze({
  version: CONTENT_RUNTIME_VERSION,
  provenanceVersion: CONTENT_RUNTIME_PROVENANCE_VERSION,
  packagePins: PYTHON_PACKAGES,
  lockPath: DEFAULT_LOCK_PATH,
  noticesPath: DEFAULT_NOTICES_PATH,
  scripts: BACKEND_SCRIPTS,
});
