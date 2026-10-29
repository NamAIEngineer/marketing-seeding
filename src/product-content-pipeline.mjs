import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeContentRuntime } from './product-content-runtime.mjs';

/**
 * Local product to content pipeline.
 *
 * This module is deliberately independent from the publishing service. It
 * reads bounded source snapshots, binds every claim to a source hash, checks
 * product assets before handing them to ffmpeg, and writes only local
 * artifacts. Remote research uses the existing nodriver and Crawl4AI IPC
 * workers; fixture mode is an explicit offline adapter for deterministic
 * end-to-end tests.
 */

export const PRODUCT_CONTENT_PIPELINE_VERSION = 1;
export const PIPELINE_STATUSES = Object.freeze(['SUCCEEDED', 'FAILED']);
export const PIPELINE_FAILURE_CODES = Object.freeze([
  'INVALID_INPUT',
  'NO_SOURCE_EVIDENCE',
  'RESEARCH_BACKEND_UNAVAILABLE',
  'RESEARCH_FAILED',
  'REMOTE_SOURCE_BLOCKED',
  'ASSET_MISSING',
  'ASSET_INVALID',
  'MEDIA_BACKEND_UNAVAILABLE',
  'MEDIA_RENDER_FAILED',
  'MEDIA_OUTPUT_INVALID',
]);

const MAX_SOURCE_BYTES = 2_000_000;
const MAX_SOURCE_COUNT = 8;
const MAX_ASSET_COUNT = 8;
const MAX_CLAIMS = 12;
const MAX_COPY_CHARS = 2_800;
const MAX_REPORT_BYTES = 1_500_000;
const DEFAULT_DURATION_SECONDS = 3;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRAWL4AI_SCRIPT = path.join(ROOT, 'scripts', 'crawl4ai_extract.py');
const NODRIVER_SCRIPT = path.join(ROOT, 'scripts', 'nodriver_fetcher.py');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ppm', '.pgm', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const CHANNEL_LIMITS = Object.freeze({
  linkedin: 3_000,
  threads: 500,
  x: 280,
  twitter: 280,
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sha256Buffer = (value) => createHash('sha256').update(value).digest('hex');

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function clean(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function required(value, field, max = 500) {
  const result = clean(value, max);
  if (!result) throw new PipelineError('INVALID_INPUT', `${field} is required`, 'input');
  if (String(value).length > max) throw new PipelineError('INVALID_INPUT', `${field} exceeds ${max} characters`, 'input');
  return result;
}

function safeId(value, field) {
  const result = required(value, field, 120);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(result)) {
    throw new PipelineError('INVALID_INPUT', `${field} contains unsupported characters`, 'input');
  }
  return result;
}

function asArray(value, field, max) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PipelineError('INVALID_INPUT', `${field} must contain at least one item`, 'input');
  }
  if (value.length > max) throw new PipelineError('INVALID_INPUT', `${field} exceeds ${max} items`, 'input');
  return value;
}

export class PipelineError extends Error {
  constructor(code, message, stage, details = null) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
    this.stage = stage;
    this.details = details;
  }
}

async function realpathWithin(root, candidate, field) {
  const resolvedCandidate = path.resolve(root, candidate);
  let realRoot;
  let realCandidate;
  try {
    [realRoot, realCandidate] = await Promise.all([fs.realpath(root), fs.realpath(resolvedCandidate)]);
  } catch (error) {
    throw new PipelineError(field === 'asset' ? 'ASSET_MISSING' : 'RESEARCH_FAILED', `${field} path does not exist`, field, { cause: error.code || 'ENOENT' });
  }
  const relative = path.relative(realRoot, realCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PipelineError(field === 'asset' ? 'ASSET_INVALID' : 'RESEARCH_FAILED', `${field} path escapes product repository`, field);
  }
  return realCandidate;
}

async function readBounded(filePath, maxBytes = MAX_SOURCE_BYTES) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new PipelineError('RESEARCH_FAILED', 'source is not a regular file', 'research');
  if (stat.size > maxBytes) throw new PipelineError('RESEARCH_FAILED', 'source exceeds byte bound', 'research', { bytes: stat.size, maxBytes });
  const data = await fs.readFile(filePath);
  return { data, stat };
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function extractFixtureText(raw, fileName) {
  const input = String(raw);
  const html = /<\/?(?:html|body|article|main|section|h[1-6]|p|title|div)\b/i.test(input);
  if (html) {
    const title = decodeEntities((input.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' '));
    const withoutNoise = input
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    const text = decodeEntities(withoutNoise).replace(/\s+/g, ' ').trim();
    return { title: clean(title || path.basename(fileName, path.extname(fileName)), 240), text: clean(text, 8_000), format: 'html' };
  }
  try {
    const parsed = JSON.parse(input);
    const values = [];
    const collect = (value) => {
      if (typeof value === 'string') values.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(parsed);
    return { title: path.basename(fileName, path.extname(fileName)), text: clean(values.join(' '), 8_000), format: 'json' };
  } catch {
    return { title: path.basename(fileName, path.extname(fileName)), text: clean(input, 8_000), format: 'text' };
  }
}

function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((value) => clean(value, 600))
    .filter(Boolean)
    .slice(0, MAX_CLAIMS);
}

function fixtureEvidence({ source, filePath, data, extracted }) {
  const contentHash = sha256Buffer(data);
  const sourceId = `source-${contentHash.slice(0, 20)}`;
  const evidenceId = `evidence-${contentHash.slice(0, 20)}`;
  return {
    sourceId,
    evidenceId,
    locator: clean(source.label || source.path || filePath, 500),
    relativePath: source.path ? source.path.replaceAll('\\', '/') : path.basename(filePath),
    sourceType: 'local_fixture',
    title: extracted.title,
    sha256: contentHash,
    evidenceHash: sha256(`${sourceId}\n${extracted.text}`),
    excerpt: clean(extracted.text, 480),
    text: extracted.text,
    format: extracted.format,
  };
}

function normalizeExternalEvidence(source, result, extracted) {
  const contentHash = String(result.contentHash || sha256(result.html || ''));
  const sourceId = `source-${contentHash.slice(0, 20)}`;
  return {
    sourceId,
    evidenceId: `evidence-${contentHash.slice(0, 20)}`,
    locator: clean(result.finalUrl || source.url, 1000),
    relativePath: null,
    sourceType: 'public_remote',
    title: extracted.title,
    sha256: contentHash,
    evidenceHash: sha256(`${sourceId}\n${extracted.text}`),
    excerpt: clean(extracted.text, 480),
    text: extracted.text,
    format: extracted.format,
    observedHttpStatus: result.observedHttpStatus ?? 'UNKNOWN',
    fetcherRevision: result.fetcherRevision || null,
    extractorRevision: result.extractorRevision || null,
  };
}

function normalizeMode(value) {
  const mode = String(value || 'FIXTURE').toUpperCase();
  if (!['FIXTURE', 'LOCAL', 'PRODUCTION'].includes(mode)) throw new PipelineError('INVALID_INPUT', `unsupported mode: ${mode}`, 'input');
  return mode;
}

function invokeJsonWorker(script, payload, { pythonPath = 'python3', timeoutMs = 30_000, maxOutputBytes = 2_500_000, environment = {} } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(pythonPath, [script], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH || '', PYTHONUNBUFFERED: '1', ...environment }
    });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      finish(new PipelineError('RESEARCH_FAILED', 'research worker timed out', 'research'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(0, maxOutputBytes); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(0, 8_000); });
    child.on('error', (error) => finish(new PipelineError('RESEARCH_BACKEND_UNAVAILABLE', `research worker unavailable: ${error.code || error.message}`, 'research')));
    child.on('close', (code) => {
      if (settled) return;
      let value;
      try { value = JSON.parse(stdout.trim()); } catch {
        finish(new PipelineError('RESEARCH_FAILED', `research worker returned invalid JSON (exit ${code})`, 'research', { stderr: clean(stderr, 800) }));
        return;
      }
      finish(null, value);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function researchLocal(source, root, mode, options) {
  const filePath = await realpathWithin(root, required(source.path, 'source.path', 1_000), 'source');
  if (mode === 'FIXTURE' || options.localBackend === 'fixture') {
    const { data } = await readBounded(filePath);
    const extracted = extractFixtureText(data.toString('utf8'), filePath);
    if (!extracted.text) throw new PipelineError('NO_SOURCE_EVIDENCE', 'local source contains no readable text', 'research');
    return fixtureEvidence({ source, filePath, data, extracted });
  }
  const { data } = await readBounded(filePath);
  const contentHash = sha256Buffer(data);
  let result;
  try {
    result = await invokeJsonWorker(options.extractorScript || CRAWL4AI_SCRIPT, {
      contractVersion: 1,
      jobId: `pipeline-${contentHash.slice(0, 12)}`,
      sourceUrl: source.url || `file://${filePath}`,
      finalUrl: source.url || `file://${filePath}`,
      html: data.toString('utf8'),
      contentHash,
    }, options);
  } catch (error) {
    throw error instanceof PipelineError ? error : new PipelineError('RESEARCH_FAILED', error.message, 'research');
  }
  if (result.status !== 'SUCCEEDED' && result.status !== 'PARTIAL') {
    const unavailable = /module|import|not found|unavailable/i.test(String(result.reason || ''));
    throw new PipelineError(unavailable ? 'RESEARCH_BACKEND_UNAVAILABLE' : 'RESEARCH_FAILED', result.reason || 'Crawl4AI extraction failed', 'research', { backend: 'crawl4ai', status: result.status });
  }
  const extracted = extractFixtureText(result.markdown || data.toString('utf8'), filePath);
  if (!extracted.text) throw new PipelineError('NO_SOURCE_EVIDENCE', 'Crawl4AI returned no readable evidence', 'research');
  return { ...fixtureEvidence({ source, filePath, data, extracted }), sourceType: 'crawl4ai_local', extractorRevision: result.extractorRevision || null, coverage: result.coverage || null };
}

async function researchRemote(source, mode, options) {
  if (mode === 'FIXTURE') throw new PipelineError('INVALID_INPUT', 'fixture mode accepts local source paths only', 'research');
  const url = required(source.url, 'source.url', 1_000);
  let fetched;
  try {
    fetched = await invokeJsonWorker(options.fetcherScript || NODRIVER_SCRIPT, { contractVersion: 1, jobId: `pipeline-${sha256(url).slice(0, 12)}`, sourceUrl: url, waitSeconds: options.waitSeconds || 1 }, options);
  } catch (error) {
    throw error instanceof PipelineError ? error : new PipelineError('RESEARCH_FAILED', error.message, 'research');
  }
  if (fetched.status === 'BLOCKED') throw new PipelineError('REMOTE_SOURCE_BLOCKED', fetched.reason || 'public source was blocked', 'research', { url, finalUrl: fetched.finalUrl || null });
  if (fetched.status !== 'SUCCEEDED') {
    const unavailable = /module|import|not found|unavailable/i.test(String(fetched.reason || ''));
    throw new PipelineError(unavailable ? 'RESEARCH_BACKEND_UNAVAILABLE' : 'RESEARCH_FAILED', fetched.reason || 'nodriver fetch failed', 'research', { backend: 'nodriver', status: fetched.status });
  }
  const html = String(fetched.html || '');
  if (!html) throw new PipelineError('NO_SOURCE_EVIDENCE', 'nodriver returned empty HTML', 'research');
  let extracted;
  try {
    const parsed = await invokeJsonWorker(options.extractorScript || CRAWL4AI_SCRIPT, { contractVersion: 1, jobId: fetched.jobId, sourceUrl: url, finalUrl: fetched.finalUrl || url, html, contentHash: fetched.contentHash }, options);
    if (parsed.status !== 'SUCCEEDED' && parsed.status !== 'PARTIAL') throw new PipelineError('RESEARCH_FAILED', parsed.reason || 'Crawl4AI extraction failed', 'research');
    extracted = extractFixtureText(parsed.markdown || html, url);
    if (!extracted.text) throw new PipelineError('NO_SOURCE_EVIDENCE', 'Crawl4AI returned no readable evidence', 'research');
    return normalizeExternalEvidence(source, { ...fetched, extractorRevision: parsed.extractorRevision }, extracted);
  } catch (error) {
    throw error instanceof PipelineError ? error : new PipelineError('RESEARCH_FAILED', error.message, 'research');
  }
}

async function researchSources(input, root, mode, options) {
  const sources = asArray(input.sources, 'sources', MAX_SOURCE_COUNT);
  const evidence = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') throw new PipelineError('INVALID_INPUT', 'source must be an object', 'input');
    const current = source.path ? await researchLocal(source, root, mode, options) : await researchRemote(source, mode, options);
    evidence.push(current);
  }
  if (!evidence.length || evidence.every((item) => !item.text)) throw new PipelineError('NO_SOURCE_EVIDENCE', 'no source evidence was produced', 'research');
  return evidence;
}

async function verifyAssets(input, root) {
  const assets = asArray(input.assets, 'assets', MAX_ASSET_COUNT);
  const verified = [];
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') throw new PipelineError('INVALID_INPUT', 'asset must be an object', 'input');
    const filePath = await realpathWithin(root, required(asset.path, 'asset.path', 1_000), 'asset');
    const { data, stat } = await readBounded(filePath, 128 * 1024 * 1024);
    const extension = path.extname(filePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)) {
      throw new PipelineError('ASSET_INVALID', `unsupported product asset type: ${extension || 'unknown'}`, 'asset');
    }
    verified.push({
      path: filePath,
      relativePath: path.relative(root, filePath).replaceAll('\\', '/'),
      name: clean(asset.name || path.basename(filePath), 240),
      mediaType: IMAGE_EXTENSIONS.has(extension) ? (extension === '.ppm' ? 'image/x-portable-pixmap' : `image/${extension.slice(1)}`) : `video/${extension.slice(1)}`,
      extension,
      bytes: stat.size,
      sha256: sha256Buffer(data),
    });
  }
  return verified;
}

function buildGroundedReport({ product, campaign, evidence, assets, runId, generatedAt }) {
  const claims = [];
  const seen = new Set();
  for (const source of evidence) {
    for (const sentence of sentences(source.text)) {
      const normalized = sentence.toLocaleLowerCase('en-US');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      claims.push({ id: `claim-${sha256(sentence).slice(0, 16)}`, text: sentence, evidenceRefs: [source.evidenceId], sourceLocator: source.locator });
      if (claims.length >= MAX_CLAIMS) break;
    }
    if (claims.length >= MAX_CLAIMS) break;
  }
  if (!claims.length) throw new PipelineError('NO_SOURCE_EVIDENCE', 'sources contained no sentence-level evidence', 'report');
  return {
    contractVersion: PRODUCT_CONTENT_PIPELINE_VERSION,
    runId,
    generatedAt,
    status: 'grounded',
    product: { id: product.id, name: product.name },
    campaign: { id: campaign.id, name: campaign.name || null },
    method: 'deterministic evidence-bound extraction',
    claims,
    sources: evidence.map(({ text: _text, ...item }) => item),
    assets,
    constraints: ['No metrics, permalink, engagement, or performance result was generated.', 'Every claim references a source evidence ID.'],
  };
}

function buildChannelCopy({ product, campaign, target, report, evidence }) {
  const channel = required(target.channel, 'target.channel', 80).toLowerCase();
  const limit = CHANNEL_LIMITS[channel];
  if (!limit) throw new PipelineError('INVALID_INPUT', `unsupported channel: ${channel}`, 'copy');
  const claimText = report.claims.slice(0, channel === 'x' || channel === 'twitter' ? 1 : 2).map((claim) => claim.text).join(' ');
  const sourceNames = evidence.slice(0, 2).map((item) => item.title || item.locator).join(', ');
  const cta = clean(target.callToAction || campaign.callToAction || 'Inspect the evidence.', 240);
  let content = `${product.name}: ${claimText} ${cta} Evidence: ${sourceNames}.`;
  if (content.length > limit) content = `${content.slice(0, limit - 1).replace(/\s+\S*$/, '').trim()}…`;
  if (!content.trim()) throw new PipelineError('NO_SOURCE_EVIDENCE', `copy for ${channel} is empty`, 'copy');
  return {
    version: PRODUCT_CONTENT_PIPELINE_VERSION,
    targetId: safeId(target.id, 'target.id'),
    channel,
    content,
    claimIds: report.claims.slice(0, channel === 'x' || channel === 'twitter' ? 1 : 2).map((claim) => claim.id),
    evidenceRefs: report.claims.slice(0, channel === 'x' || channel === 'twitter' ? 1 : 2).flatMap((claim) => claim.evidenceRefs),
    status: 'draft',
    constraints: ['Draft only. No permalink or metrics supplied.'],
  };
}

function commandResult(binary, argv, { cwd, timeoutMs = 60_000, maxOutputBytes = 12_000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(binary, argv, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '' } });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      finish(new PipelineError('MEDIA_RENDER_FAILED', 'media renderer timed out', 'media'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(0, maxOutputBytes); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(0, maxOutputBytes); });
    child.on('error', (error) => finish(new PipelineError('MEDIA_BACKEND_UNAVAILABLE', `ffmpeg unavailable: ${error.code || error.message}`, 'media')));
    child.on('close', (code, signal) => finish(null, { code, signal, stdout, stderr }));
  });
}

async function renderMp4(asset, outputPath, options) {
  const ffmpeg = String(options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg');
  const duration = Math.min(30, Math.max(1, Number(options.durationSeconds || DEFAULT_DURATION_SECONDS)));
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (IMAGE_EXTENSIONS.has(asset.extension)) {
    args.push('-loop', '1', '-i', asset.path, '-t', String(duration), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-r', '30');
  } else {
    args.push('-i', asset.path, '-t', String(duration), '-r', '30');
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath);
  let result;
  try { result = await commandResult(ffmpeg, args, { cwd: path.dirname(asset.path), timeoutMs: options.mediaTimeoutMs || 90_000 }); }
  catch (error) { throw error instanceof PipelineError ? error : new PipelineError('MEDIA_RENDER_FAILED', error.message, 'media'); }
  if (result.code !== 0) throw new PipelineError('MEDIA_RENDER_FAILED', 'ffmpeg failed to render MP4', 'media', { exitCode: result.code, stderr: clean(result.stderr, 1_000) });
  let data;
  try { data = await fs.readFile(outputPath); } catch { throw new PipelineError('MEDIA_OUTPUT_INVALID', 'ffmpeg did not create an MP4 output', 'media'); }
  if (data.length < 128 || !data.includes(Buffer.from('ftyp')) || !data.includes(Buffer.from('moov'))) throw new PipelineError('MEDIA_OUTPUT_INVALID', 'rendered output is not a playable MP4 container', 'media', { bytes: data.length });
  return { path: outputPath, bytes: data.length, sha256: sha256Buffer(data), durationSeconds: duration, renderer: ffmpeg };
}

async function writeJson(filePath, value) {
  const encoded = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(encoded) > MAX_REPORT_BYTES) throw new PipelineError('MEDIA_OUTPUT_INVALID', 'pipeline report exceeds byte bound', 'output');
  await fs.writeFile(filePath, encoded, { mode: 0o600 });
  return filePath;
}

function failureResult(error) {
  const normalized = error instanceof PipelineError ? error : new PipelineError('INVALID_INPUT', error?.message || String(error), 'pipeline');
  return {
    version: PRODUCT_CONTENT_PIPELINE_VERSION,
    status: 'FAILED',
    reportPath: null,
    copyPaths: [],
    mp4Path: null,
    evidence: [],
    failure: { code: PIPELINE_FAILURE_CODES.includes(normalized.code) ? normalized.code : 'INVALID_INPUT', stage: normalized.stage || 'pipeline', message: clean(normalized.message, 500), details: normalized.details || null },
  };
}

/**
 * Run the local research, grounded copy, and MP4 export pipeline.
 *
 * Required input: product {id,name,repositoryPath}, campaign {id}, sources,
 * assets, targets. `mode: "FIXTURE"` is the explicit offline adapter used by
 * tests and local demos. `LOCAL` and `PRODUCTION` call the checked-in
 * Crawl4AI/nodriver workers and return typed failures when dependencies are
 * unavailable. No external publishing or network side effect occurs here.
 */
export async function runProductContentPipeline(input = {}, options = {}) {
  try {
    if (!input || typeof input !== 'object') throw new PipelineError('INVALID_INPUT', 'pipeline input must be an object', 'input');
    const product = input.product || {};
    const campaign = input.campaign || {};
    const productId = safeId(product.id, 'product.id');
    const productName = required(product.name, 'product.name', 240);
    const campaignId = safeId(campaign.id, 'campaign.id');
    const repositoryPath = await fs.realpath(path.resolve(required(product.repositoryPath, 'product.repositoryPath', 1_000)));
    const repositoryStat = await fs.stat(repositoryPath);
    if (!repositoryStat.isDirectory()) throw new PipelineError('INVALID_INPUT', 'product.repositoryPath must be a directory', 'input');
    const mode = normalizeMode(input.mode || options.mode);
    // Runtime knobs may be supplied either in the API options object or in
    // the request envelope. Keep one bounded adapter context for both worker
    // and renderer selection.
    const runtimeOptions = { ...options, ...input };
    let runtime = null;
    if (mode !== 'FIXTURE' && runtimeOptions.localBackend !== 'fixture') {
      runtime = await probeContentRuntime({
        mode,
        paths: runtimeOptions.contentRuntimePaths || runtimeOptions.contentRuntime?.paths || null,
        storageRoot: runtimeOptions.contentRuntimeStorageRoot,
        resourcesDir: runtimeOptions.contentRuntimeResourcesDir,
        env: runtimeOptions.environment || process.env,
        timeoutMs: Math.min(30_000, Number(runtimeOptions.runtimeProbeTimeoutMs) || 30_000),
      });
      if (!runtime.ready) {
        const runtimeFailure = runtime.failure || { code: 'CONTENT_RUNTIME_UNAVAILABLE', message: 'content runtime is unavailable' };
        throw new PipelineError(runtimeFailure.code, runtimeFailure.message, 'runtime', runtimeFailure.details || runtime);
      }
      runtimeOptions.pythonPath = runtime.python?.path || runtime.paths.pythonPath;
      runtimeOptions.ffmpegPath = runtime.ffmpeg?.path || runtime.paths.ffmpegPath;
      runtimeOptions.extractorScript = runtime.paths.extractorScript;
      runtimeOptions.fetcherScript = runtime.paths.fetcherScript;
      runtimeOptions.environment = {
        PATH: runtime.paths.pathEnv,
        ...(runtimeOptions.environment || {}),
        ...(runtime.chrome?.path ? { SEEDING_NODRIVER_CHROME: runtime.chrome.path } : {}),
      };
    }
    const sources = asArray(input.sources, 'sources', MAX_SOURCE_COUNT);
    const targets = asArray(input.targets, 'targets', MAX_ASSET_COUNT);
    const assets = asArray(input.assets, 'assets', MAX_ASSET_COUNT);
    const runId = safeId(input.runId || `run-${sha256(stable({ productId, campaignId, sources, targets, assets })).slice(0, 16)}`, 'runId');
    const generatedAt = options.now ? new Date(options.now()).toISOString() : new Date().toISOString();
    const outputDir = path.resolve(String(input.outputDir || path.join(os.tmpdir(), 'marketing-seeding-content', runId)));
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
    const evidence = await researchSources({ sources }, repositoryPath, mode, runtimeOptions);
    const verifiedAssets = await verifyAssets({ assets }, repositoryPath);
    const report = buildGroundedReport({ product: { id: productId, name: productName }, campaign: { id: campaignId, name: clean(campaign.name, 240), callToAction: clean(campaign.callToAction, 240) }, evidence, assets: verifiedAssets.map(({ path: _path, ...item }) => item), runId, generatedAt });
    const reportPath = await writeJson(path.join(outputDir, `${runId}-report.json`), report);
    const copyPaths = [];
    const copies = [];
    for (const target of targets) {
      const copy = buildChannelCopy({ product: { id: productId, name: productName }, campaign, target, report, evidence });
      const copyPath = await writeJson(path.join(outputDir, `${runId}-${copy.targetId}-copy.json`), copy);
      copyPaths.push(copyPath);
      copies.push(copy);
    }
    const media = await renderMp4(verifiedAssets[0], path.join(outputDir, `${runId}-product.mp4`), runtimeOptions);
    return {
      version: PRODUCT_CONTENT_PIPELINE_VERSION,
      status: 'SUCCEEDED',
      runId,
      reportPath,
      copyPaths,
      mp4Path: media.path,
      report,
      copies,
      media,
      evidence: evidence.map(({ text: _text, ...item }) => item),
      runtime: runtime ? {
        status: runtime.status,
        paths: runtime.paths,
        python: runtime.python,
        ffmpeg: runtime.ffmpeg,
        chrome: runtime.chrome,
      } : null,
      externalSideEffects: false,
    };
  } catch (error) {
    return failureResult(error);
  }
}

export const productContentPipelineInternals = Object.freeze({
  extractFixtureText,
  buildGroundedReport,
  buildChannelCopy,
  normalizeMode,
});
