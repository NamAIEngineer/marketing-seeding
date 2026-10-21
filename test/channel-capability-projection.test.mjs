import test from "node:test";
import assert from "node:assert/strict";
import { projectChannelCapabilities } from "../src/channel-capability-projection.mjs";

const channels = {
  linkedin: { label: "LinkedIn", requiresRulesReview: false, requiresHumanApproval: true, publishMode: "AUTONOMOUS_WHEN_AUTHORIZED" },
  reddit: { label: "Reddit", requiresRulesReview: true, requiresHumanApproval: true }
};
const ready = (id, channel, rulesStatus = "not_required") => ({ id, channel, status: "active", rulesStatus, readiness: { state: "READY", expiresAt: "2030-01-01T00:00:00.000Z" } });

test("projects deterministic channel readiness without authority side effects", () => {
  const result = projectChannelCapabilities({ channels, targets: [ready("li", "linkedin")], posts: [{ targetId: "li" }], now: "2029-01-01T00:00:00.000Z" });
  assert.deepEqual(result.map(({ channel, status, freshReadyTargetCount, postCount }) => ({ channel, status, freshReadyTargetCount, postCount })), [
    { channel: "linkedin", status: "READY", freshReadyTargetCount: 1, postCount: 1 },
    { channel: "reddit", status: "NEEDS_TARGET", freshReadyTargetCount: 0, postCount: 0 }
  ]);
  assert.equal(result[0].advisory, true);
  assert.equal(result[0].publishMode, "AUTONOMOUS_WHEN_AUTHORIZED");
  assert.equal(result[0].authoritySideEffects, false);
  assert.equal(result[0].externalSideEffects, false);
});

test("keeps legacy approval policy separate from standing autonomous publish capability", () => {
  const result = projectChannelCapabilities({ channels, targets: [], posts: [], now: "2029-01-01T00:00:00.000Z" });
  const linkedin = result.find((item) => item.channel === "linkedin");
  const reddit = result.find((item) => item.channel === "reddit");
  assert.equal(linkedin.requiresHumanApproval, true);
  assert.equal(linkedin.publishMode, "AUTONOMOUS_WHEN_AUTHORIZED");
  assert.equal(reddit.requiresHumanApproval, true);
  assert.equal(reddit.publishMode, "HUMAN_APPROVAL_REQUIRED");
});

test("fails closed for pending rules, stale readiness and inactive targets", () => {
  const result = projectChannelCapabilities({ channels, targets: [
    ready("r1", "reddit", "pending"),
    { id: "r2", channel: "reddit", status: "paused", rulesStatus: "reviewed", readiness: { state: "READY", expiresAt: "2030-01-01T00:00:00.000Z" } },
    { id: "li", channel: "linkedin", status: "active", rulesStatus: "not_required", readiness: { state: "READY", expiresAt: "2020-01-01T00:00:00.000Z" } }
  ], now: "2029-01-01T00:00:00.000Z" });
  assert.equal(result.find((item) => item.channel === "reddit").status, "RULES_REVIEW_REQUIRED");
  assert.equal(result.find((item) => item.channel === "linkedin").status, "AUTH_REQUIRED");
});

test("fails closed for future or identity-mismatched normalized readiness", () => {
  const future = ready("future", "linkedin");
  future.accountId = "acct-1";
  future.profileId = "profile-1";
  future.readiness = {
    state: "READY",
    checkedAt: "2030-01-01T00:01:00.000Z",
    expiresAt: "2030-01-01T00:05:00.000Z",
    platform: "linkedin",
    accountId: "acct-1",
    profileId: "profile-1",
    targetId: "different-target",
    binding: "stale-binding"
  };
  const result = projectChannelCapabilities({ channels, targets: [future], now: "2030-01-01T00:00:00.000Z" });
  assert.equal(result.find((item) => item.channel === "linkedin").status, "AUTH_REQUIRED");
});
