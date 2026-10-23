import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OrcaAccessibilityTransport,
  OrcaPointerTransport,
  assertValidatedTransport,
  assertTransportCannotChangeAfterIntent,
  createBootstrapTransportCertification,
  selectCertifiedTransport,
  transportReceipt
} from "../src/browser-interaction-transport.mjs";
import { OrcaCliClient } from "../src/orca-browser-client.mjs";
import { certifyTransport, DEFAULT_CERTIFICATION_POLICY, summarizeCertification } from "../src/transport-certification.mjs";
import { BrowserInteractionFixture } from "./fixtures/browser-interaction-fixture.mjs";

function fixtureTransport(fixture) {
  return {
    runtimeIdentity: () => ({ transport: "fixture", provider: "local-fixture", providerVersion: "1" }),
    async click(target, options = {}) {
      await options.validate?.();
      return fixture.click(target);
    }
  };
}

test("transport receipt is distinct from activation", () => {
  const receipt = transportReceipt({ status: "COMMAND_COMPLETED", elementRef: "safe-1" }, {
    transport: "orca-accessibility", targetIdentity: "control-hash", startedAt: "2026-10-17T00:00:00.000Z", completedAt: "2026-10-17T00:00:00.100Z"
  });
  assert.equal(receipt.commandStatus, "COMMAND_COMPLETED");
  assert.equal(receipt.activation, null);
});

test("local fixture certifies stable reversible control with reset between trials", async () => {
  const fixture = new BrowserInteractionFixture();
  const record = await certifyTransport({
    transport: fixtureTransport(fixture), attempts: 10,
    identity: { transport: "fixture", providerVersion: "1" },
    createTrial: async () => ({
      reset: () => fixture.reset(),
      observeBefore: () => fixture.state(),
      resolveTarget: () => fixture.targetRef(),
      preflight: () => fixture.preflight(),
      observeAfter: () => fixture.state(),
      classifyActivation: ({ before, after }) => ({ status: before.popoverOpen !== after.popoverOpen ? "CONTROL_ACTIVATED" : "CONTROL_NOT_OBSERVED" }),
      cleanup: () => fixture.reset()
    })
  });
  assert.equal(record.certified, true);
  assert.equal(record.metrics.attempts, 10);
  assert.equal(record.metrics.commandCompleted, 10);
  assert.equal(record.metrics.positiveActivation, 10);
  assert.equal(record.metrics.activationSuccessRate, 1);
  assert.equal(summarizeCertification(record).certified, true);
});

test("local fixture certifies the ORCA pointer transport with reset between trials", async () => {
  const state = { open: false, calls: [] };
  const browser = {
    runtimeVersion: "1.4.229",
    async mouseMove(pageId, x, y) { state.calls.push(["move", pageId, x, y]); },
    async mouseDown(pageId, button) { state.calls.push(["down", pageId, button]); },
    async mouseUp(pageId, button) {
      state.calls.push(["up", pageId, button]);
      state.open = !state.open;
      return { released: true };
    }
  };
  const transport = new OrcaPointerTransport(browser);
  const record = await certifyTransport({
    transport,
    attempts: 10,
    identity: { transport: "orca-pointer", provider: "orca", providerVersion: "1.4.229" },
    createTrial: async () => ({
      reset: () => { state.open = false; state.calls = []; },
      observeBefore: () => ({ open: state.open }),
      resolveTarget: () => ({
        pageId: "fixture-page",
        targetRef: "safe-toggle",
        targetIdentity: "safe-toggle",
        boundingBox: { x: 10, y: 20, width: 80, height: 30 }
      }),
      preflight: () => ({ status: "PASSED", actionable: true, hitTargetMatched: true }),
      observeAfter: () => ({ open: state.open }),
      classifyActivation: ({ before, after }) => ({
        status: before.open !== after.open ? "CONTROL_ACTIVATED" : "CONTROL_NOT_OBSERVED"
      }),
      cleanup: () => { state.open = false; state.calls = []; }
    })
  });
  assert.equal(record.certified, true);
  assert.equal(record.metrics.attempts, 10);
  assert.equal(record.metrics.commandCompleted, 10);
  assert.equal(record.metrics.positiveActivation, 10);
  assert.equal(record.metrics.activationSuccessRate, 1);
});

test("certification counts stale, moving, detached, and overlay preflight failures", async () => {
  const fixture = new BrowserInteractionFixture();
  const record = await certifyTransport({
    transport: fixtureTransport(fixture), attempts: 4,
    policy: { ...DEFAULT_CERTIFICATION_POLICY, minimumAttempts: 4 },
    createTrial: async (index) => ({
      reset: () => fixture.reset(),
      observeBefore: () => fixture.state(),
      resolveTarget: () => {
        const target = fixture.targetRef();
        if (index === 0) fixture.target.id = "moved-after-resolution";
        if (index === 1) fixture.target.attached = false;
        if (index === 2) fixture.overlay = true;
        return target;
      },
      preflight: (target) => {
        if (index === 0) throw Object.assign(new Error("stale"), { code: "STALE_TARGET" });
        return fixture.preflight(target);
      },
      observeAfter: () => fixture.state(),
      classifyActivation: () => ({ status: "CONTROL_NOT_OBSERVED" }),
      cleanup: () => fixture.reset()
    })
  });
  assert.equal(record.metrics.attempts, 4);
  assert.equal(record.metrics.preflightRejections, 3);
  assert.equal(record.metrics.staleTarget, 2);
  assert.equal(record.metrics.hitTargetDrift, 1);
  assert.equal(record.certified, false);
});

test("selection is deterministic and transport cannot switch after durable intent", () => {
  const a = { runtimeIdentity: () => ({ transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.227" }) };
  const b = { runtimeIdentity: () => ({ transport: "playwright-pointer", provider: "playwright", providerVersion: "1.56.0" }) };
  const selected = selectCertifiedTransport({ transports: [b, a], platform: "linkedin", runtime: { provider: "orca", providerVersion: "1.4.227" }, certifications: [{ transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.227", certified: true }] });
  assert.equal(selected, a);
  assert.throws(() => assertTransportCannotChangeAfterIntent({ selectedTransport: "orca-accessibility", requestedTransport: "playwright-pointer", intentPersisted: true }), /cannot change/);
  assert.equal(assertTransportCannotChangeAfterIntent({ selectedTransport: "orca-accessibility", requestedTransport: "playwright-pointer", intentPersisted: false }), "orca-accessibility");
});

test("certified transport selection fails closed when runtime or certification version is missing", () => {
  const transport = { runtimeIdentity: () => ({ transport: "orca-accessibility", providerVersion: null }) };
  assert.throws(() => selectCertifiedTransport({
    transports: [transport],
    platform: "linkedin",
    runtime: {},
    certifications: [{ transport: "orca-accessibility", platform: "linkedin", certified: true, providerVersion: "1.4.229" }]
  }), /No certified browser interaction transport/);
  assert.throws(() => selectCertifiedTransport({
    transports: [transport],
    platform: "linkedin",
    runtime: { providerVersion: "1.4.229" },
    certifications: [{ transport: "orca-accessibility", platform: "linkedin", certified: true }]
  }), /No certified browser interaction transport/);
});

test("certified transport selection requires an exact non-empty runtime version match", () => {
  const transport = { runtimeIdentity: () => ({ transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.229" }) };
  assert.equal(selectCertifiedTransport({
    transports: [transport],
    platform: "linkedin",
    runtime: { provider: "orca", providerVersion: "1.4.229" },
    certifications: [{ transport: "orca-accessibility", provider: "orca", platform: "linkedin", certified: true, providerVersion: "1.4.229" }]
  }), transport);
  assert.throws(() => selectCertifiedTransport({
    transports: [transport],
    platform: "linkedin",
    runtime: { provider: "orca", providerVersion: "1.4.227" },
    certifications: [{ transport: "orca-accessibility", provider: "orca", platform: "linkedin", certified: true, providerVersion: "1.4.229" }]
  }), /No certified browser interaction transport/);
  assert.throws(() => selectCertifiedTransport({
    transports: [transport],
    platform: "linkedin",
    runtime: { provider: "orca", providerVersion: "1.4.229" },
    requireIrreversibleSubmit: true,
    certifications: [{ transport: "orca-accessibility", provider: "orca", platform: "linkedin", certified: true, providerVersion: "1.4.229", certificationScope: "LOCAL_REAL_BROWSER_FIXTURE_CONTROL_ACTIVATION_ONLY" }]
  }), /No certified browser interaction transport/);
  assert.equal(selectCertifiedTransport({
    transports: [transport],
    platform: "linkedin",
    runtime: { provider: "orca", providerVersion: "1.4.229" },
    requireIrreversibleSubmit: true,
    certifications: [{ transport: "orca-accessibility", provider: "orca", platform: "linkedin", certified: true, providerVersion: "1.4.229", irreversibleSubmit: true, certificationScope: "IRREVERSIBLE_LINKEDIN_SUBMIT" }]
  }), transport);
});

test("bootstrap certification requires an exact live execution binding and evidence reference", () => {
  const transport = { runtimeIdentity: () => ({ transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.230" }) };
  const binding = {
    platform: "linkedin", executionId: "exec-1", campaignId: "campaign-1", jobId: "job-1",
    accountId: "linkedin_primary", profileId: "profile-1", targetId: "target-1", targetUrl: "https://www.linkedin.com/feed/",
    authorizationId: "auth-1", authorizationBinding: "auth-binding", contentSha256: "a".repeat(64),
    mediaSha256: [], visibility: "PUBLIC"
  };
  const cert = { transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.230", certified: true,
    irreversibleSubmit: true, bootstrap: true, certificationScope: "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT", expiresAt: new Date(Date.now() + 60_000).toISOString(),
    evidenceReference: "plans/bootstrap-cert.json", executionBinding: { ...binding } };
  assert.equal(selectCertifiedTransport({ transports: [transport], platform: "linkedin", runtime: { provider: "orca", providerVersion: "1.4.230" }, requireIrreversibleSubmit: true, executionBinding: binding, certifications: [cert] }), transport);
  assert.throws(() => selectCertifiedTransport({ transports: [transport], platform: "linkedin", runtime: { provider: "orca", providerVersion: "1.4.230" }, requireIrreversibleSubmit: true, executionBinding: { ...binding, contentSha256: "b".repeat(64) }, certifications: [cert] }), /No certified browser interaction transport/);
  assert.throws(() => selectCertifiedTransport({ transports: [transport], platform: "linkedin", runtime: { provider: "orca", providerVersion: "1.4.230" }, requireIrreversibleSubmit: true, executionBinding: binding, certifications: [{ ...cert, expiresAt: new Date(Date.now() - 1).toISOString() }] }), /No certified browser interaction transport/);
});

test("bootstrap certification is derived only when explicitly enabled and stays execution-scoped", () => {
  const binding = {
    platform: "linkedin", executionId: "exec-derive", campaignId: "campaign-1", jobId: "job-1",
    accountId: "linkedin_primary", profileId: "profile-1", targetId: "target-1", targetUrl: "https://www.linkedin.com/feed/",
    authorizationId: "auth-1", authorizationBinding: "auth-binding", contentSha256: "a".repeat(64), mediaSha256: [], visibility: "public"
  };
  const source = { transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.230", certified: true,
    certificationScope: "LIVE_REAL_WEBSITE_REVERSIBLE_CONTROL_ACTIVATION", evidenceReference: "reversible-proof" };
  assert.throws(() => createBootstrapTransportCertification({ sourceCertification: source, executionBinding: binding,
    evidenceReference: "bootstrap-proof", expiresAt: new Date(Date.now() + 60_000).toISOString() }), /disabled/);
  const cert = createBootstrapTransportCertification({ sourceCertification: source, executionBinding: binding,
    evidenceReference: "bootstrap-proof", expiresAt: new Date(Date.now() + 60_000).toISOString(), allowBootstrap: true });
  assert.equal(cert.certificationScope, "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT");
  assert.equal(cert.bootstrap, true);
  assert.equal(cert.irreversibleSubmit, true);
  assert.equal(cert.executionBinding.executionId, "exec-derive");
  assert.equal(cert.executionBinding.visibility, "PUBLIC");
  assert.deepEqual(cert.executionBinding.mediaSha256, []);
});

test("bootstrap certification derivation rejects stale expiry, incomplete binding, and irreversible source", () => {
  const binding = { platform: "linkedin", executionId: "e", campaignId: "c", jobId: "j", accountId: "a", profileId: "p", targetId: "t", targetUrl: "https://www.linkedin.com/feed/", authorizationId: "auth", authorizationBinding: "bind", contentSha256: "a".repeat(64) };
  const source = { transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.230", certified: true, certificationScope: "LOCAL_REAL_BROWSER_FIXTURE_CONTROL_ACTIVATION_ONLY", evidenceReference: "reversible-proof" };
  assert.throws(() => createBootstrapTransportCertification({ allowBootstrap: true, sourceCertification: source, executionBinding: { ...binding, targetId: "" }, expiresAt: new Date(Date.now() + 1000).toISOString() }), /incomplete/);
  assert.throws(() => createBootstrapTransportCertification({ allowBootstrap: true, sourceCertification: source, executionBinding: binding, expiresAt: new Date(Date.now() - 1).toISOString() }), /expiry/);
  assert.throws(() => createBootstrapTransportCertification({ allowBootstrap: true, sourceCertification: { ...source, certificationScope: "IRREVERSIBLE_LINKEDIN_SUBMIT" }, executionBinding: binding, expiresAt: new Date(Date.now() + 1000).toISOString() }), /reversible/);
});

test("bootstrap certification cannot be used without exact execution scope", () => {
  const transport = { runtimeIdentity: () => ({ transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.230" }) };
  const cert = {
    transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.230", platform: "linkedin",
    certified: true, irreversibleSubmit: true, bootstrap: true,
    certificationScope: "BOOTSTRAP_LIVE_LINKEDIN_SUBMIT",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), evidenceReference: "bootstrap-proof"
  };
  assert.throws(() => selectCertifiedTransport({
    transports: [transport], platform: "linkedin", runtime: { provider: "orca", providerVersion: "1.4.230" },
    requireIrreversibleSubmit: true, certifications: [cert]
  }), /No certified browser interaction transport/);
  assert.throws(() => selectCertifiedTransport({
    transports: [transport], platform: "linkedin", runtime: { provider: "orca", providerVersion: "1.4.230" },
    requireIrreversibleSubmit: true, executionBinding: { platform: "linkedin", executionId: "exec" }, certifications: [cert]
  }), /No certified browser interaction transport/);
});

test("transport certification requires exact provider identity, not only version", () => {
  const transport = { runtimeIdentity: () => ({ transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.229" }) };
  assert.throws(() => selectCertifiedTransport({
    transports: [transport], platform: "linkedin",
    runtime: { provider: "other-provider", providerVersion: "1.4.229" },
    certifications: [{ transport: "orca-accessibility", provider: "orca", platform: "linkedin", certified: true, providerVersion: "1.4.229" }]
  }), /No certified browser interaction transport/);
  assert.throws(() => selectCertifiedTransport({
    transports: [transport], platform: "linkedin",
    runtime: { provider: "orca", providerVersion: "1.4.229" },
    certifications: [{ transport: "orca-accessibility", provider: "other-provider", platform: "linkedin", certified: true, providerVersion: "1.4.229" }]
  }), /No certified browser interaction transport/);
});

test("certified transport selection fails closed on conflicting duplicate certification records", () => {
  const transport = { runtimeIdentity: () => ({ transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.229" }) };
  assert.throws(() => selectCertifiedTransport({
    transports: [transport],
    platform: "linkedin",
    runtime: { provider: "orca", providerVersion: "1.4.229" },
    certifications: [
      { transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.229", platform: "linkedin", certified: true, certificationScope: "LOCAL_REAL_BROWSER_FIXTURE_CONTROL_ACTIVATION_ONLY" },
      { transport: "orca-accessibility", provider: "orca", providerVersion: "1.4.229", platform: "linkedin", certified: true, irreversibleSubmit: true, certificationScope: "IRREVERSIBLE_LINKEDIN_SUBMIT" }
    ]
  }), { code: "TRANSPORT_CERTIFICATION_AMBIGUOUS" });
});

test("ORCA runtime probe rejects an unpinned or mismatched executable before final input", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orca-version-fixture-"));
  const executable = path.join(directory, "orca-version-fixture");
  await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '%s' '1.4.229\\n'; exit 0; fi\nif [ \"$1\" = \"status\" ]; then printf '%s' '{\"ok\":true,\"result\":{\"runtime\":{\"appVersion\":\"1.4.229\"}}}'; exit 0; fi\nprintf '%s' '{\"ok\":true,\"result\":{}}'\n", "utf8");
  await chmod(executable, 0o755);
  const unpinned = new OrcaCliClient({ executable });
  await assert.rejects(unpinned.assertRuntimeVersion(), { code: "ORCA_RUNTIME_VERSION_UNPINNED" });
  const mismatched = new OrcaCliClient({ executable, providerVersion: "1.4.227" });
  await assert.rejects(mismatched.assertRuntimeVersion(), { code: "ORCA_RUNTIME_VERSION_MISMATCH" });
  const pinned = new OrcaCliClient({ executable, providerVersion: "1.4.229" });
  assert.deepEqual(await pinned.assertRuntimeVersion(), { expectedVersion: "1.4.229", observedVersion: "1.4.229", connectedRuntimeVersion: "1.4.229", executable });
});

test("ORCA transport health reports READY only after the read-only runtime probe", async () => {
  const browser = {
    runtimeVersion: "1.4.237",
    browserCommandCount: () => 0,
    async assertRuntimeVersion({ expectedVersion }) {
      assert.equal(expectedVersion, "1.4.237");
      return { expectedVersion, observedVersion: "1.4.237", connectedRuntimeVersion: "1.4.237" };
    }
  };
  const transport = new OrcaAccessibilityTransport(browser);
  const health = await transport.health();
  assert.equal(health.state, "READY");
  assert.equal(health.observedProviderVersion, "1.4.237");
  assert.equal(health.readinessEvidence, "READ_ONLY_EXECUTABLE_AND_CONNECTED_RUNTIME_VERSION");
});

test("ORCA transport health stays UNKNOWN without a version probe and fails closed on mismatch", async () => {
  const unprobed = await new OrcaAccessibilityTransport({ runtimeVersion: "1.4.237" }).health();
  assert.equal(unprobed.state, "UNKNOWN");
  assert.equal(unprobed.reason, "ORCA_RUNTIME_PROBE_NOT_CONFIGURED");

  const mismatched = await new OrcaPointerTransport({
    runtimeVersion: "1.4.232",
    async assertRuntimeVersion() {
      throw Object.assign(new Error("version mismatch"), { code: "ORCA_RUNTIME_VERSION_MISMATCH" });
    }
  }).health();
  assert.equal(mismatched.state, "UNAVAILABLE");
  assert.equal(mismatched.reason, "ORCA_RUNTIME_VERSION_MISMATCH");
});

test("ORCA connected runtime status must match the executable certification pin", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orca-connected-version-fixture-"));
  const executable = path.join(directory, "orca-connected-version-fixture");
  await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '%s' '1.4.229\\n'; exit 0; fi\nif [ \"$1\" = \"status\" ]; then printf '%s' '{\"ok\":true,\"result\":{\"runtime\":{\"appVersion\":\"1.4.227\"}}}'; exit 0; fi\nprintf '%s' '{\"ok\":true,\"result\":{}}'\n", "utf8");
  await chmod(executable, 0o755);
  const client = new OrcaCliClient({ executable, providerVersion: "1.4.229" });
  await assert.rejects(client.assertRuntimeVersion(), { code: "ORCA_CONNECTED_RUNTIME_VERSION_MISMATCH" });
});

test("final-submit validation contract rejects an unmarked custom transport", () => {
  assert.throws(() => assertValidatedTransport({ async click() {} }), /not certified/);
  const transport = new OrcaAccessibilityTransport({ async click() {} });
  assert.equal(assertValidatedTransport(transport), transport);
});

test("ORCA accessibility transport preserves normalized receipt", async () => {
  const browser = {
    runtimeVersion: "1.4.227",
    async click(pageId, ref, { validate }) { assert.equal(pageId, "page"); assert.equal(ref, "e1"); await validate(); return { status: "COMMAND_COMPLETED", providerResult: { clicked: ref } }; },
    browserCommandCount: () => 1
  };
  const transport = new OrcaAccessibilityTransport(browser);
  const receipt = await transport.click({ pageId: "page", targetRef: "e1", targetIdentity: "hash" }, { validate: async () => ({ status: "PASSED" }) });
  assert.equal(receipt.status, "COMMAND_COMPLETED");
  assert.equal(receipt.commandStatus, "COMMAND_COMPLETED");
  assert.equal(receipt.targetIdentity, "hash");
  assert.equal(receipt.transport, "orca-accessibility");
});

test("ORCA pointer transport uses one validated normal pointer sequence", async () => {
  const calls = [];
  const browser = {
    runtimeVersion: "1.4.227",
    async mouseMove(pageId, x, y) { calls.push(["move", pageId, x, y]); return {}; },
    async mouseDown(pageId, button) { calls.push(["down", pageId, button]); return {}; },
    async mouseUp(pageId, button) { calls.push(["up", pageId, button]); return { released: true }; }
  };
  const transport = new OrcaPointerTransport(browser);
  const receipt = await transport.click({ pageId: "page", targetRef: "safe", targetIdentity: "hash", boundingBox: { x: 10, y: 20, width: 80, height: 30 } }, { validate: async () => ({ status: "PASSED", hitTargetMatched: true }) });
  assert.equal(receipt.commandStatus, "COMMAND_COMPLETED");
  assert.deepEqual(calls, [["move", "page", 50, 35], ["down", "page", "left"], ["up", "page", "left"]]);
  assert.equal(receipt.activation, null);
});

test("ORCA pointer transport emits no pointer input when final validation fails", async () => {
  const calls = [];
  const browser = {
    async mouseMove(...args) { calls.push(["move", ...args]); },
    async mouseDown(...args) { calls.push(["down", ...args]); },
    async mouseUp(...args) { calls.push(["up", ...args]); }
  };
  const transport = new OrcaPointerTransport(browser);
  await assert.rejects(
    transport.click({ pageId: "page", targetRef: "safe", boundingBox: { x: 10, y: 20, width: 80, height: 30 } }, {
      validate: async () => { throw Object.assign(new Error("target moved"), { code: "HIT_TARGET_DRIFT" }); }
    }),
    /target moved/
  );
  assert.deepEqual(calls, []);
});
