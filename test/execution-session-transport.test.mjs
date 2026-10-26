import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionSession } from "../src/execution-session.mjs";
import { GpmExecutionTransport } from "../src/gpm-execution-transport.mjs";

const attestation = { host: "local", runtime: "gpm", version: "5.1.2", evidence: "read-only-probe" };
const session = () => new ExecutionSession({ lifecycle: "READY", provider: "gpm", profileReference: "profile-1", providerProfileId: "profile-1", platform: "linkedin", accountId: "acct-1", identityReference: "https://www.linkedin.com/in/acct-1", expectedIdentity: { provider: "gpm", providerProfileId: "profile-1", platform: "linkedin", accountId: "acct-1", identityReference: "https://www.linkedin.com/in/acct-1" }, capabilities: ["navigate", "click"], transportRef: { id: "gpm-execution" }, attestation });
function client() { return { async observeIdentity() { return { state: "READY", provider: "gpm", providerProfileId: "profile-1", profileReference: "profile-1", platform: "linkedin", accountId: "acct-1", identityReference: "https://www.linkedin.com/in/acct-1" }; }, async navigate() {}, async snapshot() {}, async resolve() {}, async type() {}, async click() { return { status: "COMMAND_COMPLETED" }; }, async observeTransition() {}, async verifyActivation() {}, async detach() {} }; }

test("session is immutable, bounded, and rejects unusable lifecycle", () => {
  const value = new ExecutionSession({ ...session(), expiresAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(value.accountId, "acct-1");
  assert.throws(() => value.assertUsable({ now: Date.parse("2999-01-01"), }), /expired|not usable/);
  assert.throws(() => new ExecutionSession({ ...value, lifecycle: "BOGUS" }), /lifecycle/);
});

test("GPM transport requires injected attestation/protocol and verifies identity", async () => {
  const missing = new GpmExecutionTransport({ profileReference: "profile-1", sessionHandle: "s1", protocolFactory: async () => client() });
  assert.equal((await missing.health()).reason, "GPM_HOST_ATTESTATION_REQUIRED");
  const transport = new GpmExecutionTransport({ profileReference: "profile-1", sessionHandle: "s1", protocolFactory: async () => client(), hostAttestation: attestation });
  assert.equal((await transport.health()).state, "READY");
  const attached = await transport.attach(session());
  assert.equal(attached.provider, "gpm");
  await assert.rejects(() => transport.click("post", {}), /validation/);
  await transport.detach();
  assert.equal((await transport.detach()).status, "ALREADY_DETACHED");
});

test("GPM transport attaches an inert protocol client before identity observation", async () => {
  const calls = [];
  const transport = new GpmExecutionTransport({
    profileReference: "profile-1", sessionHandle: "s1",
    protocolFactory: async () => ({
      async attach() { calls.push("attach"); },
      async observeIdentity() { calls.push("identity"); return { state: "READY", provider: "gpm", providerProfileId: "profile-1", profileReference: "profile-1", platform: "linkedin", accountId: "acct-1", identityReference: "https://www.linkedin.com/in/acct-1" }; },
      async navigate() {}, async snapshot() {}, async resolve() {}, async type() {}, async click() {},
      async observeTransition() {}, async verifyActivation() {}, async detach() {}
    }),
    hostAttestation: attestation
  });
  await transport.attach(new ExecutionSession({ lifecycle: "READY", provider: "gpm", profileReference: "profile-1", platform: "linkedin", accountId: "acct-1", transportRef: { id: "gpm" }, transportIdentity: transport.runtimeIdentity(), attestation }));
  assert.deepEqual(calls, ["attach", "identity"]);
  await transport.detach();
});

test("GPM transport fails closed on challenge and identity mismatch", async () => {
  const challenged = new GpmExecutionTransport({ profileReference: "profile-1", sessionHandle: "s1", protocolFactory: async () => ({ ...client(), async observeIdentity() { return { state: "CHALLENGED", platform: "linkedin", accountId: "acct-1" }; } }), hostAttestation: attestation });
  await assert.rejects(() => challenged.attach(session()), /challenge/);
  const mismatch = new GpmExecutionTransport({ profileReference: "profile-1", sessionHandle: "s1", protocolFactory: async () => ({ ...client(), async observeIdentity() { return { state: "READY", platform: "linkedin", accountId: "other" }; } }), hostAttestation: attestation });
  await assert.rejects(() => mismatch.attach(session()), /match/);
});

test("browser surface delegates generic protocol methods and preserves identity", async () => {
  const calls = [];
  const names = ["listTabs","showTab","navigate","waitForUrl","waitForExpression","evaluate","snapshot","fill","upload","uploadSelector","browserCommandCount"];
  const c = client();
  for (const name of names) c[name] = async (...args) => { calls.push([name, ...args]); return name === "browserCommandCount" ? 7 : { name }; };
  const transport = new GpmExecutionTransport({ profileReference: "profile-1", sessionHandle: "s1", protocolFactory: async () => c, hostAttestation: attestation });
  await transport.attach(session());
  const surface = transport.asBrowserSurface();
  for (const name of names) await surface[name]("x");
  assert.equal(calls.length, names.length);
  assert.equal(surface.runtimeIdentity, undefined);
  assert.deepEqual(transport.runtimeIdentity(), { transport: "gpm-execution", provider: "gpm", providerVersion: "5.1.2" });
});

test("unsupported browser surface capability fails closed", async () => {
  const transport = new GpmExecutionTransport({ profileReference: "profile-1", sessionHandle: "s1", protocolFactory: async () => client(), hostAttestation: attestation });
  await transport.attach(session());
  assert.throws(() => transport.asBrowserSurface().evaluate("p", "x"), { code: "GPM_PROTOCOL_CAPABILITY_UNSUPPORTED" });
});

test("browser surface serialization excludes profile and attestation secrets", async () => {
  const transport = new GpmExecutionTransport({ profileReference: "profile-secret", sessionHandle: "session-secret", protocolFactory: async () => client(), hostAttestation: { ...attestation, evidence: "token-secret" } });
  const serialized = JSON.stringify({ identity: transport.runtimeIdentity(), surface: transport.browserSurface });
  assert.equal(serialized.includes("profile-secret"), false);
  assert.equal(serialized.includes("session-secret"), false);
  assert.equal(serialized.includes("token-secret"), false);
});
