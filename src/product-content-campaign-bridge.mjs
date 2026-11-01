import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Versioned, side-effect-free handoff from the local product content
 * pipeline to the campaign service.
 *
 * The pipeline intentionally writes files outside the campaign store.  This
 * bridge reads those files back, verifies their bytes against the successful
 * in-memory result, then emits the exact service calls needed to stage one
 * media artifact, create one grounded story, and fan out draft variants to
 * each target.  It never registers an artifact, creates a story, queues a
 * post, publishes, or invents a URL/metric.
 */

export const PRODUCT_CONTENT_CAMPAIGN_BRIDGE_VERSION = 1;
export const PRODUCT_CONTENT_BRIDGE_STATUSES = Object.freeze(['READY']);

const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
// Match the pipeline's bounded asset read ceiling. A rendered MP4 can be
// larger than a tiny fixture while remaining a bounded local handoff.
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_REPORT_BYTES = 1_500_000;
const MAX_COPY_BYTES = 256 * 1024;
const MAX_TEXT = 3_000;
// The bridge emits variants for channels accepted by both the local pipeline
// and the campaign service. X/Twitter copies may be produced by the pipeline
// for an export-only workflow, but the current service CHANNELS registry does
// not accept them as campaign drafts, so fail closed here.
const PIPELINE_CHANNELS = new Set(['linkedin', 'threads']);

/** Typed fail-closed bridge error. */
export class ProductContentCampaignBridgeError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ProductContentCampaignBridgeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ProductContentCampaignBridgeError(code, message, details);
}

function text(value, field, { max = 500, required = true } = {}) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (required && !normalized) fail('INVALID_INPUT', `${field} is required`);
  if (normalized.length > max) fail('INVALID_INPUT', `${field} exceeds ${max} characters`);
  return normalized;
}

function id(value, field) {
  const normalized = text(value, field, { max: 160 });
  if (!SAFE_ID.test(normalized)) fail('INVALID_INPUT', `${field} contains unsupported characters`);
  return normalized;
}

function sha(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SHA256.test(normalized)) fail('INVALID_HASH', `${field} must be a SHA-256 digest`);
  return normalized;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function jsonHash(value) {
  return digest(JSON.stringify(value));
}

function canonicalRefs(refs, field) {
  if (!Array.isArray(refs) || refs.length === 0) fail('SOURCE_EVIDENCE_MISSING', `${field} must contain at least one evidence reference`);
  const values = [...new Set(refs.map((item) => text(item, `${field} item`, { max: 240 })))].sort();
  if (!values.length) fail('SOURCE_EVIDENCE_MISSING', `${field} must contain at least one evidence reference`);
  return values;
}

function canonicalSourceRefs(refs, field = 'contentSourceRefs') {
  if (!Array.isArray(refs) || refs.length === 0) fail('SOURCE_EVIDENCE_MISSING', `${field} must contain at least one source`);
  const seen = new Map();
  for (const item of refs) {
    if (!item || typeof item !== 'object') fail('SOURCE_EVIDENCE_INVALID', `${field} entries must be objects`);
    const relativePath = text(item.relativePath, `${field}.relativePath`, { max: 1_000 });
    const sourceSha256 = sha(item.sha256, `${field}.sha256`);
    if (path.isAbsolute(relativePath) || relativePath === '.' || relativePath.startsWith('../') || relativePath.includes('/../') || relativePath.includes('\\..')) {
      fail('SOURCE_EVIDENCE_INVALID', `${field}.relativePath must stay inside productRepo`);
    }
    seen.set(`${relativePath}\u0000${sourceSha256}`, { relativePath, sha256: sourceSha256 });
  }
  return [...seen.values()].sort((left, right) => `${left.relativePath}\u0000${left.sha256}`.localeCompare(`${right.relativePath}\u0000${right.sha256}`));
}

function resolveResult(input) {
  if (input && typeof input === 'object' && !Array.isArray(input) && (input.status || input.reportPath || input.mp4Path || input.report)) return input;
  const result = input?.result || input?.pipelineResult || input?.output;
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('INVALID_INPUT', 'pipeline result is required');
  return result;
}

async function readBounded(filePath, maxBytes, field) {
  const requested = String(filePath || '').trim();
  if (!requested || !path.isAbsolute(requested)) fail('INVALID_OUTPUT_PATH', `${field} must be an absolute path`);
  let info;
  try { info = await fs.stat(requested); } catch (error) {
    fail('STALE_OUTPUT', `${field} does not exist`, { cause: error.code || 'ENOENT', path: requested });
  }
  if (!info.isFile()) fail('STALE_OUTPUT', `${field} is not a regular file`, { path: requested });
  if (info.size > maxBytes) fail('OUTPUT_TOO_LARGE', `${field} exceeds its byte bound`, { bytes: info.size, maxBytes });
  try { return await fs.readFile(requested); } catch (error) {
    fail('STALE_OUTPUT', `${field} could not be read`, { cause: error.code || 'READ_FAILED', path: requested });
  }
}

async function readJsonOutput(filePath, maxBytes, field) {
  const data = await readBounded(filePath, maxBytes, field);
  try { return { data, value: JSON.parse(data.toString('utf8')) }; }
  catch { fail('STALE_OUTPUT', `${field} is not valid JSON`, { path: filePath }); }
}

function assertOutputWithinRoot(filePath, outputRoot, field) {
  const relative = path.relative(outputRoot, path.resolve(filePath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('INVALID_OUTPUT_PATH', `${field} must remain beside the pipeline report`, { path: filePath, outputRoot });
  }
}

async function verifyGroundingSources(productRepo, records) {
  const rootInput = String(productRepo || '').trim();
  if (!rootInput) fail('INVALID_INPUT', 'productRepo is required for source hash verification');
  let root;
  try { root = await fs.realpath(path.resolve(rootInput)); } catch (error) {
    fail('SOURCE_EVIDENCE_INVALID', 'productRepo does not exist', { cause: error.code || 'ENOENT' });
  }
  const verified = [];
  for (const record of records) {
    const candidate = path.resolve(root, record.relativePath);
    let resolved;
    try { resolved = await fs.realpath(candidate); } catch (error) {
      fail('STALE_SOURCE', `grounding source does not exist: ${record.relativePath}`, { cause: error.code || 'ENOENT' });
    }
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('SOURCE_EVIDENCE_INVALID', `grounding source escapes productRepo: ${record.relativePath}`);
    const bytes = await readBounded(resolved, MAX_FILE_BYTES, `grounding source ${record.relativePath}`);
    const actual = digest(bytes);
    if (actual !== record.sha256) fail('STALE_SOURCE', `grounding source hash changed: ${record.relativePath}`, { expected: record.sha256, actual });
    verified.push(record);
  }
  return verified;
}

function requireGroundedEvidence(result) {
  const evidence = result.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) fail('SOURCE_EVIDENCE_MISSING', 'successful result has no evidence');
  const byId = new Map();
  const byPath = new Map();
  for (const item of evidence) {
    if (!item || typeof item !== 'object') fail('SOURCE_EVIDENCE_INVALID', 'evidence entries must be objects');
    const evidenceId = text(item.evidenceId, 'evidence.evidenceId', { max: 180 });
    const relativePath = text(item.relativePath, 'evidence.relativePath', { max: 1_000 });
    const sourceSha256 = sha(item.sha256, `evidence ${evidenceId}.sha256`);
    const evidenceHash = sha(item.evidenceHash, `evidence ${evidenceId}.evidenceHash`);
    if (path.isAbsolute(relativePath) || relativePath === '.' || relativePath.startsWith('../') || relativePath.includes('/../') || relativePath.includes('\\..')) {
      fail('SOURCE_EVIDENCE_INVALID', `evidence ${evidenceId} path must stay inside productRepo`);
    }
    const normalized = { evidenceId, sourceId: text(item.sourceId, `evidence ${evidenceId}.sourceId`, { max: 180 }), relativePath, sha256: sourceSha256, evidenceHash, title: text(item.title || item.locator || relativePath, `evidence ${evidenceId}.title`, { max: 240 }), sourceType: text(item.sourceType || 'local_fixture', `evidence ${evidenceId}.sourceType`, { max: 80 }) };
    if (byId.has(evidenceId) && stable(byId.get(evidenceId)) !== stable(normalized)) fail('AMBIGUOUS_OUTPUT', `duplicate evidenceId ${evidenceId} has conflicting hashes`);
    if (byPath.has(relativePath) && byPath.get(relativePath).sha256 !== sourceSha256) fail('AMBIGUOUS_OUTPUT', `source path ${relativePath} has conflicting hashes`);
    byId.set(evidenceId, normalized);
    byPath.set(relativePath, normalized);
  }
  return { byId, records: [...byId.values()] };
}

function validateReport(result, evidenceIndex, reportFile) {
  const report = result.report;
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail('STALE_REPORT', 'successful result has no grounded report');
  if (report.status !== 'grounded') fail('STALE_REPORT', 'report status is not grounded');
  if (String(report.runId || '') !== String(result.runId || '')) fail('STALE_REPORT', 'report runId does not match pipeline runId');
  if (reportFile && stable(reportFile) !== stable(report)) fail('STALE_REPORT', 'reportPath bytes do not match in-memory report');
  if (!Array.isArray(report.claims) || report.claims.length === 0) fail('SOURCE_EVIDENCE_MISSING', 'grounded report has no claims');
  const claimIds = new Set();
  const claims = report.claims.map((claim, index) => {
    if (!claim || typeof claim !== 'object') fail('SOURCE_EVIDENCE_INVALID', `report claim ${index} is invalid`);
    const claimId = text(claim.id, `report claim ${index}.id`, { max: 180 });
    if (claimIds.has(claimId)) fail('AMBIGUOUS_OUTPUT', `report contains duplicate claim ${claimId}`);
    claimIds.add(claimId);
    const claimText = text(claim.text, `report claim ${claimId}.text`, { max: 1_200 });
    const refs = canonicalRefs(claim.evidenceRefs, `report claim ${claimId}.evidenceRefs`);
    for (const ref of refs) if (!evidenceIndex.byId.has(ref)) fail('SOURCE_EVIDENCE_INVALID', `report claim ${claimId} references unknown evidence ${ref}`);
    return { id: claimId, text: claimText, evidenceRefs: refs, sourceLocator: text(claim.sourceLocator || '', `report claim ${claimId}.sourceLocator`, { max: 500, required: false }) || null };
  });
  const reportSources = Array.isArray(report.sources) ? report.sources : [];
  for (const source of reportSources) {
    const evidenceId = String(source?.evidenceId || '').trim();
    if (!evidenceId) continue;
    const expected = evidenceIndex.byId.get(evidenceId);
    if (!expected) fail('SOURCE_EVIDENCE_INVALID', `report source ${evidenceId} is not in result evidence`);
    if (String(source.sha256 || '').toLowerCase() !== expected.sha256 || String(source.evidenceHash || '').toLowerCase() !== expected.evidenceHash) {
      fail('STALE_REPORT', `report source ${evidenceId} hash differs from result evidence`);
    }
  }
  return { report, claims, claimIds };
}

function validateCampaignAndRun(input, result) {
  const campaignId = id(input.campaignId || result.report?.campaign?.id, 'campaignId');
  if (String(result.report?.campaign?.id || '') !== campaignId) fail('CAMPAIGN_MISMATCH', 'pipeline report campaign does not match bridge campaignId');
  const runId = id(result.runId, 'pipeline runId');
  if (result.status !== 'SUCCEEDED') fail('PIPELINE_NOT_SUCCEEDED', `pipeline status is ${String(result.status || 'UNKNOWN')}`);
  if (result.externalSideEffects !== false) fail('SIDE_EFFECTS_NOT_ALLOWED', 'pipeline result is not explicitly side-effect free');
  return { campaignId, runId };
}

function normalizeDestination(input, runId, productRepo) {
  const requested = input.artifactRelativePath || input.artifactDestination || input.artifactPath || `artifacts/product-content/${runId}.mp4`;
  const raw = String(requested).trim().replaceAll('\\', '/');
  if (!raw || raw.includes('\u0000')) fail('ARTIFACT_DESTINATION_INVALID', 'artifact destination is required');
  if (path.isAbsolute(raw)) {
    if (!productRepo) fail('ARTIFACT_DESTINATION_INVALID', 'absolute artifact destination requires productRepo');
    const resolvedRoot = path.resolve(productRepo);
    const resolved = path.resolve(raw);
    const relative = path.relative(resolvedRoot, resolved).replaceAll('\\', '/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) fail('ARTIFACT_DESTINATION_INVALID', 'artifact destination must stay inside productRepo');
    return { relativePath: relative, absolutePath: resolved };
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) fail('ARTIFACT_DESTINATION_INVALID', 'artifact destination must stay inside productRepo');
  return { relativePath: normalized, absolutePath: productRepo ? path.resolve(productRepo, normalized) : null };
}

function validateCopyShape(copy, index, evidenceIndex, claimsById) {
  if (!copy || typeof copy !== 'object') fail('AMBIGUOUS_OUTPUT', `copy ${index} is invalid`);
  const targetId = id(copy.targetId, `copy ${index}.targetId`);
  const channel = text(copy.channel, `copy ${targetId}.channel`, { max: 80 }).toLowerCase();
  if (!PIPELINE_CHANNELS.has(channel)) fail('UNSUPPORTED_CHANNEL', `copy ${targetId} uses unsupported channel ${channel}`);
  const content = text(copy.content, `copy ${targetId}.content`, { max: MAX_TEXT });
  if (copy.status !== 'draft') fail('UNSAFE_COPY_STATUS', `copy ${targetId} is not draft-only`);
  for (const field of ['publicationUrl', 'publishedAt', 'metrics', 'engagement', 'permalink']) {
    if (copy[field] !== undefined && copy[field] !== null) fail('UNSAFE_COPY_OUTPUT', `copy ${targetId} contains ${field}`);
  }
  const claimIds = [...new Set((Array.isArray(copy.claimIds) ? copy.claimIds : []).map((item) => text(item, `${targetId}.claimIds item`, { max: 180 })))];
  if (!claimIds.length) fail('SOURCE_EVIDENCE_MISSING', `copy ${targetId} has no grounded claims`);
  for (const claimId of claimIds) if (!claimsById.has(claimId)) fail('SOURCE_EVIDENCE_INVALID', `copy ${targetId} references unknown claim ${claimId}`);
  const evidenceRefs = canonicalRefs(copy.evidenceRefs, `copy ${targetId}.evidenceRefs`);
  for (const ref of evidenceRefs) if (!evidenceIndex.byId.has(ref)) fail('SOURCE_EVIDENCE_INVALID', `copy ${targetId} references unknown evidence ${ref}`);
  return { targetId, channel, content, claimIds, evidenceRefs };
}

async function verifyOutputs(result, evidenceIndex) {
  const reportPath = String(result.reportPath || '').trim();
  if (!reportPath) fail('STALE_REPORT', 'successful result reportPath is required');
  const outputRoot = path.dirname(path.resolve(reportPath));
  const reportRead = await readJsonOutput(reportPath, MAX_REPORT_BYTES, 'reportPath');
  const reportHash = digest(reportRead.data);
  const reportCheck = validateReport(result, evidenceIndex, reportRead.value);

  if (!Array.isArray(result.copies) || result.copies.length === 0) fail('AMBIGUOUS_OUTPUT', 'successful result has no copies');
  if (!Array.isArray(result.copyPaths) || result.copyPaths.length !== result.copies.length) fail('AMBIGUOUS_OUTPUT', 'copyPaths count does not match copies');
  const seenTargets = new Set();
  const seenCopyPaths = new Set();
  const copies = [];
  for (let index = 0; index < result.copies.length; index += 1) {
    const copy = validateCopyShape(result.copies[index], index, evidenceIndex, reportCheck.claimIds);
    if (seenTargets.has(copy.targetId)) fail('AMBIGUOUS_OUTPUT', `duplicate target output ${copy.targetId}`);
    seenTargets.add(copy.targetId);
    const copyPath = String(result.copyPaths[index] || '').trim();
    if (!copyPath || seenCopyPaths.has(copyPath)) fail('AMBIGUOUS_OUTPUT', `duplicate or missing copy path for ${copy.targetId}`);
    assertOutputWithinRoot(copyPath, outputRoot, `copyPaths[${index}]`);
    seenCopyPaths.add(copyPath);
    const copyRead = await readJsonOutput(copyPath, MAX_COPY_BYTES, `copyPaths[${index}]`);
    if (stable(copyRead.value) !== stable(result.copies[index])) fail('STALE_COPY', `copy file does not match in-memory copy for ${copy.targetId}`);
    copies.push({ ...copy, path: copyPath, fileSha256: digest(copyRead.data) });
  }

  const mp4Path = String(result.mp4Path || '').trim();
  if (!mp4Path || String(result.media?.path || '') !== mp4Path) fail('STALE_MEDIA', 'mp4Path and media.path must be the same');
  assertOutputWithinRoot(mp4Path, outputRoot, 'mp4Path');
  const mediaData = await readBounded(mp4Path, MAX_FILE_BYTES, 'mp4Path');
  const mediaSha256 = digest(mediaData);
  if (mediaSha256 !== sha(result.media?.sha256, 'media.sha256')) fail('MEDIA_HASH_MISMATCH', 'MP4 bytes do not match result media.sha256');
  if (Number(result.media?.bytes) !== mediaData.length) fail('STALE_MEDIA', 'MP4 byte count does not match result media.bytes');
  if (mediaData.length < 128 || !mediaData.includes(Buffer.from('ftyp')) || !mediaData.includes(Buffer.from('moov'))) fail('MEDIA_INVALID', 'media output is not a playable MP4 container');
  return { report: reportCheck, reportHash, copies, media: { path: mp4Path, sha256: mediaSha256, bytes: mediaData.length, durationSeconds: Number(result.media.durationSeconds) || null } };
}

function buildStoryInput({ input, campaignId, runId, artifact, evidence, claims, report }) {
  const title = text(input.title || claims[0]?.text || `${report.product?.name || 'Product'} grounded report`, 'story.title', { max: 1_200 });
  const angle = text(input.angle || claims.slice(0, 3).map((claim) => claim.text).join(' '), 'story.angle', { max: 1_200 });
  const audience = text(input.audience || 'general', 'story.audience', { max: 300 });
  const callToAction = text(input.callToAction || 'Inspect the evidence.', 'story.callToAction', { max: 300 });
  const language = text(input.language || 'en', 'story.language', { max: 32 });
  const groundingSources = canonicalSourceRefs(evidence.map((item) => ({ relativePath: item.relativePath, sha256: item.sha256 })), 'story.groundingSources');
  const evidenceRefs = [...new Set(claims.flatMap((claim) => claim.evidenceRefs))].sort();
  return {
    campaignId,
    runId,
    input: {
      artifactId: { $ref: 'registerArtifact.id' },
      title,
      angle,
      audience,
      callToAction,
      language,
      // SeedingService.createStory accepts repository-relative path strings
      // and re-hashes them before persistence. Keep the expected hashes beside
      // those paths so an integration adapter can verify the same binding
      // before invoking the API.
      groundingSources: groundingSources.map((source) => source.relativePath),
      groundingSourceHashes: groundingSources,
      disclosure: text(input.disclosure || 'Evidence-grounded draft generated from the verified product content pipeline.', 'story.disclosure', { max: 500 }),
      bridgeEvidenceRefs: evidenceRefs,
      artifactSha256: artifact.sha256
    }
  };
}

/**
 * Validate a successful pipeline result and produce a deterministic campaign
 * handoff plan. This function performs reads and hashing only; it never writes
 * files or calls the campaign service.
 */
export async function bridgeProductContentPipelineResult(input = {}, options = {}) {
  const envelope = input && typeof input === 'object' && !Array.isArray(input) && (input.status || input.reportPath || input.mp4Path || input.report)
    ? { ...options, result: input }
    : input;
  const result = resolveResult(envelope);
  const { campaignId, runId } = validateCampaignAndRun(envelope, result);
  const evidenceIndex = requireGroundedEvidence(result);
  await verifyGroundingSources(envelope.productRepo, evidenceIndex.records);
  const outputs = await verifyOutputs(result, evidenceIndex);
  const productRepo = path.resolve(String(envelope.productRepo));
  const destination = normalizeDestination(envelope, runId, productRepo);
  const artifactName = text(envelope.artifactName || `${runId} grounded product video`, 'artifactName', { max: 240 });
  const mediaType = text(envelope.mediaType || 'video/mp4', 'mediaType', { max: 160 });
  if (mediaType !== 'video/mp4') fail('ARTIFACT_INVALID', 'product content bridge requires video/mp4 media');
  if (destination.absolutePath && path.resolve(destination.absolutePath) === path.resolve(outputs.media.path)) {
    fail('ARTIFACT_DESTINATION_INVALID', 'artifact destination cannot be the pipeline output path');
  }
  const artifactEvidence = `Product content pipeline ${runId}; source MP4 SHA-256 ${outputs.media.sha256}; report SHA-256 ${outputs.reportHash}; grounded evidence ${evidenceIndex.records.map((item) => `${item.relativePath}#${item.sha256}`).join(', ')}.`;
  const artifact = {
    sourcePath: outputs.media.path,
    sha256: outputs.media.sha256,
    bytes: outputs.media.bytes,
    mediaType,
    name: artifactName,
    destinationPath: destination.relativePath,
    destinationAbsolutePath: destination.absolutePath,
    evidence: artifactEvidence,
    registerInput: { path: destination.relativePath, name: artifactName, mediaType, evidence: artifactEvidence },
    reconcile: { campaignId, relativePath: destination.relativePath, sha256: outputs.media.sha256, bytes: outputs.media.bytes },
    idempotencyKey: digest(stable({ campaignId, destinationPath: destination.relativePath, sha256: outputs.media.sha256 }))
  };
  const claims = outputs.report.claims;
  const story = buildStoryInput({ input: envelope, campaignId, runId, artifact, evidence: evidenceIndex.records, claims, report: outputs.report.report });
  const candidates = outputs.copies.map((copy) => {
    const candidateHash = jsonHash(copy.content);
    const contentIdentity = digest(stable({ bridgeVersion: PRODUCT_CONTENT_CAMPAIGN_BRIDGE_VERSION, campaignId, targetId: copy.targetId, channel: copy.channel, content: copy.content, claimIds: copy.claimIds, evidenceRefs: copy.evidenceRefs, artifactSha256: artifact.sha256 }));
    return {
      contentId: `content-${contentIdentity.slice(0, 24)}`,
      contentIdentity,
      contentHash: candidateHash,
      campaignId,
      runId,
      targetId: copy.targetId,
      channel: copy.channel,
      content: copy.content,
      claimIds: copy.claimIds,
      evidenceRefs: copy.evidenceRefs,
      contentSourceRefs: canonicalSourceRefs(copy.evidenceRefs.map((ref) => {
        const source = evidenceIndex.byId.get(ref);
        return { relativePath: source.relativePath, sha256: source.sha256 };
      }), `candidate ${copy.targetId}.contentSourceRefs`),
      artifactSha256: artifact.sha256,
      status: 'draft',
      publicationUrl: null,
      metrics: null,
      idempotencyKey: digest(stable({ campaignId, targetId: copy.targetId, channel: copy.channel, contentId: `content-${contentIdentity.slice(0, 24)}` }))
    };
  });
  const variants = candidates.map((candidate) => ({
    targetId: candidate.targetId,
    contentId: candidate.contentId,
    content: candidate.content,
    claimIds: candidate.claimIds,
    contentSourceRefs: candidate.contentSourceRefs,
    // createChannelDrafts uses the story's artifactId as the canonical media
    // binding. assetPath is included as an explicit path check for callers
    // that want the service to enforce the staged destination too.
    assetPath: artifact.destinationPath,
    audience: story.input.audience,
    language: story.input.language,
    publicationVisibility: 'PUBLIC'
  }));
  const bridgeIdentity = digest(stable({ campaignId, artifactPath: artifact.destinationPath, artifactSha256: artifact.sha256, candidates: candidates.map((candidate) => ({ targetId: candidate.targetId, contentId: candidate.contentId, contentIdentity: candidate.contentIdentity })) }));
  const actions = Object.freeze({
    stageArtifact: {
      actionId: 'stageArtifact', type: 'STAGE_ARTIFACT', method: 'copyFile', campaignId,
      sourcePath: artifact.sourcePath, destinationPath: artifact.destinationAbsolutePath || artifact.destinationPath,
      expectedSha256: artifact.sha256, expectedBytes: artifact.bytes, externalSideEffects: true,
      idempotencyKey: artifact.idempotencyKey
    },
    registerArtifact: {
      actionId: 'registerArtifact', type: 'REGISTER_ARTIFACT', method: 'registerArtifact', campaignId,
      input: artifact.registerInput, expected: { sha256: artifact.sha256, bytes: artifact.bytes },
      requires: ['stageArtifact'], externalSideEffects: false, idempotencyKey: artifact.idempotencyKey
    },
    createStory: {
      actionId: 'createStory', type: 'CREATE_STORY', method: 'createStory', campaignId,
      input: story.input, requires: ['registerArtifact'], externalSideEffects: false, idempotencyKey: digest(stable({ bridgeIdentity, operation: 'story' }))
    },
    createChannelDrafts: {
      actionId: 'createChannelDrafts', type: 'CREATE_CHANNEL_DRAFTS', method: 'createChannelDrafts', campaignId,
      storyIdRef: { actionId: 'createStory', field: 'id' }, input: { variants },
      requires: ['createStory'], externalSideEffects: false, idempotencyKey: digest(stable({ bridgeIdentity, operation: 'drafts' }))
    }
  });
  return Object.freeze({
    version: PRODUCT_CONTENT_CAMPAIGN_BRIDGE_VERSION,
    status: 'READY',
    bridgeIdentity,
    campaignId,
    runId,
    externalSideEffects: false,
    authoritySideEffects: false,
    artifact,
    evidence: evidenceIndex.records,
    report: { path: String(result.reportPath), sha256: outputs.reportHash, runId },
    story,
    candidates,
    actions,
    serviceCalls: [
      { method: 'registerArtifact', args: [campaignId, artifact.registerInput, 'automation'], actionId: 'registerArtifact' },
      { method: 'createStory', args: [campaignId, story.input, 'automation'], actionId: 'createStory', resolve: { artifactId: 'registerArtifact.id' } },
      { method: 'createChannelDrafts', args: ['createStory.id', { variants }, 'automation'], actionId: 'createChannelDrafts', resolve: { storyId: 'createStory.id' } }
    ],
    limitations: [
      'Stage the MP4 into artifact.destinationPath before registerArtifact; the bridge does not copy files.',
      'The returned calls create verified artifacts and draft jobs only. Existing campaign authorization, readiness, schedule, quota, duplicate, and platform guards decide queue eligibility.',
      'No publication URL, metrics, approval, authorization, or live side effect is produced.'
    ]
  });
}

export const buildProductContentCampaignBridge = bridgeProductContentPipelineResult;
export const bridgeProductContentPipeline = bridgeProductContentPipelineResult;
export const createProductContentCampaignBridge = bridgeProductContentPipelineResult;

export const productContentCampaignBridgeInternals = Object.freeze({ stable, digest, canonicalSourceRefs });
