import test from "node:test";
import assert from "node:assert/strict";
import { createGpmExecutionSessionResolver } from "../src/gpm-execution-session-resolver.mjs";

const attestation = { host: "local", runtime: "gpm", version: "5.1.2", evidence: "fixture", observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2999-01-01T00:00:00.000Z" };
const account = { platform: "linkedin", accountId: "acct-a", provider: "gpm", providerProfileId: "profile-a", profileRef: "profile-a", identityReference: "https://www.linkedin.com/in/acct-a", sessionHealth: "healthy", risk: "normal" };

function rig(overrides = {}) {
  const calls = [];
  const coordinator = {
    async acquire() { calls.push("profile-acquire"); return { ready: true, status: "READY", handle: { profileFingerprint: "fp-a" } }; },
    async release() { calls.push("profile-release"); return { released: true, status: "RELEASED" }; }
  };
  const attach = async (binding) => { calls.push(["attach", binding]); return { state: "READY", identity: { provider: "gpm", platform: "linkedin", accountId: "acct-a", profileReference: "profile-a", providerProfileId: "profile-a", identityReference: "https://www.linkedin.com/in/acct-a" }, transport: { runtimeIdentity: () => ({ transport: "gpm-fixture", provider: "gpm", providerVersion: "5.1.2" }), async attach() { calls.push("transport-attach"); }, async detach() { calls.push("transport-detach"); } }, browserSurface: { listTabs() {}, showTab() {}, navigate() {}, waitForUrl() {}, waitForFeed() {}, waitForExpression() {}, evaluate() {}, snapshot() {}, fill() {} } }; };
  const resolver = createGpmExecutionSessionResolver({ provider: "gpm", profileReference: "profile-a", sessionAuthority: "authority-a", hostAttestation: attestation, accountRegistry: [account], coordinator, attach, ...overrides });
  return { resolver, calls };
}

test("resolver construction is inert and requires explicit authority/attestation", () => {
  let calls = 0;
  const { resolver } = rig({ attach: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(resolver.provider, "gpm");
  assert.equal(JSON.stringify(resolver).includes("authority-a"), false);
  assert.throws(() => createGpmExecutionSessionResolver({ ...rig().resolver, provider: "orca" }), { code: "GPM_RESOLVER_PROVIDER_MISMATCH" });
  assert.throws(() => createGpmExecutionSessionResolver({ provider: "gpm", profileReference: "p", sessionAuthority: "a", accountRegistry: [account], coordinator: {}, attach: async () => {}, hostAttestation: attestation }), { code: "GPM_RESOLVER_COORDINATOR_REQUIRED" });
});

test("resolver binds exact profile/account and returns a releasable typed session", async () => {
  const { resolver, calls } = rig();
  const result = await resolver.resolve({ platform: "linkedin", accountId: "acct-a" });
  assert.equal(result.ready, true);
  assert.equal(result.session.provider, "gpm");
  assert.equal(result.session.profileReference, "profile-a");
  assert.equal(result.transport.runtimeIdentity().provider, "gpm");
  await result.release();
  assert.deepEqual(calls.map((item) => Array.isArray(item) ? item[0] : item), ["profile-acquire", "attach", "transport-attach", "transport-detach", "profile-release"]);
});

test("resolver fails closed on configured profile drift and secret-like input", async () => {
  const { resolver } = rig({ accountRegistry: [{ ...account, profileRef: "other-profile", providerProfileId: "other-profile" }] });
  const result = await resolver.acquire({ platform: "linkedin", accountId: "acct-a" });
  assert.equal(result.ready, false);
  assert.equal(result.code, "PROFILE_BINDING_MISSING");
  assert.throws(() => createGpmExecutionSessionResolver({ provider: "gpm", profileReference: "p", sessionAuthority: "a", hostAttestation: attestation, accountRegistry: [account], coordinator: { acquire() {}, release() {} }, attach: async () => {}, cookies: "raw" }), { code: "GPM_RESOLVER_SECRET_FIELD" });
});
