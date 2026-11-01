import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

/**
 * Official Camoufox browser release metadata.  This is deliberately pinned
 * independently of GitHub's release API: pkgman currently discovers releases
 * through that API, which may return 403 on a clean host.  The assets below
 * are the corresponding files published by daijro/camoufox for the pinned
 * npm package's browser pin.
 */
export const CAMOUFOX_OFFICIAL_RELEASE = Object.freeze({
  schema: 1,
  repository: 'daijro/camoufox',
  tag: 'v156.0.1-beta.36',
  browserVersion: '156.0.1',
  browserBuild: 'beta.36',
  commit: '7a4ac0d4dca2dfdeb277f521824a26efb0b6a7b6',
  manifestUrl: 'https://github.com/daijro/camoufox/releases/download/v156.0.1-beta.36/manifest.json',
  assets: Object.freeze({
    'darwin-arm64': Object.freeze({
      url: 'https://github.com/daijro/camoufox/releases/download/v156.0.1-beta.36/camoufox-156.0.1-beta.36-mac.arm64.zip',
      sha256: '0ad5663e40f4a2a836e28747256b79f39a5105905f1b244139a7a391f85fda32',
    }),
    'darwin-x64': Object.freeze({
      url: 'https://github.com/daijro/camoufox/releases/download/v156.0.1-beta.36/camoufox-156.0.1-beta.36-mac.x86_64.zip',
      sha256: 'abe133d2b1c7a8afe5a6af5f44adfd3169b16d4cc2268e99a81a41a6853f5782',
    }),
  }),
});

const OFFICIAL_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
// Camoufox bundles the full browser framework; arm64 release archives are
// large but bounded.  Keep a hard upper bound to prevent an untrusted response
// from filling the app runtime while allowing the pinned official asset.
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1000, 2000]);
// A pinned Camoufox archive is about 1.2 GB.  Keep a bounded but practical
// wall-clock budget for slow clean-host links; the stream path still enforces
// the byte cap and aborts after this deadline.
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const typed = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });
function managedPath(candidate, parent) {
  const child = path.resolve(String(candidate || ''));
  const base = path.resolve(String(parent || ''));
  const relative = path.relative(base, child);
  return relative === '' || (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function camoufoxOfficialAsset({ platform = process.platform, arch = process.arch } = {}) {
  const key = `${platform}-${arch === 'x64' ? 'x64' : arch}`;
  const asset = CAMOUFOX_OFFICIAL_RELEASE.assets[key];
  if (!asset) throw typed('CAMOUFOX_OFFICIAL_RELEASE_UNSUPPORTED', `Pinned Camoufox release has no official asset for ${key}`, { platform, arch });
  return Object.freeze({ ...asset, platform, arch, key, tag: CAMOUFOX_OFFICIAL_RELEASE.tag, commit: CAMOUFOX_OFFICIAL_RELEASE.commit, browserVersion: CAMOUFOX_OFFICIAL_RELEASE.browserVersion, browserBuild: CAMOUFOX_OFFICIAL_RELEASE.browserBuild });
}

export function verifyCamoufoxArchiveBytes(bytes, { expectedSha256 } = {}) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!value.length) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_EMPTY', 'Camoufox archive is empty');
  const expected = String(expectedSha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw typed('CAMOUFOX_OFFICIAL_CHECKSUM_INVALID', 'Pinned Camoufox archive digest is invalid');
  const actual = createHash('sha256').update(value).digest('hex');
  if (actual !== expected) throw typed('CAMOUFOX_OFFICIAL_CHECKSUM_MISMATCH', 'Camoufox archive SHA-256 does not match the pinned official digest', { expected, actual });
  return Object.freeze({ bytes: value, sha256: actual });
}

function officialUrl(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { throw typed('CAMOUFOX_OFFICIAL_URL_INVALID', 'Pinned Camoufox URL is invalid'); }
  if (parsed.protocol !== 'https:' || !OFFICIAL_HOSTS.has(parsed.hostname)) throw typed('CAMOUFOX_OFFICIAL_HOST_REJECTED', `Camoufox download host is not official: ${parsed.hostname}`);
  if (!parsed.pathname.startsWith('/daijro/camoufox/releases/download/')) throw typed('CAMOUFOX_OFFICIAL_PATH_REJECTED', 'Camoufox download path is not the pinned official release');
  if (!parsed.pathname.includes(`/${CAMOUFOX_OFFICIAL_RELEASE.tag}/`)) throw typed('CAMOUFOX_OFFICIAL_VERSION_MISMATCH', 'Camoufox download is not the pinned release tag');
  return parsed;
}

function responseUrl(response, requested) {
  const value = String(response?.url || requested);
  let parsed;
  try { parsed = new URL(value); } catch { throw typed('CAMOUFOX_OFFICIAL_REDIRECT_INVALID', 'Camoufox response URL is invalid'); }
  if (!OFFICIAL_HOSTS.has(parsed.hostname)) throw typed('CAMOUFOX_OFFICIAL_REDIRECT_REJECTED', `Camoufox redirected to an untrusted host: ${parsed.hostname}`);
  return parsed;
}

async function responseBytes(response, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const contentLength = Number(response?.headers?.get?.('content-length') || response?.headers?.get?.('Content-Length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_TOO_LARGE', 'Camoufox archive exceeds the bounded download size');
  if (!response?.body || typeof response.body[Symbol.asyncIterator] !== 'function') throw typed('CAMOUFOX_OFFICIAL_RESPONSE_INVALID', 'Camoufox response has no streaming body');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const value = Buffer.from(chunk || []);
    size += value.length;
    if (size > maxBytes) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_TOO_LARGE', 'Camoufox archive exceeds the bounded download size');
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks, size);
  if (bytes.byteLength === 0) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_EMPTY', 'Camoufox archive is empty');
  return bytes;
}

/** Stream an HTTPS response into a mode-600 file while hashing and enforcing
 * the archive cap.  The production path never buffers the 1.2 GB browser ZIP
 * in JS heap memory. */
async function responseFile(response, destination, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const contentLength = Number(response?.headers?.get?.('content-length') || response?.headers?.get?.('Content-Length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_TOO_LARGE', 'Camoufox archive exceeds the bounded download size');
  if (!response?.body && typeof response?.arrayBuffer !== 'function') throw typed('CAMOUFOX_OFFICIAL_RESPONSE_INVALID', 'Camoufox response has no readable body');
  const handle = await open(destination, 'w', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  const append = async (chunk) => {
    const value = Buffer.from(chunk || []);
    bytes += value.length;
    if (bytes > maxBytes) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_TOO_LARGE', 'Camoufox archive exceeds the bounded download size');
    hash.update(value);
    if (value.length) await handle.write(value);
  };
  try {
    if (typeof response.body?.getReader === 'function') {
      const reader = response.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        await append(next.value);
      }
    } else if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
      for await (const chunk of response.body) await append(chunk);
    } else {
      await append(await response.arrayBuffer());
    }
  } finally {
    await handle.close();
    await chmod(destination, 0o600).catch(() => {});
  }
  if (!bytes) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_EMPTY', 'Camoufox archive is empty');
  return Object.freeze({ bytes, sha256: hash.digest('hex'), archivePath: destination });
}

async function fetchOfficialArchive(asset, { fetchImpl = globalThis.fetch, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof fetchImpl !== 'function') throw typed('CAMOUFOX_OFFICIAL_FETCH_UNAVAILABLE', 'No HTTPS fetch implementation is available');
  const requested = officialUrl(asset.url);
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetchImpl(requested.href, { method: 'GET', redirect: 'follow', signal: controller.signal });
      responseUrl(response, requested.href);
      const status = Number(response.status || 0);
      if (status === 403) throw typed('CAMOUFOX_OFFICIAL_HTTP_403', 'Official Camoufox release download returned HTTP 403');
      if (status === 404) throw typed('CAMOUFOX_OFFICIAL_HTTP_404', 'Pinned Camoufox release asset was not found');
      if (status === 429 || status >= 500) {
        throw typed(status === 429 ? 'CAMOUFOX_OFFICIAL_HTTP_429' : 'CAMOUFOX_OFFICIAL_HTTP_5XX', `Official Camoufox release download returned HTTP ${status}`, { retryable: true });
      }
      if (!response.ok || status < 200 || status >= 300) throw typed('CAMOUFOX_OFFICIAL_HTTP_ERROR', `Official Camoufox release download returned HTTP ${status}`);
      return await responseBytes(response, { maxBytes });
    } catch (error) {
      lastError = typeof error?.code === 'string' && error.code.startsWith('CAMOUFOX_')
        ? error
        : typed('CAMOUFOX_OFFICIAL_NETWORK_UNAVAILABLE', 'Official Camoufox release download was unavailable', { cause: error });
      const retryable = lastError.retryable === true || lastError.code === 'CAMOUFOX_OFFICIAL_NETWORK_UNAVAILABLE';
      if (!retryable || attempt >= retryDelaysMs.length) break;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(retryDelaysMs[attempt]) || 0)));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError || typed('CAMOUFOX_OFFICIAL_NETWORK_UNAVAILABLE', 'Official Camoufox release download was unavailable');
}

async function fetchOfficialArchiveToFile(asset, destination, { fetchImpl = globalThis.fetch, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof fetchImpl !== 'function') throw typed('CAMOUFOX_OFFICIAL_FETCH_UNAVAILABLE', 'No HTTPS fetch implementation is available');
  const requested = officialUrl(asset.url);
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetchImpl(requested.href, { method: 'GET', redirect: 'follow', signal: controller.signal });
      responseUrl(response, requested.href);
      const status = Number(response.status || 0);
      if (status === 403) throw typed('CAMOUFOX_OFFICIAL_HTTP_403', 'Official Camoufox release download returned HTTP 403');
      if (status === 404) throw typed('CAMOUFOX_OFFICIAL_HTTP_404', 'Pinned Camoufox release asset was not found');
      if (status === 429 || status >= 500) throw typed(status === 429 ? 'CAMOUFOX_OFFICIAL_HTTP_429' : 'CAMOUFOX_OFFICIAL_HTTP_5XX', `Official Camoufox release download returned HTTP ${status}`, { retryable: true });
      if (!response.ok || status < 200 || status >= 300) throw typed('CAMOUFOX_OFFICIAL_HTTP_ERROR', `Official Camoufox release download returned HTTP ${status}`);
      return await responseFile(response, destination, { maxBytes });
    } catch (error) {
      lastError = typeof error?.code === 'string' && error.code.startsWith('CAMOUFOX_')
        ? error
        : typed('CAMOUFOX_OFFICIAL_NETWORK_UNAVAILABLE', 'Official Camoufox release download was unavailable', { cause: error });
      const retryable = lastError.retryable === true || lastError.code === 'CAMOUFOX_OFFICIAL_NETWORK_UNAVAILABLE';
      if (!retryable || attempt >= retryDelaysMs.length) break;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(retryDelaysMs[attempt]) || 0)));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError || typed('CAMOUFOX_OFFICIAL_NETWORK_UNAVAILABLE', 'Official Camoufox release download was unavailable');
}

export async function downloadOfficialCamoufoxArchive(asset, options = {}) {
  return fetchOfficialArchive(asset, options);
}

function validateZipEntries(listing) {
  for (const raw of String(listing || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const entry = raw.replaceAll('\\', '/');
    if (entry.startsWith('/') || /^[A-Za-z]:\//.test(entry) || entry.split('/').includes('..')) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_PATH_UNSAFE', 'Camoufox archive contains an unsafe extraction path');
  }
}

async function findExecutable(root) {
  const queue = [root];
  let examined = 0;
  while (queue.length) {
    const current = queue.shift();
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++examined > 100_000) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_TOO_LARGE', 'Camoufox archive contains too many entries');
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(candidate);
      else if (entry.isFile() && /Camoufox\.app[\\/]Contents[\\/]MacOS[\\/]camoufox$/.test(candidate)) return candidate;
    }
  }
  throw typed('CAMOUFOX_OFFICIAL_LAYOUT_INVALID', 'Pinned Camoufox archive has no Camoufox.app executable');
}

/**
 * Download and install the pinned browser directly from the official GitHub
 * release asset.  `downloadImpl` is injectable for deterministic tests; the
 * production default performs HTTPS fetch, bounded retries, SHA-256 checking,
 * safe ZIP extraction, and executable layout validation.
 */
export async function provisionOfficialCamoufoxBrowser({ cacheHome, platform = process.platform, arch = process.arch, assetOverride = null, fetchImpl = globalThis.fetch, downloadImpl = null, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, execFileImpl = execFileAsync } = {}) {
  const root = path.resolve(String(cacheHome || ''));
  if (!root) throw typed('CAMOUFOX_OFFICIAL_CACHE_REQUIRED', 'Camoufox managed cache root is required');
  const asset = assetOverride || camoufoxOfficialAsset({ platform, arch });
  await mkdir(root, { recursive: true, mode: 0o700 });
  const installRoot = path.join(root, `camoufox-${asset.browserVersion}-${asset.browserBuild}-${asset.arch}`);
  const installMarker = path.join(installRoot, 'camoufox-official-release.json');
  try {
    const existing = JSON.parse(await readFile(installMarker, 'utf8'));
    if (existing?.tag === CAMOUFOX_OFFICIAL_RELEASE.tag && existing?.archiveSha256 === asset.sha256 && managedPath(existing.browserPath, root) && managedPath(existing.executablePath, existing.browserPath) && await access(existing.executablePath, fsConstants.X_OK).then(() => true).catch(() => false)) {
      return Object.freeze({ browserPath: existing.browserPath, executablePath: existing.executablePath, cacheRoot: root, source: 'official-github-release', archiveSha256: existing.archiveSha256, releaseTag: existing.tag, browserVersion: existing.browserVersion });
    }
  } catch { /* no verified managed install yet */ }
  const work = path.join(root, `.official-${randomUUID()}`);
  const archivePath = path.join(work, 'camoufox.zip');
  const extracted = path.join(work, 'extracted');
  try {
    await mkdir(work, { recursive: true, mode: 0o700 });
    let downloaded;
    if (typeof downloadImpl === 'function') {
      const archive = await downloadImpl({ asset, release: CAMOUFOX_OFFICIAL_RELEASE, maxBytes });
      const bytes = Buffer.isBuffer(archive) ? archive : Buffer.from(archive || []);
      if (bytes.length > maxBytes) throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_TOO_LARGE', 'Camoufox archive exceeds the bounded download size');
      const verified = verifyCamoufoxArchiveBytes(bytes, { expectedSha256: asset.sha256 });
      await writeFile(archivePath, verified.bytes, { mode: 0o600 });
      downloaded = { archivePath, bytes: verified.bytes.length, sha256: verified.sha256 };
    } else {
      downloaded = await fetchOfficialArchiveToFile(asset, archivePath, { fetchImpl, retryDelaysMs, timeoutMs, maxBytes });
      if (downloaded.sha256 !== asset.sha256) throw typed('CAMOUFOX_OFFICIAL_CHECKSUM_MISMATCH', 'Camoufox archive SHA-256 does not match the pinned official digest', { expected: asset.sha256, actual: downloaded.sha256 });
    }
    const actualSha256 = downloaded.sha256;
    await mkdir(extracted, { recursive: true, mode: 0o700 });
    let listing;
    try { ({ stdout: listing } = await execFileImpl('unzip', ['-Z1', archivePath], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })); }
    catch (error) { throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_INVALID', 'Camoufox release asset is not a readable ZIP archive', { cause: error }); }
    validateZipEntries(listing);
    try { await execFileImpl('unzip', ['-q', archivePath, '-d', extracted], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 }); }
    catch (error) { throw typed('CAMOUFOX_OFFICIAL_ARCHIVE_INVALID', 'Camoufox release asset could not be extracted', { cause: error }); }
    const executablePath = await findExecutable(extracted);
    const executableStat = await stat(executablePath);
    await access(executablePath, fsConstants.X_OK);
    if (!executableStat.isFile()) throw typed('CAMOUFOX_OFFICIAL_EXECUTABLE_INVALID', 'Camoufox release executable is not a file');
    const appPath = path.dirname(path.dirname(path.dirname(executablePath)));
    const browserPath = path.dirname(appPath);
    const finalPath = installRoot;
    const previousPath = `${finalPath}.previous-${randomUUID()}`;
    await rm(previousPath, { recursive: true, force: true });
    try { await rename(finalPath, previousPath); } catch { /* first install */ }
    try { await rename(extracted, finalPath); } catch (error) {
      try { await rename(previousPath, finalPath); } catch { /* preserve typed failure */ }
      throw typed('CAMOUFOX_OFFICIAL_INSTALL_FAILED', 'Camoufox verified archive could not be installed', { cause: error });
    }
    const relativeExecutable = path.relative(extracted, executablePath);
    const finalExecutable = path.join(finalPath, relativeExecutable);
    const finalAppPath = path.dirname(path.dirname(path.dirname(finalExecutable)));
    const finalBrowserPath = path.dirname(finalAppPath);
    const metadata = { schemaVersion: 1, provider: 'camoufox', source: 'official-github-release', repository: CAMOUFOX_OFFICIAL_RELEASE.repository, tag: CAMOUFOX_OFFICIAL_RELEASE.tag, commit: CAMOUFOX_OFFICIAL_RELEASE.commit, browserVersion: CAMOUFOX_OFFICIAL_RELEASE.browserVersion, browserBuild: CAMOUFOX_OFFICIAL_RELEASE.browserBuild, assetUrl: asset.url, archiveSha256: asset.sha256, observedSha256: actualSha256, browserPath: finalBrowserPath, executablePath: finalExecutable, installedAt: new Date().toISOString() };
    const metadataJson = `${JSON.stringify(metadata)}\n`;
    await writeFile(path.join(finalPath, 'camoufox-official-release.json'), metadataJson, { mode: 0o600 });
    await writeFile(path.join(finalBrowserPath, 'camoufox-official-release.json'), metadataJson, { mode: 0o600 });
    await chmod(finalExecutable, 0o755);
    await rm(previousPath, { recursive: true, force: true });
    return Object.freeze({ browserPath: finalBrowserPath, executablePath: finalExecutable, cacheRoot: root, source: 'official-github-release', archiveSha256: actualSha256, releaseTag: CAMOUFOX_OFFICIAL_RELEASE.tag, browserVersion: CAMOUFOX_OFFICIAL_RELEASE.browserVersion });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export const CAMOUFOX_OFFICIAL_RELEASE_HOSTS = Object.freeze([...OFFICIAL_HOSTS]);
