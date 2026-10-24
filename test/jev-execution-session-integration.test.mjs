import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionSession } from "../src/execution-session.mjs";

test("session contract supports bounded resolver lifecycle and identity fence", () => {
  const session = new ExecutionSession({ lifecycle: "READY", provider: "gpm", profileReference: "p1", platform: "linkedin", accountId: "a1", expectedIdentity: { platform: "linkedin", accountId: "a1" }, transportRef: { id: "gpm" }, transportIdentity: { transport: "gpm-execution", provider: "gpm", providerVersion: "5" } });
  assert.equal(session.provider, "gpm");
  assert.equal(session.profileReference, "p1");
  assert.equal(session.expectedIdentity.accountId, "a1");
  assert.equal(Object.getOwnPropertyDescriptor(session, "accountId").writable, false);
});
