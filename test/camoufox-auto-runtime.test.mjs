import assert from "node:assert/strict";
import test from "node:test";
import { createAutoCamoufoxExecutionSessionResolver } from "../src/camoufox-auto-runtime.mjs";

const IDENTITY = "https://www.linkedin.com/in/owner";

function fakeRuntime() {
  const released = [];
  const coordinator = {
    async acquire({ profileReference }) { return { ready: true, status: "LEASED", handle: { profileReference, profileFingerprint: "sha256:profile" } }; },
    async release(handle) { released.push(handle.profileReference); return { released: true }; },
    protocolFactory() {
      return async () => ({
        async attach() {},
        async observeIdentity() { return { state: "READY", provider: "camoufox", platform: "linkedin", accountId: "acct-1", providerProfileId: "profile-1", identityReference: IDENTITY }; },
        async navigate() {}, async snapshot() { return ""; }, async resolve() {}, async type() {}, async click() {}, async observeTransition() {}, async verifyActivation() {}, async detach() {}
      });
    }
  };
  return { coordinator, released };
}

test("auto Camoufox resolver provisions lazily from sanitized canonical account state", async () => {
  const runtime = fakeRuntime();
  let provisions = 0;
  const resolver = createAutoCamoufoxExecutionSessionResolver({
    runtimeRoot: "/tmp/marketing-seeding-test-runtime",
    profileRoot: "/tmp/marketing-seeding-test-profiles",
    provisionRuntime: async () => { provisions += 1; return { ...runtime, packageVersion: "0.5.8" }; },
    stateReader: async () => ({ executionAccounts: [{ platform: "linkedin", accountId: "acct-1", provider: "camoufox", profileId: "profile-1", providerProfileId: "profile-1", identityReference: IDENTITY, health: "healthy", status: "enabled" }] })
  });
  const envelope = await resolver.acquire({ provider: "camoufox", platform: "linkedin", accountId: "acct-1", providerProfileId: "profile-1", profileId: "profile-1", identityReference: IDENTITY });
  assert.equal(envelope.ready, true);
  assert.equal(envelope.session.provider, "camoufox");
  assert.equal(envelope.session.accountId, "acct-1");
  assert.equal(provisions, 1);
  await envelope.release();
  assert.deepEqual(runtime.released, ["profile-1"]);
});

test("auto Camoufox resolver rejects an account without verified identity binding", async () => {
  const runtime = fakeRuntime();
  const resolver = createAutoCamoufoxExecutionSessionResolver({
    provisionRuntime: async () => ({ ...runtime, packageVersion: "0.5.8" }),
    stateReader: async () => ({ executionAccounts: [{ platform: "linkedin", accountId: "acct-unknown", provider: "camoufox", profileId: "profile-unknown", providerProfileId: "profile-unknown", health: "unknown", status: "enabled" }] })
  });
  const result = await resolver.acquire({ provider: "camoufox", platform: "linkedin", accountId: "acct-unknown", providerProfileId: "profile-unknown", profileId: "profile-unknown" });
  assert.equal(result.ready, false);
  assert.equal(result.code, "PROFILE_BINDING_MISSING");
});
