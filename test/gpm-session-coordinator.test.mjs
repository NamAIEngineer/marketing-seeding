import test from "node:test";
import assert from "node:assert/strict";
import { GpmSessionCoordinator } from "../src/gpm-session-coordinator.mjs";
import { createHash } from "node:crypto";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const account = { platform: "linkedin", accountId: "acct-a", profileRef: "raw-profile-a", profileFingerprint: hash("raw-profile-a") };
const selected = (a = account) => ({ status: "SELECTED", selected: a });
function rig({ health = { status: "READY", platform: "linkedin", accountId: "acct-a", profileFingerprint: account.profileFingerprint }, selector = () => selected(), start = async () => ({ endpoint: "http://runtime.test", runtimeIdentity: { provider: "fake", version: "1" } }), stop = async () => ({ acknowledged: true }) } = {}) {
  const calls = { probe: 0, start: 0, stop: 0 };
  const lifecycle = { start: async (p) => { calls.start++; return start(p); }, stop: async (p) => { calls.stop++; return stop(p); } };
  const coordinator = new GpmSessionCoordinator({ accountRegistry: [account], selectAccountRuntimeCandidate: selector, lifecycle, healthProbe: async () => { calls.probe++; return health; }, clock: () => new Date("2026-01-01T00:00:00Z") });
  return { coordinator, calls };
}
test("deterministic selection and exact healthy binding starts one lease", async () => {
  const { coordinator, calls } = rig(); const result = await coordinator.acquire({ platform: "linkedin", campaignId: "c" });
  assert.equal(result.status, "READY"); assert.equal(calls.probe, 1); assert.equal(calls.start, 1);
  assert.equal(result.handle.accountId, "acct-a"); assert.equal(result.handle.profileFingerprint, account.profileFingerprint);
  assert.equal(result.handle.profileRef, undefined); assert.equal(result.handle.runtimeIdentity.provider, "fake");
});
test("ineligible, challenge, unknown and mismatched health fail before start", async (t) => {
  for (const health of [{ status: "challenge" }, { status: "unknown" }, { status: "READY", platform: "x", accountId: "acct-a", profileFingerprint: account.profileFingerprint }]) {
    const { coordinator, calls } = rig({ health }); const result = await coordinator.acquire(); assert.equal(result.ready, false); assert.equal(calls.start, 0);
  }
  const { coordinator, calls } = rig({ selector: () => ({ status: "NO_ELIGIBLE_ACCOUNT", selected: null }) });
  assert.equal((await coordinator.acquire()).code, "NO_ELIGIBLE_ACCOUNT"); assert.equal(calls.start, 0);
});
test("wrong explicit profile reference fails even when fingerprint matches", async () => {
  const { coordinator, calls } = rig({ health: { status: "READY", platform: "linkedin", accountId: "acct-a", profileRef: "wrong-profile", profileFingerprint: account.profileFingerprint } });
  const result = await coordinator.acquire(); assert.equal(result.code, "HEALTH_BINDING_MISMATCH"); assert.equal(calls.start, 0);
});
test("release stops exactly once and rejects duplicate or foreign handles", async () => {
  const { coordinator, calls } = rig(); const result = await coordinator.acquire(); const handle = result.handle;
  assert.deepEqual(await coordinator.release(handle), { released: true, status: "RELEASED" });
  assert.deepEqual(await coordinator.release(handle), { released: true, status: "ALREADY_RELEASED", code: "DUPLICATE_RELEASE" });
  assert.equal(calls.stop, 1); assert.equal((await coordinator.release({ ...handle })).code, "FOREIGN_HANDLE"); assert.equal(calls.stop, 1);
});
test("no retry or fallback after start failure; constructor has no IO", async () => {
  let starts = 0; const lifecycle = { start: async () => { starts++; throw new Error("no"); }, stop: async () => {} };
  let probes = 0; const coordinator = new GpmSessionCoordinator({ accountRegistry: [account], selectAccountRuntimeCandidate: () => selected(), lifecycle, healthProbe: async () => { probes++; return { status: "READY", platform: "linkedin", accountId: "acct-a", profileFingerprint: account.profileFingerprint }; } });
  assert.equal((await coordinator.acquire()).code, "START_FAILED"); assert.equal(starts, 1); assert.equal(probes, 1);
});
test("health probe can reject and result omits raw ids and secret fields", async () => {
  const { coordinator } = rig({ health: { status: "READY", platform: "linkedin", accountId: "acct-a", profileFingerprint: account.profileFingerprint, token: "secret" }, start: async () => ({ endpoint: "http://x", runtimeIdentity: { websocketUrl: "ws://x", token: "secret" } }) });
  const result = await coordinator.acquire(); const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("raw-profile-a"), false); assert.equal(serialized.includes("secret"), false); assert.equal(result.handle.runtimeIdentity.token, undefined);
});
test("runtime identity drops profile fields and unsafe credential URLs", async () => {
  const { coordinator } = rig({ start: async () => ({ runtimeIdentity: { provider: "fake", profileRef: "raw-profile-a", profileId: "raw-profile-a", endpoint: "http://u:p@runtime.test/?token=secret", nested: { token: "secret" } } }) });
  const result = await coordinator.acquire(); const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("raw-profile-a"), false); assert.equal(serialized.includes("secret"), false);
  assert.equal(result.handle.runtimeIdentity.profileRef, undefined); assert.equal(result.handle.runtimeIdentity.endpoint, undefined);
});
