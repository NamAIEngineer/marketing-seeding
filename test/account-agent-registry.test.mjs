import test from "node:test";
import assert from "node:assert/strict";
import { createAccountAgentRegistry, normalizeAccountAgent, selectAccountAgentCandidate, projectAccountAgentMissionControl } from "../src/account-agent-registry.mjs";

const base = {
  platform: "linkedin",
  provider: "camoufox",
  accountId: "account-a",
  profileRef: "profile-a",
  providerProfileId: "profile-a",
  identityReference: "https://www.linkedin.com/in/owner-a/",
  sessionHealth: "ready",
  allowedCampaigns: ["campaign-1"],
  allowedTargets: ["target-1"],
  persona: { name: "Builder", style: "technical", voice: "direct" },
  audience: { segments: ["technical founders"], languages: ["vi-VN", "en"] },
  topicWeights: { problem_first: 0.8, launch: 0.2 },
  contentHistory: [{ contentVariantId: "variant-1" }],
  engagementHistory: [{ kind: "answer", outcome: "useful" }],
  performanceHistory: [{ qualifiedTraffic: 3 }],
  quota: { dailyLimit: 3, usedToday: 1 },
  cadence: { minIntervalMinutes: 120 },
  cooldown: {},
  authority: { reference: "standing-authority-1", source: "owner-policy", status: "active" },
  capabilities: ["publish", "reply"]
};

test("Account Agent projection is deterministic, immutable and preserves binding/persona history", () => {
  const first = normalizeAccountAgent(base);
  const second = normalizeAccountAgent(structuredClone(base));
  assert.equal(first.agentId, second.agentId);
  assert.equal(first.provider, "camoufox");
  assert.equal(first.profileRef, "profile-a");
  assert.equal(first.verifiedIdentity.reference, "https://www.linkedin.com/in/owner-a");
  assert.equal(first.eligibilityBinding.identityReference, first.verifiedIdentity.reference);
  assert.deepEqual(first.persona, { name: "Builder", style: "technical", voice: "direct", disclosure: "" });
  assert.equal(first.contentHistory.length, 1);
  assert.equal(first.performanceHistory[0].qualifiedTraffic, 3);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.eligibilityBinding), true);
});

test("secret-like account metadata fails closed", () => {
  assert.throws(() => normalizeAccountAgent({ ...base, cookie: "raw" }), /not accepted/);
  assert.throws(() => normalizeAccountAgent({ ...base, authority: { accessToken: "raw" } }), /not accepted/);
  assert.throws(() => normalizeAccountAgent({ ...base, contentHistory: [{ text: "Bearer abc" }] }), /secret-like material/);
});

test("selection binds platform/profile/campaign/target and quarantines unhealthy agents", () => {
  const registry = createAccountAgentRegistry([
    base,
    { ...base, accountId: "account-b", profileRef: "profile-b", providerProfileId: "profile-b", identityReference: "https://www.linkedin.com/in/owner-b", sessionHealth: "mfa_required" },
    { ...base, accountId: "account-c", profileRef: "profile-c", providerProfileId: "profile-c", allowedCampaigns: ["other-campaign"] }
  ]);
  const result = selectAccountAgentCandidate(registry, { platform: "linkedin", provider: "camoufox", profileRef: "profile-a", campaignId: "campaign-1", targetId: "target-1", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(result.status, "SELECTED");
  assert.equal(result.selected.accountId, "account-a");
  assert.equal(result.candidates.find((item) => item.accountId === "account-b").eligibilityState, "QUARANTINED");
  assert.equal(result.candidates.find((item) => item.accountId === "account-c").eligibilityState, "INELIGIBLE");
  const wrong = selectAccountAgentCandidate(registry, { platform: "reddit", campaignId: "campaign-1", targetId: "target-1" });
  assert.equal(wrong.status, "NO_ELIGIBLE_AGENT");
});

test("selection canonicalizes equivalent identity URLs and quarantines disabled accounts", () => {
  const result = selectAccountAgentCandidate([
    { ...base, identityReference: "https://www.linkedin.com/in/owner-a/" },
    { ...base, accountId: "disabled", profileRef: "profile-disabled", providerProfileId: "profile-disabled", status: "disabled", sessionHealth: "healthy" }
  ], {
    platform: "linkedin",
    provider: "camoufox",
    campaignId: "campaign-1",
    targetId: "target-1",
    identityReference: "https://www.linkedin.com/in/owner-a/?trk=public_profile",
    now: "2026-10-27T00:00:00.000Z"
  });
  assert.equal(result.status, "SELECTED");
  assert.equal(result.selected.accountId, "account-a");
  assert.equal(result.candidates.find((item) => item.accountId === "disabled").eligibilityState, "QUARANTINED");
  assert.match(result.candidates.find((item) => item.accountId === "disabled").eligibilityReasons.join(","), /risk:disabled/);
});

test("retired GPM provider remains visible as ineligible and cannot be selected", () => {
  const result = selectAccountAgentCandidate([{ ...base, provider: "gpm", accountId: "legacy-gpm", profileRef: "legacy-profile", providerProfileId: "legacy-profile" }], {
    platform: "linkedin", campaignId: "campaign-1", targetId: "target-1", now: "2026-10-27T00:00:00.000Z"
  });
  assert.equal(result.status, "NO_ELIGIBLE_AGENT");
  assert.equal(result.candidates[0].eligibilityState, "INELIGIBLE");
  assert.deepEqual(result.candidates[0].eligibilityReasons, ["provider:retired_gpm"]);
});

test("Mission Control projection is bounded read-only and secret-free", () => {
  const projection = projectAccountAgentMissionControl([base], { platform: "linkedin", campaignId: "campaign-1", targetId: "target-1", now: "2026-10-27T00:00:00.000Z" });
  assert.equal(projection.readOnly, true);
  assert.equal(projection.selection.selectedAccountId, "account-a");
  assert.equal(Object.hasOwn(projection.agents[0], "cookie"), false);
  assert.equal(Object.hasOwn(projection.agents[0], "authority"), false);
});
