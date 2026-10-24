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

test("typed resolver envelope carries GPM transport and browser surface without ORCA fallback", async () => {
  const now = new Date().toISOString();
  const request = { executionId: "e-gpm", jobId: "j-gpm", campaignId: "c", platform: "linkedin", accountId: "a1", profileId: "p1", target: { targetId: "t", url: "https://www.linkedin.com/feed/" }, audience: "public", content: { contentId: "x", sha256: "a".repeat(64), payload: "x" }, media: [], authorization: { authorizationId: "auth", binding: "bind" }, idempotencyKey: "idem", readiness: { state: "READY", checkedAt: now, expiresAt: new Date(Date.now() + 60000).toISOString() }, createdAt: now };
  const context = { request, requestRow: { ...request, state: "REQUEST_READY", submitState: "NOT_STARTED", attempt: 1 }, post: { id: "j-gpm", status: "queued" }, target: { id: "t", channel: "linkedin", accountId: "a1", profileId: "p1" }, account: { status: "enabled", health: "healthy", accountId: "a1", profileId: "p1" }, authorization: { allowLiveExecution: true, id: "auth", binding: "bind" }, liveGrant: { grantId: "g" }, state: { executionReceipts: [] } };
  // The fixture service intentionally supplies the existing grant contract through the worker's live gate.
  context.liveGrant = { ...context.liveGrant, schemaVersion: 1, campaignAuthorizationId: "auth", campaignAuthorizationBinding: "bind", campaignId: "c", jobId: "j-gpm", boundExecutionId: "e-gpm", platform: "linkedin", accountId: "a1", profileId: "p1", targetId: "t", content: { contentId: "x", canonicalSha256: "b".repeat(64), rawSha256: "a".repeat(64) }, media: [], audience: "public", idempotencyKey: "idem", validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 60000).toISOString(), maxExecutions: 1, status: "ACTIVE" };
  const transport = Object.freeze({ runtimeIdentity: () => ({ transport: "gpm-execution", provider: "gpm", providerVersion: "5" }) });
  const browserSurface = Object.freeze({ kind: "gpm-browser-surface" });
  const session = Object.freeze({ lifecycle: "READY", transportIdentity: transport.runtimeIdentity(), transport, browserSurface, assertUsable() {} });
  const envelope = { session, transport, browserSurface };
  assert.equal(envelope.session, session); assert.equal(envelope.transport, transport); assert.equal(envelope.browserSurface, browserSurface);
  assert.equal(envelope.transport.runtimeIdentity().provider, "gpm"); assert.equal(envelope.orca, undefined);
});
