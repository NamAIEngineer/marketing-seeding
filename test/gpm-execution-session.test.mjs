import test from "node:test";
import assert from "node:assert/strict";
import { GpmExecutionSession } from "../src/gpm-execution-session.mjs";
import { ExecutionSession } from "../src/execution-session.mjs";
import { GpmExecutionTransport } from "../src/gpm-execution-transport.mjs";

const account = { platform: "linkedin", accountId: "acct-a", provider: "gpm", providerProfileId: "profile-a", profileRef: "profile-a", identityReference: "https://www.linkedin.com/in/acct-a", profileFingerprint: "fingerprint-a" };
function rig({ attach = async ({ provider, platform, accountId, profileReference, providerProfileId, identityReference }) => ({ state: "READY", identity: { provider, platform, accountId, profileReference, providerProfileId, identityReference }, client: {} }) } = {}) {
  const calls = { acquire: 0, release: 0, attach: 0 };
  const coordinator = { acquire: async () => { calls.acquire++; return { ready: true, status: "READY", handle: { profileFingerprint: "fingerprint-a", runtimeIdentity: { provider: "gpm" } } }; }, release: async () => { calls.release++; return { released: true, status: "RELEASED" }; } };
  const session = new GpmExecutionSession({ coordinator, accountRegistry: [account], selectAccountRuntimeCandidate: () => ({ status: "SELECTED", selected: account }), attach: async (binding) => { calls.attach++; return attach(binding); }, clock: () => new Date("2026-01-01T00:00:00Z") });
  return { session, calls };
}
test("selection, coordinator acquire, exact attach sequence returns bounded handle", async () => {
  const { session, calls } = rig(); const result = await session.acquire({ campaignId: "c" });
  assert.equal(result.status, "READY"); assert.deepEqual(calls, { acquire: 1, release: 0, attach: 1 });
  assert.equal(result.handle.accountId, "acct-a"); assert.equal(result.handle.transport != null, true);
  assert.equal(JSON.stringify(result).includes("profile-a"), false);
});
test("attach failure performs exactly one coordinator cleanup and returns bounded failure", async () => {
  const { session, calls } = rig({ attach: async () => { throw Object.assign(new Error("x"), { code: "SESSION_CHALLENGE" }); } });
  const result = await session.acquire(); assert.equal(result.ready, false); assert.equal(result.code, "SESSION_CHALLENGE"); assert.deepEqual(calls, { acquire: 1, release: 1, attach: 1 });
});
test("release owns exact handle, rejects foreign, duplicate without second cleanup", async () => {
  const { session, calls } = rig(); const { handle } = await session.acquire();
  assert.deepEqual(await session.release(handle), { released: true, status: "RELEASED" });
  assert.deepEqual(await session.release(handle), { released: true, status: "ALREADY_RELEASED", code: "DUPLICATE_RELEASE" });
  assert.equal((await session.release({ ...handle })).code, "FOREIGN_HANDLE"); assert.equal(calls.release, 1);
});
test("missing binding fails before coordinator or attach", async () => {
  const { session, calls } = rig(); const result = await new GpmExecutionSession({ coordinator: { acquire: async () => { calls.acquire++; }, release: async () => {} }, accountRegistry: [{}], selectAccountRuntimeCandidate: () => ({ status: "SELECTED", selected: { platform: "linkedin", accountId: "acct-a" } }), attach: async () => { calls.attach++; } }).acquire();
  assert.equal(result.code, "PROFILE_BINDING_MISSING"); assert.equal(calls.acquire, 0);
});
test("selected GPM session rejects request provider/account/profile/identity drift before coordinator", async () => {
  for (const [request, code] of [
    [{ provider: "orca" }, "PROVIDER_BINDING_MISMATCH"],
    [{ accountId: "other-account" }, "ACCOUNT_BINDING_MISMATCH"],
    [{ providerProfileId: "other-profile" }, "PROFILE_BINDING_MISMATCH"],
    [{ identityReference: "https://www.linkedin.com/in/other" }, "IDENTITY_BINDING_MISMATCH"]
  ]) {
    const { session, calls } = rig();
    const result = await session.acquire({ platform: "linkedin", accountId: "acct-a", ...request });
    assert.equal(result.code, code);
    assert.equal(calls.acquire, 0);
  }
});
test("handle serialization excludes profile and secret material", async () => {
  const { session } = rig({ attach: async ({ provider, platform, accountId, profileReference, providerProfileId, identityReference }) => ({ state: "READY", identity: { provider, platform, accountId, profileReference, providerProfileId, identityReference }, client: { token: "secret" } }) });
  const result = await session.acquire(); const serialized = JSON.stringify(result); assert.equal(serialized.includes("profile-a"), false); assert.equal(serialized.includes("secret"), false);
});

test("typed session attaches the injected provider transport and detaches before coordinator release", async () => {
  const calls = [];
  const transport = {
    runtimeIdentity: () => ({ transport: "gpm-execution", provider: "gpm", providerVersion: "5.1.2" }),
    async attach(session) { calls.push(["attach", session]); },
    async detach() { calls.push(["detach"]); return { detached: true, status: "DETACHED" }; }
  };
  const browserSurface = Object.freeze({ listTabs() {}, showTab() {}, navigate() {}, waitForUrl() {}, evaluate() {}, snapshot() {}, fill() {} });
  const coordinator = {
    async acquire() { calls.push(["coordinator-acquire"]); return { ready: true, status: "READY", handle: { profileFingerprint: "fp", runtimeIdentity: transport.runtimeIdentity() } }; },
    async release() { calls.push(["coordinator-release"]); return { released: true, status: "RELEASED" }; }
  };
  const session = new GpmExecutionSession({
    coordinator, accountRegistry: [account], selectAccountRuntimeCandidate: () => ({ status: "SELECTED", selected: account }),
    attach: async () => ({ state: "READY", identity: { ...account }, transport, browserSurface, capabilities: ["navigate", "click"] }),
    clock: () => new Date("2026-01-01T00:00:00Z")
  });
  const result = await session.acquire({ platform: "linkedin", accountId: "acct-a" });
  assert.equal(result.status, "READY");
  assert.equal(result.session instanceof ExecutionSession, true);
  assert.equal(calls.find(([name]) => name === "attach")[1].provider, "gpm");
  const released = await result.release();
  assert.equal(released.released, true);
  assert.deepEqual(calls.map(([name]) => name), ["coordinator-acquire", "attach", "detach", "coordinator-release"]);
});

test("transport attach failure releases both transport and profile lease exactly once", async () => {
  const calls = [];
  const transport = {
    runtimeIdentity: () => ({ transport: "gpm-execution", provider: "gpm", providerVersion: "5.1.2" }),
    async attach() { calls.push("attach"); throw Object.assign(new Error("stale"), { code: "GPM_SESSION_STALE" }); },
    async detach() { calls.push("detach"); }
  };
  const coordinator = { async acquire() { calls.push("acquire"); return { ready: true, handle: { profileFingerprint: "fp" } }; }, async release() { calls.push("release"); return { released: true }; } };
  const session = new GpmExecutionSession({ coordinator, accountRegistry: [account], selectAccountRuntimeCandidate: () => ({ selected: account }), attach: async () => ({ state: "READY", identity: { ...account }, transport, browserSurface: {} }) });
  const result = await session.acquire();
  assert.equal(result.code, "GPM_SESSION_STALE");
  assert.deepEqual(calls, ["acquire", "attach", "detach", "release"]);
});

test("real GPM transport contract is consumed by the composed execution session", async () => {
  const calls = [];
  const client = {
    async observeIdentity() { calls.push("identity"); return { state: "READY", provider: "gpm", providerProfileId: "profile-a", profileReference: "profile-a", platform: "linkedin", accountId: "acct-a", identityReference: "https://www.linkedin.com/in/acct-a" }; },
    async navigate() {}, async snapshot() {}, async resolve() {}, async type() {}, async click() {},
    async observeTransition() {}, async verifyActivation() {}, async detach() {},
    async listTabs() { return []; }, async showTab() {}, async waitForUrl() {}, async waitForExpression() {},
    async evaluate() {}, async fill() {}, async upload() {}, async uploadSelector() {}, async browserCommandCount() { return 0; }
  };
  const transport = new GpmExecutionTransport({
    profileReference: "profile-a", sessionHandle: "opaque-session",
    protocolFactory: async () => client,
    hostAttestation: { host: "local", runtime: "gpm", version: "5.1.2", evidence: "fixture", observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }
  });
  const coordinator = {
    async acquire() { calls.push("coordinator-acquire"); return { ready: true, handle: { profileFingerprint: "fp", runtimeIdentity: transport.runtimeIdentity() } }; },
    async release() { calls.push("coordinator-release"); return { released: true, status: "RELEASED" }; }
  };
  const composed = new GpmExecutionSession({
    coordinator, accountRegistry: [account], selectAccountRuntimeCandidate: () => ({ status: "SELECTED", selected: account }),
    attach: async () => ({ state: "READY", identity: { ...account }, transport, browserSurface: transport.browserSurface }),
    clock: () => new Date("2026-01-01T00:00:00Z")
  });
  const result = await composed.acquire({ platform: "linkedin", accountId: "acct-a" });
  assert.equal(result.ready, true);
  assert.equal(result.session.provider, "gpm");
  assert.equal(result.transport, transport);
  assert.equal(result.browserSurface !== undefined, true);
  assert.deepEqual(calls.slice(0, 2), ["coordinator-acquire", "identity"]);
  await result.release();
  assert.deepEqual(calls.slice(-2), ["identity", "coordinator-release"]);
});
