import test from "node:test";
import assert from "node:assert/strict";
import { GpmExecutionSession } from "../src/gpm-execution-session.mjs";

const account = { platform: "linkedin", accountId: "acct-a", profileRef: "profile-a", profileFingerprint: "fingerprint-a" };
function rig({ attach = async ({ platform, accountId, profileReference }) => ({ state: "READY", identity: { platform, accountId, profileReference }, client: {} }) } = {}) {
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
test("handle serialization excludes profile and secret material", async () => {
  const { session } = rig({ attach: async ({ platform, accountId, profileReference }) => ({ state: "READY", identity: { platform, accountId, profileReference }, client: { token: "secret" } }) });
  const result = await session.acquire(); const serialized = JSON.stringify(result); assert.equal(serialized.includes("profile-a"), false); assert.equal(serialized.includes("secret"), false);
});
