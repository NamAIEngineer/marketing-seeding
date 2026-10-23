import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapturePlan, executeCapturePlan } from '../src/product-factory-capture.mjs';

const identity = { repository: 'repo/product', runId: 'run-01', sourceCommit: 'abc123', mode: 'LOCAL_FIXTURE' };

test('capture plans are deterministic and cover each supported product type', () => {
  for (const productType of ['WEB_SOFTWARE', 'DESIGN', '3D', 'CLI/BACKEND']) {
    const first = createCapturePlan({ ...identity, productType });
    const second = createCapturePlan({ ...identity, productType });
    assert.deepEqual(first, second);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.steps), true);
    assert.ok(first.steps.length > 0);
  }
});

test('missing runtime and backend fail closed without invoking anything', async () => {
  const plan = createCapturePlan({ ...identity, productType: 'WEB_SOFTWARE' });
  let calls = 0;
  const backend = { async executeCaptureStep() { calls += 1; return { artifacts: [{ path: 'shot.png', content: 'not-real' }] }; } };
  assert.equal((await executeCapturePlan(plan, { backend })).status, 'CAPTURE_RUNTIME_UNAVAILABLE');
  assert.equal((await executeCapturePlan(plan, { runtimeCapability: { ready: true, runtimeIdentity: 'fake' } })).status, 'CAPTURE_BACKEND_UNAVAILABLE');
  assert.equal(calls, 0);
});

test('explicit bounded backend produces immutable artifact provenance and content hashes', async () => {
  const plan = createCapturePlan({ ...identity, productType: 'DESIGN' });
  const calls = [];
  const result = await executeCapturePlan(plan, {
    runtimeCapability: { ready: true, runtimeIdentity: 'test-runtime-1', capabilities: { browser: true } },
    clock: () => '2026-10-23T00:00:00.000Z',
    backend: { async executeCaptureStep(step, context) {
      calls.push({ step, context });
      return { artifacts: [{ path: `${step.id}.png`, content: `fixture:${step.id}`, mediaType: 'image/png' }] };
    } }
  });
  assert.equal(result.status, 'CAPTURED');
  assert.equal(calls.length, plan.steps.length);
  assert.equal(result.artifacts.length, plan.steps.length);
  assert.equal(result.provenance.sourceCommit, identity.sourceCommit);
  assert.equal(result.provenance.runId, identity.runId);
  assert.equal(result.provenance.runtimeIdentity, 'test-runtime-1');
  assert.equal(result.provenance.captureTimestamp, '2026-10-23T00:00:00.000Z');
  assert.match(result.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.provenance), true);
  assert.equal(result.externalSideEffects, false);
});

test('invalid artifact paths and missing bytes/hash are not accepted as evidence', async () => {
  const plan = createCapturePlan({ ...identity, productType: '3D' });
  const options = { runtimeCapability: { ready: true, runtimeIdentity: 'test-runtime', capabilities: { capture: true } } };
  const traversal = await executeCapturePlan(plan, { ...options, backend: { async executeCaptureStep() { return { artifacts: [{ path: '../fake.mp4', content: 'x' }] }; } } });
  assert.equal(traversal.status, 'CAPTURE_FAILED');
  const empty = await executeCapturePlan(plan, { ...options, backend: { async executeCaptureStep() { return { artifacts: [{ path: 'fake.mp4' }] }; } } });
  assert.equal(empty.status, 'CAPTURE_FAILED');
});
