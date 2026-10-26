import test from "node:test";
import assert from "node:assert/strict";
import { GpmBrowserSession } from "../src/gpm-browser-session.mjs";

const selection = {
  provider: "gpm",
  platform: "linkedin",
  accountId: "acct-a",
  profileReference: "profile-a",
  providerProfileId: "profile-a",
  identityReference: "https://www.linkedin.com/in/acct-a"
};
const client = { async navigate() { return { status: "COMMAND_COMPLETED" }; }, async snapshot() { return {}; }, async closeOwnedResources() {}, secret: "raw-secret" };

test("construction is inert and attach exposes bounded transport", async () => {
  let calls = 0;
  const session = new GpmBrowserSession({ selection, attach: async (binding) => { calls++; assert.deepEqual(binding, selection); return { state: "READY", identity: selection, client }; } });
  assert.equal(calls, 0);
  const attached = await session.attach();
  assert.equal(calls, 1);
  assert.equal(attached.status, "ATTACHED");
  assert.equal(attached.runtimeIdentity.provider, "gpm");
  assert.equal("accountId" in attached.runtimeIdentity, false);
  assert.equal("profileReference" in attached.runtimeIdentity, false);
  assert.equal(typeof attached.transport.navigate, "function");
  assert.deepEqual(await attached.transport.navigate("/bounded"), { status: "COMMAND_COMPLETED" });
  const serialized = JSON.stringify(attached);
  assert.equal(serialized.includes("profileReference"), false);
  assert.equal(serialized.includes("profile-a"), false);
  assert.equal(serialized.includes("raw-secret"), false);
  assert.equal(serialized.includes("client"), false);
});

test("missing, mismatched, challenge, and unknown identities fail closed", async (t) => {
  await t.test("missing", async () => await assert.rejects(new GpmBrowserSession({ selection, attach: async () => ({ client }) }).attach(), { code: "SESSION_IDENTITY_UNKNOWN" }));
  await t.test("mismatch", async () => await assert.rejects(new GpmBrowserSession({ selection, attach: async () => ({ state: "READY", identity: { ...selection, accountId: "other" }, client }) }).attach(), { code: "SESSION_BINDING_MISMATCH" }));
  await t.test("challenge", async () => await assert.rejects(new GpmBrowserSession({ selection, attach: async () => ({ state: "CHALLENGE", client }) }).attach(), { code: "SESSION_CHALLENGE" }));
  await t.test("unknown", async () => await assert.rejects(new GpmBrowserSession({ selection, attach: async () => ({ state: "UNKNOWN", client }) }).attach(), { code: "SESSION_IDENTITY_UNKNOWN" }));
});

test("does not infer binding from names or endpoint metadata", async () => {
  const session = new GpmBrowserSession({ selection, attach: async () => ({ state: "READY", identity: { platform: "linkedin", accountId: "acct-a", profileReference: "other" }, endpoint: "http://profile-a.example", client }) });
  await assert.rejects(session.attach(), { code: "SESSION_BINDING_MISMATCH" });
});
