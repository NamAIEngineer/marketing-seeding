import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccountRuntimeRegistry,
  normalizeAccountRuntimeEntry,
  selectAccountRuntimeCandidate,
  projectAccountRuntimeMissionControl
} from "../src/account-runtime-registry.mjs";

const base = {
  platform: "linkedin",
  accountId: "account-a",
  profileRef: "gpm-profile-a",
  sessionHealth: "healthy",
  permissions: { publish: true, read: "granted" },
  allowedCampaigns: ["campaign-1"],
  allowedTargets: ["target-1"],
  runtimeFingerprint: "runtime-a"
};

test("registry normalizes, sorts and freezes bounded references", () => {
  const registry = createAccountRuntimeRegistry([
    { ...base, accountId: "account-b", profileRef: "profile-b" },
    base
  ]);
  assert.deepEqual(registry.map((item) => item.accountId), ["account-a", "account-b"]);
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry[0].quota), true);
  assert.deepEqual(registry[0].permissions, ["publish:granted", "read:granted"]);
});

test("secret-like account fields are rejected before normalization", () => {
  assert.throws(() => normalizeAccountRuntimeEntry({ ...base, cookie: "raw-cookie" }), /secret-like/);
  assert.throws(() => normalizeAccountRuntimeEntry({ ...base, nested: { accessToken: "raw-token" } }), /secret-like/);
});

test("selection is deterministic and challenge states are quarantined", () => {
  const result = selectAccountRuntimeCandidate([
    { ...base, accountId: "healthy-b", profileRef: "profile-b" },
    { ...base, accountId: "needs-mfa", profileRef: "profile-mfa", sessionHealth: "mfa_required" },
    { ...base, accountId: "disabled", profileRef: "profile-disabled", sessionHealth: "disabled" }
  ], { platform: "linkedin", campaignId: "campaign-1", targetId: "target-1", preferredAccountIds: ["healthy-b"], now: "2026-10-23T00:00:00.000Z" });
  assert.equal(result.status, "SELECTED");
  assert.equal(result.selected.accountId, "healthy-b");
  assert.equal(result.candidates.find((item) => item.accountId === "needs-mfa").eligibilityState, "QUARANTINED");
  assert.equal(result.candidates.find((item) => item.accountId === "disabled").eligibilityState, "QUARANTINED");
});

test("cooldown and quota fail closed without changing registry state", () => {
  const result = selectAccountRuntimeCandidate([
    { ...base, cooldown: { until: "2026-10-24T00:00:00.000Z" } },
    { ...base, accountId: "quota", profileRef: "profile-quota", quota: { dailyLimit: 1, usedToday: 1 } }
  ], { platform: "linkedin", campaignId: "campaign-1", targetId: "target-1", now: "2026-10-23T00:00:00.000Z" });
  assert.equal(result.status, "NO_ELIGIBLE_ACCOUNT");
  assert.match(result.candidates[0].eligibilityReasons.join(","), /cooldown:active/);
  assert.match(result.candidates[1].eligibilityReasons.join(","), /quota:daily_limit/);
});

test("Mission Control projection is read-only and secret-free", () => {
  const projection = projectAccountRuntimeMissionControl([base], { platform: "linkedin", campaignId: "campaign-1", targetId: "target-1", now: "2026-10-23T00:00:00.000Z" });
  assert.equal(projection.readOnly, true);
  assert.equal(projection.selection.selectedAccountId, "account-a");
  assert.equal(Object.hasOwn(projection.accounts[0], "cookie"), false);
  assert.equal(Object.hasOwn(projection.accounts[0], "runtimeSecret"), false);
});
