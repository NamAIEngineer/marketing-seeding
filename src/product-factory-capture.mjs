import { createHash } from 'node:crypto';

/**
 * Product Factory browser capture is an adapter seam, not a browser driver.
 * A caller must provide both an attested runtime capability and an explicit
 * backend. This module never starts a browser, executes a repository, or
 * invents an artifact when either input is absent.
 */

export const CAPTURE_STATUSES = Object.freeze([
  'CAPTURED',
  'CAPTURE_BACKEND_UNAVAILABLE',
  'CAPTURE_RUNTIME_UNAVAILABLE',
  'CAPTURE_FAILED'
]);

const PRODUCT_TYPES = Object.freeze(['WEB_SOFTWARE', 'DESIGN', '3D', 'CLI/BACKEND']);
const STEP_TEMPLATES = Object.freeze({
  WEB_SOFTWARE: [
    ['build_or_start', 'bounded build/run evidence'],
    ['navigate_product', 'navigate the running product'],
    ['screenshot', 'capture representative product screenshot'],
    ['demo_sequence', 'capture a bounded demo sequence']
  ],
  DESIGN: [
    ['render_export', 'render or export the design'],
    ['screenshot', 'capture representative design views'],
    ['detail_comparison', 'capture detail or comparison views']
  ],
  '3D': [
    ['render_output', 'render the 3D output'],
    ['frame_capture', 'capture representative frames'],
    ['turntable', 'capture a bounded turntable or video candidate']
  ],
  'CLI/BACKEND': [
    ['run_demo', 'run a bounded CLI/backend demonstration'],
    ['benchmark_log', 'capture benchmark or execution log evidence'],
    ['terminal_capture', 'capture a bounded terminal evidence view']
  ]
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

/** Create deterministic capture steps. No filesystem or browser work occurs. */
export function createCapturePlan(input = {}) {
  const productType = text(input.productType || input.kind, 'productType').toUpperCase();
  if (!PRODUCT_TYPES.includes(productType)) throw new TypeError(`unsupported productType: ${productType}`);
  const repository = text(input.repository || input.repositoryPath, 'repository');
  const runId = text(input.runId || input.buildRunId, 'runId');
  const sourceCommit = text(input.sourceCommit || input.commit, 'sourceCommit');
  const mode = String(input.mode || 'BOUNDED_LOCAL_REAL').toUpperCase();
  if (!['LOCAL_FIXTURE', 'BOUNDED_LOCAL_REAL', 'PRODUCTION'].includes(mode)) throw new TypeError(`unsupported capture mode: ${mode}`);
  const steps = STEP_TEMPLATES[productType].map(([kind, purpose], index) => ({
    id: `capture-${String(index + 1).padStart(2, '0')}`,
    kind,
    purpose,
    productType,
    requiredCapability: kind === 'build_or_start' || kind === 'run_demo' ? 'execute' : 'browser'
  }));
  const body = { version: 1, repository, runId, sourceCommit, productType, mode, steps };
  return freeze({ ...body, planHash: sha256(stable(body)) });
}

function runtimeAvailable(runtime) {
  return runtime && typeof runtime === 'object' &&
    runtime.ready === true && typeof runtime.runtimeIdentity === 'string' && runtime.runtimeIdentity.trim() &&
    (runtime.capabilities === undefined || runtime.capabilities.browser === true || runtime.capabilities.capture === true);
}

function normalizeArtifact(artifact, stepId) {
  if (!artifact || typeof artifact !== 'object') throw new TypeError(`backend artifact missing for ${stepId}`);
  const artifactPath = text(artifact.path, 'artifact.path').replaceAll('\\', '/');
  if (artifactPath.startsWith('/') || artifactPath.split('/').includes('..')) throw new TypeError('artifact path must be relative');
  let digest;
  let bytes;
  if (artifact.content !== undefined) {
    const data = Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(String(artifact.content));
    digest = sha256(data);
    bytes = data.length;
  } else if (/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || '')) && Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0) {
    digest = String(artifact.sha256).toLowerCase();
    bytes = artifact.bytes;
  } else throw new TypeError(`artifact content/hash missing for ${stepId}`);
  return Object.freeze({ path: artifactPath, bytes, sha256: digest, mediaType: artifact.mediaType ? String(artifact.mediaType) : null, stepId });
}

/** Execute only via the caller supplied backend and supplied runtime capability. */
export async function executeCapturePlan(plan, options = {}) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) throw new TypeError('plan is required');
  if (!runtimeAvailable(options.runtimeCapability)) return { version: 1, status: 'CAPTURE_RUNTIME_UNAVAILABLE', planHash: plan.planHash || null, results: [], artifacts: [], externalSideEffects: false };
  const backend = options.backend;
  if (!backend || typeof backend.executeCaptureStep !== 'function') return { version: 1, status: 'CAPTURE_BACKEND_UNAVAILABLE', planHash: plan.planHash || null, results: [], artifacts: [], externalSideEffects: false };
  const now = options.clock ? options.clock() : new Date().toISOString();
  const captureTimestamp = new Date(now).toISOString();
  const results = [];
  const artifacts = [];
  try {
    for (const step of plan.steps) {
      const output = await backend.executeCaptureStep(Object.freeze({ ...step }), Object.freeze({ runtimeIdentity: options.runtimeCapability.runtimeIdentity, repository: plan.repository, runId: plan.runId, mode: plan.mode }));
      if (!output || output.status === 'FAILED') throw new Error(output?.error || `capture step failed: ${step.id}`);
      const produced = Array.isArray(output.artifacts) ? output.artifacts : [];
      if (produced.length === 0) throw new Error(`capture step produced no artifact: ${step.id}`);
      const normalized = produced.map((artifact) => normalizeArtifact(artifact, step.id));
      artifacts.push(...normalized);
      results.push(Object.freeze({ stepId: step.id, status: 'CAPTURED', artifactCount: normalized.length }));
    }
  } catch (error) {
    return { version: 1, status: 'CAPTURE_FAILED', planHash: plan.planHash || null, results, artifacts, error: String(error?.message || error), externalSideEffects: false };
  }
  const provenance = freeze({ version: 1, repository: plan.repository, runId: plan.runId, sourceCommit: plan.sourceCommit, planHash: plan.planHash || sha256(stable(plan)), captureTimestamp, runtimeIdentity: options.runtimeCapability.runtimeIdentity, mode: plan.mode, artifactHashes: artifacts.map((artifact) => artifact.sha256) });
  return freeze({ version: 1, status: 'CAPTURED', planHash: provenance.planHash, results, artifacts, provenance, externalSideEffects: false });
}

export { PRODUCT_TYPES };
