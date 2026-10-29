import test from "node:test";
import assert from "node:assert/strict";
import { CamoufoxLinkedInReadinessProvider } from "../src/camoufox-linkedin-readiness-provider.mjs";

const context = {
  provider: "camoufox",
  platform: "linkedin",
  accountId: "linkedin_primary",
  profileId: "linkedin:linkedin_primary",
  providerProfileId: "linkedin:linkedin_primary",
  identityReference: "https://www.linkedin.com/in/owner",
  targetId: "target-1"
};

function surface() {
  return {
    async listTabs() { return [{ id: "page-1", pageId: "page-1", profileId: context.profileId, url: "https://www.linkedin.com/feed/" }]; },
    async showTab() { return { id: "page-1", pageId: "page-1", profileId: context.profileId, url: "https://www.linkedin.com/feed/" }; },
    async navigate() {},
    async waitForFeed() {},
    async evaluate() { return { sessionAuthenticated: true, identityVerified: true, feedReachable: true, securityChallenge: false }; },
    async snapshot() { return ""; },
    async resolve() { return null; },
    async click() {},
    async fill() {},
    async detach() {}
  };
}

test("Camoufox readiness acquires exact resolver surface and releases it", async () => {
  const calls = [];
  const resolver = {
    async resolve(request) {
      calls.push(request);
      return { ready: true, browserSurface: surface(), release: async () => calls.push("released") };
    }
  };
  const provider = new CamoufoxLinkedInReadinessProvider({
    resolver,
    fallbackProvider: { async checkReadiness() { throw new Error("ORCA fallback must not run"); } },
    ttlMs: 5_000
  });
  const result = await provider.checkReadiness(context);
  assert.equal(calls[0].provider, "camoufox");
  assert.equal(calls[0].providerProfileId, context.providerProfileId);
  assert.equal(calls.at(-1), "released");
  assert.notEqual(result.reasonCode, "camoufox_session_resolver_unavailable");
});

test("Camoufox readiness fails closed without resolver", async () => {
  const provider = new CamoufoxLinkedInReadinessProvider({ resolver: null, fallbackProvider: { async checkReadiness() { throw new Error("fallback"); } } });
  const result = await provider.checkReadiness(context);
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.reasonCode, "camoufox_session_resolver_unavailable");
});

test("non-Camoufox LinkedIn requests retain fallback provider", async () => {
  const fallback = { async checkReadiness(value) { return { state: "READY", seenProvider: value.provider }; } };
  const provider = new CamoufoxLinkedInReadinessProvider({ resolver: null, fallbackProvider: fallback });
  const result = await provider.checkReadiness({ ...context, provider: "orca" });
  assert.deepEqual(result, { state: "READY", seenProvider: "orca" });
});

test("resolver failure is released and reported as retryable UNKNOWN", async () => {
  let released = false;
  const provider = new CamoufoxLinkedInReadinessProvider({
    resolver: {
      async acquire() { return { ready: true, browserSurface: null, release: async () => { released = true; } }; }
    }
  });
  const result = await provider.checkReadiness(context);
  assert.equal(released, true);
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.retryable, true);
});
