import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CamoufoxExecutionTransport } from "../src/camoufox-execution-transport.mjs";
import { CamoufoxExecutionSessionResolver } from "../src/camoufox-execution-session-resolver.mjs";
import { ExecutionSession } from "../src/execution-session.mjs";

const PROFILE = "camoufox-profile-1";
const IDENTITY = "https://www.linkedin.com/in/example-member";
const ATTESTATION = {
  host: "local-test-host",
  runtime: "camoufox",
  version: "156.0.1-beta.36",
  evidence: "injected-read-only-runtime-probe",
  observedAt: "2026-10-27T00:00:00.000Z",
  expiresAt: "2999-01-01T00:00:00.000Z"
};

function session(overrides = {}) {
  return new ExecutionSession({
    lifecycle: "READY", provider: "camoufox", profileReference: PROFILE, providerProfileId: PROFILE,
    platform: "linkedin", accountId: "linkedin_primary", identityReference: IDENTITY,
    expectedIdentity: { provider: "camoufox", providerProfileId: PROFILE, platform: "linkedin", accountId: "linkedin_primary", identityReference: IDENTITY },
    capabilities: ["navigate", "click"], transportRef: { id: "camoufox-execution" },
    transportIdentity: { transport: "camoufox-execution", provider: "camoufox", providerVersion: ATTESTATION.version },
    attestation: ATTESTATION, ...overrides
  });
}

function client(observed = {}) {
  const calls = [];
  const base = {
    state: "READY", provider: "camoufox", providerProfileId: PROFILE,
    profileReference: PROFILE, platform: "linkedin", accountId: "linkedin_primary", identityReference: IDENTITY
  };
  const value = {
    async attach() { calls.push("attach"); },
    async observeIdentity() { calls.push("identity"); return { ...base, ...observed }; },
    async navigate() {}, async snapshot() {}, async resolve() {}, async type() {},
    async click() { calls.push("click"); return { status: "COMMAND_COMPLETED" }; },
    async observeTransition() {}, async verifyActivation() {}, async detach() { calls.push("detach"); },
    async listTabs() { return []; }, async showTab() {}, async waitForUrl() {}, async waitForFeed() {},
    async waitForExpression() {}, async evaluate() {}, async evaluateMutation() {}, async fill() {},
    async upload() {}, async uploadSelector() {}, async browserCommandCount() { return 0; }
  };
  return { value, calls };
}

test("Camoufox transport construction is inert and health fails closed without attestation", async () => {
  let factoryCalls = 0;
  const transport = new CamoufoxExecutionTransport({ profileReference: PROFILE, protocolFactory: async () => { factoryCalls += 1; } });
  assert.equal(factoryCalls, 0);
  assert.equal((await transport.health()).state, "UNKNOWN");
  assert.equal((await transport.health()).reason, "CAMOUFOX_HOST_ATTESTATION_REQUIRED");
});

test("Camoufox transport attaches exact identity and keeps browser surface injected", async () => {
  const { value, calls } = client();
  const transport = new CamoufoxExecutionTransport({ profileReference: PROFILE, protocolFactory: async ({ profileReference, runtimeIdentity }) => {
    assert.equal(profileReference, PROFILE);
    assert.equal(runtimeIdentity.provider, "camoufox");
    return value;
  }, hostAttestation: ATTESTATION });
  assert.equal((await transport.health()).state, "READY");
  const attached = await transport.attach(session());
  assert.equal(attached.provider, "camoufox");
  assert.equal(transport.browserSurface.evaluate !== undefined, true);
  await assert.rejects(() => transport.click("post", {}), { code: "TRANSPORT_VALIDATION_REQUIRED" });
  await transport.click("post", { validate: async () => ({ verified: true }) });
  assert.deepEqual(calls, ["attach", "identity", "click"]);
  await transport.detach();
  assert.deepEqual(calls, ["attach", "identity", "click", "detach"]);
  assert.deepEqual(await transport.detach(), { detached: true, status: "ALREADY_DETACHED" });
});

test("Camoufox transport rejects profile, identity, challenge, and secret drift", async () => {
  const mismatchClient = client({ accountId: "other" });
  const mismatch = new CamoufoxExecutionTransport({ profileReference: PROFILE, protocolFactory: async () => mismatchClient.value, hostAttestation: ATTESTATION });
  await assert.rejects(() => mismatch.attach(session()), { code: "CAMOUFOX_IDENTITY_MISMATCH" });
  assert.deepEqual(mismatchClient.calls, ["attach", "identity", "detach"]);
  const challengeClient = client({ state: "CHALLENGED" });
  const challenge = new CamoufoxExecutionTransport({ profileReference: PROFILE, protocolFactory: async () => challengeClient.value, hostAttestation: ATTESTATION });
  await assert.rejects(() => challenge.attach(session()), { code: "CAMOUFOX_SESSION_CHALLENGE" });
  assert.deepEqual(challengeClient.calls, ["attach", "identity", "detach"]);
  assert.throws(() => new CamoufoxExecutionTransport({ profileReference: PROFILE, protocolFactory: async () => client().value, hostAttestation: { ...ATTESTATION, cookie: "raw" } }), { code: "CAMOUFOX_SECRET_FIELD" });
  const otherProfile = new CamoufoxExecutionTransport({ profileReference: "other-profile", protocolFactory: async () => client().value, hostAttestation: ATTESTATION });
  await assert.rejects(() => otherProfile.attach(session()), { code: "CAMOUFOX_PROFILE_BINDING_MISMATCH" });
});

test("Camoufox transport detaches a client when capability validation fails", async () => {
  const { value, calls } = client();
  delete value.verifyActivation;
  const transport = new CamoufoxExecutionTransport({ profileReference: PROFILE, protocolFactory: async () => value, hostAttestation: ATTESTATION });
  await assert.rejects(() => transport.attach(session()), { code: "CAMOUFOX_PROTOCOL_INCOMPLETE" });
  assert.deepEqual(calls, ["detach"]);
});

test("Camoufox transport persists verified identity metadata before exposing the session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-transport-persist-"));
  const file = path.join(root, "session.json");
  const { value } = client();
  const transport = new CamoufoxExecutionTransport({
    profileReference: PROFILE, sessionMetadataPath: file,
    protocolFactory: async () => value, hostAttestation: ATTESTATION
  });
  await transport.attach(session());
  const stored = JSON.parse(await readFile(file, "utf8"));
  assert.equal(stored.provider, "camoufox");
  assert.equal(stored.accountId, "linkedin_primary");
  assert.equal(stored.status, "READY");
  assert.equal(transport.sessionIdentity().identityVerified, true);
  await transport.detach();
});

test("Camoufox transport fails closed when session metadata persistence fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-transport-persist-failure-"));
  const parent = path.join(root, "parent");
  await writeFile(parent, "not-a-directory");
  const { value, calls } = client();
  const transport = new CamoufoxExecutionTransport({
    profileReference: PROFILE, sessionMetadataPath: path.join(parent, "session.json"),
    protocolFactory: async () => value, hostAttestation: ATTESTATION
  });
  await assert.rejects(() => transport.attach(session()), { code: "CAMOUFOX_SESSION_METADATA_PERSIST_FAILED" });
  assert.equal(transport.sessionIdentity().attached, false);
  assert.deepEqual(calls, ["attach", "identity", "detach"]);
});

test("Camoufox resolver preserves provider/profile/account/identity binding and cleanup", async () => {
  const calls = [];
  const { value } = client();
  const account = { platform: "linkedin", accountId: "linkedin_primary", provider: "camoufox", profileRef: PROFILE, providerProfileId: PROFILE, identityReference: IDENTITY, sessionHealth: "healthy" };
  const resolver = new CamoufoxExecutionSessionResolver({
    accountRegistry: [account], profileReference: PROFILE, hostAttestation: ATTESTATION,
    sessionAuthorityReference: "standing-authority-fixture",
    coordinator: { async acquire() { calls.push("profile-acquire"); return { ready: true, handle: { profileFingerprint: "fp" } }; }, async release() { calls.push("profile-release"); return { released: true }; } },
    protocolFactory: async () => value
  });
  const result = await resolver.resolve({ platform: "linkedin", accountId: "linkedin_primary", provider: "camoufox", providerProfileId: PROFILE, identityReference: IDENTITY });
  assert.equal(result.ready, true);
  assert.equal(result.session.provider, "camoufox");
  assert.equal(result.session.profileReference, PROFILE);
  assert.equal(result.session.authorityReference, "standing-authority-fixture");
  assert.equal(result.sessionAuthorityReference, "standing-authority-fixture");
  assert.match(result.session.toJSON().authorityReference, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(calls, ["profile-acquire"]);
  await result.release();
  assert.deepEqual(calls, ["profile-acquire", "profile-release"]);
  const wrongProvider = await resolver.resolve({ platform: "linkedin", accountId: "linkedin_primary", provider: "orca", providerProfileId: PROFILE, identityReference: IDENTITY });
  assert.equal(wrongProvider.ready, false);
  assert.equal(wrongProvider.code, "PROVIDER_BINDING_MISMATCH");
});

test("Camoufox resolver rejects same profile reference from another provider", async () => {
  const account = { platform: "linkedin", accountId: "linkedin_primary", provider: "gpm", profileRef: PROFILE, providerProfileId: PROFILE, identityReference: IDENTITY, sessionHealth: "healthy" };
  const resolver = new CamoufoxExecutionSessionResolver({ accountRegistry: [account], profileReference: PROFILE, sessionAuthorityReference: "standing-authority-fixture", hostAttestation: ATTESTATION, coordinator: { acquire() {}, release() {} }, protocolFactory: async () => client().value });
  const result = await resolver.resolve({ platform: "linkedin", accountId: "linkedin_primary", provider: "camoufox", providerProfileId: PROFILE, identityReference: IDENTITY });
  assert.equal(result.ready, false);
  assert.equal(result.code, "PROVIDER_BINDING_MISMATCH");
});
