import { createHash } from 'node:crypto';
import { promises as fs, constants as FS_CONSTANTS } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
export function resolveContentRuntimePaths({ storageRoot, resourcesDir = APP_ROOT, env = process.env, appName, version, pathEnv } = {}) {
  const root = safePath(storageRoot, platformUserRoot({ appName, version }));
  const resources = safePath(resourcesDir, APP_ROOT);
  const envPath = String(pathEnv || env.PATH || process.env.PATH || '');
  const pythonCandidates = [
    { value: env.SEEDING_CONTENT_PYTHON || env.SEEDING_LISTENING_PYTHON, source: 'env' },
    { value: pythonStoragePath(root), source: 'user-storage' },
    { value: path.join(resources, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python'), source: 'app-resources' },
    { value: 'python3', source: 'system-path' },
  ].filter((item) => item.value);
  const ffmpegCandidates = [
    { value: env.SEEDING_CONTENT_FFMPEG || env.FFMPEG_PATH, source: 'env' },
    { value: path.join(root, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), source: 'user-storage' },
    { value: path.join(resources, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), source: 'app-resources' },
    { value: 'ffmpeg', source: 'system-path' },
  ].filter((item) => item.value);
  const pick = (candidates) => candidates[0];
  const chrome = chromeCandidates({ root, resourcesDir: resources, env, envPath });
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
  const [python, ffmpeg] = await Promise.all([
    requirements.python.length
      ? probeFirstCandidate(resolved.pythonCandidates || [{ value: resolved.pythonPath, source: resolved.pythonSource }], ['-c', `import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ is required'; ${requirements.python.map((name) => `import ${name}`).join('; ')}; print('CONTENT_RUNTIME_IMPORTS_OK')`], { pathEnv: resolved.pathEnv, timeoutMs, spawnImpl })
      : Promise.resolve({ status: 'NOT_REQUIRED', path: resolved.pythonPath, imports: [] }),
    requirements.ffmpeg ? probeFirstCandidate(resolved.ffmpegCandidates || [{ value: resolved.ffmpegPath, source: resolved.ffmpegSource }], ['-version'], { pathEnv: resolved.pathEnv, timeoutMs, spawnImpl }) : Promise.resolve({ status: 'NOT_REQUIRED', path: resolved.ffmpegPath }),
  ]);
  let chrome = { status: 'NOT_REQUIRED', path: null };
  if (requirements.chrome) {
    const chromeCandidates = Array.isArray(resolved.chromeCandidates) ? resolved.chromeCandidates : [];
    chrome = chromeCandidates.length
      ? await probeFirstCandidate(chromeCandidates.map((item) => ({ value: item.path, source: item.source || null })), ['--version'], { pathEnv: resolved.pathEnv, timeoutMs, spawnImpl })
      : { status: 'MISSING', path: null, stderr: 'Chrome executable not configured' };
  }
  const missingPython = requirements.python.length > 0 && python.status !== 'READY';
  const missingMedia = requirements.ffmpeg && ffmpeg.status !== 'READY';
  const missingChrome = requirements.chrome && chrome.status !== 'READY';
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
    ffmpeg,
    chrome,
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
export async function repairContentRuntime({ mode = 'LOCAL', storageRoot, resourcesDir, env = process.env, paths = null, repair = false, allowNetwork = false, pythonBootstrap = null, ffmpegSourcePath = null, ffmpegSha256 = null, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS, spawnImpl = spawn } = {}) {
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
  const actions = [];
  if (!before.python || before.python.status !== 'READY') {
    const installed = await installPythonRuntime(resolved, { pythonBootstrap, timeoutMs, allowNetwork, spawnImpl });
    actions.push({ kind: 'python', ...installed });
    if (installed.status === 'BLOCKED' || installed.status === 'FAILED' || installed.status === 'UNAVAILABLE') {
      return { ...before, status: 'BLOCKED', ready: false, failure: installed.failure, repair: { attempted: true, actions, metadata } };
    }
  }
  if (!before.ffmpeg || before.ffmpeg.status !== 'READY') {
    if (!ffmpegSourcePath) return { ...before, status: 'BLOCKED', ready: false, failure: failure('MEDIA_BACKEND_UNAVAILABLE', 'ffmpeg is unavailable and no checksum-pinned binary was supplied', { destination: path.join(resolved.storageRoot, 'bin', 'ffmpeg') }), repair: { attempted: true, actions, metadata } };
    const staged = await stageVerifiedBinary({ sourcePath: ffmpegSourcePath, destinationPath: path.join(resolved.storageRoot, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), expectedSha256: ffmpegSha256 });
    actions.push({ kind: 'ffmpeg', ...staged });
    if (staged.status !== 'STAGED') return { ...before, status: 'BLOCKED', ready: false, failure: staged.failure, repair: { attempted: true, actions, metadata } };
  }
  const stagedFfmpeg = actions.find((action) => action.kind === 'ffmpeg' && action.status === 'STAGED')?.path;
  const afterPaths = resolveContentRuntimePaths({
    storageRoot: resolved.storageRoot,
    resourcesDir: resolved.resourcesDir,
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
  packagePins: PYTHON_PACKAGES,
  lockPath: DEFAULT_LOCK_PATH,
  noticesPath: DEFAULT_NOTICES_PATH,
  scripts: BACKEND_SCRIPTS,
});
