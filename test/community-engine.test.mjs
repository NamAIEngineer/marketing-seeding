import test from "node:test";
import assert from "node:assert/strict";
import {
  answerMembershipQuestions,
  buildCommunityReceipt,
  derivePostableState,
  projectJoinIntents,
  scoreCommunity
} from "../src/community-engine.mjs";

const fb = {
  platform: "facebook_group",
  url: "https://www.facebook.com/groups/design-os-fixture",
  sourceUrl: "https://www.facebook.com/groups/design-os-fixture",
  name: "UI UX AI Design Vietnam",
  description: "Figma product design and AI agents",
  members: 12_000,
  recentPosts: 45,
  language: "vi",
  ruleText: "Self-promotion is allowed with useful context",
  evidenceRefs: ["public-candidate:facebook:design-os-fixture"]
};

test("scores public observations and never upgrades an unauthenticated join intent", () => {
  const scored = scoreCommunity(fb);
  assert.equal(scored.eligible, true);
  const projection = projectJoinIntents({ accountId: "account-fixture", observations: [scored], now: "2026-11-01T12:00:00Z" });
  assert.equal(projection.intents[0].status, "UNKNOWN_AUTH_BLOCKED");
  assert.equal(projection.intents[0].receipt.authenticated, false);
  assert.equal(projection.intents[0].externalSideEffect, false);
  assert.equal(projection.caps.joinRequestedToday, 1);
});

test("join cap blocks a fourth daily request and rule policy blocks no-promo", () => {
  const observations = [1, 2, 3, 4].map((number) => scoreCommunity({ ...fb, url: `https://www.facebook.com/groups/design-os-${number}`, name: `Figma UI UX group ${number}` }));
  const projection = projectJoinIntents({ accountId: "account-fixture", observations, now: "2026-11-01T12:00:00Z" });
  assert.equal(projection.caps.joinRequestedToday, 3);
  assert.equal(projection.intents.filter((item) => item.status === "UNKNOWN_AUTH_BLOCKED").length, 3);
  assert.equal(projection.intents.at(-1).reason, "JOIN_CAP_REACHED");
  const blocked = scoreCommunity({ ...fb, url: "https://www.linkedin.com/groups/no-promo-fixture", platform: "linkedin_group", ruleText: "Promotional links are not allowed" });
  assert.equal(blocked.rules.classification, "no_promo");
  assert.equal(blocked.eligible, false);
});

test("membership answers require declared facts and postable state requires warm-up plus rules evidence", () => {
  const answers = answerMembershipQuestions({
    questions: [{ prompt: "What product do you work on?" }, { prompt: "What is your profession?" }],
    accountProfile: { role: "Product designer" },
    productFacts: { description: "Open source design tool", repoUrl: "https://github.com/jangtrinh/design-os-studio" }
  });
  assert.equal(answers[0].status, "SUPPORTED_BY_DECLARED_FACT");
  assert.equal(answers[1].status, "SUPPORTED_BY_DECLARED_FACT");
  assert.equal(derivePostableState({ membershipStatus: "JOINED", rulesClass: "promo_ok", warmupDays: 6, meaningfulInteractions: 2, rulesEvidence: true }).postable, false);
  assert.equal(derivePostableState({ membershipStatus: "JOINED", rulesClass: "promo_ok", warmupDays: 7, meaningfulInteractions: 2, rulesEvidence: true }).postable, true);
});

test("receipt exposes dashboard counts and publication remains disabled", () => {
  const discovery = scoreCommunity(fb);
  const joinProjection = projectJoinIntents({ accountId: "account-fixture", observations: [discovery], now: "2026-11-01T12:00:00Z" });
  const receipt = buildCommunityReceipt({
    runId: "community-fixture-20261101",
    capturedAt: "2026-11-01T12:00:00Z",
    sourceReceipts: [{ sourceUrl: fb.sourceUrl, observedAt: "2026-11-01T12:00:00Z", httpStatus: 200, authenticatedGroupRead: false, loginShell: true }],
    discoveries: [discovery], joinProjection,
    notes: ["Public candidate only; no join request sent.", "HTTP 200/login shell is not authenticated evidence."]
  });
  assert.equal(receipt.scope.externalSideEffects, false);
  assert.equal(receipt.scope.publication, "DISABLED");
  assert.deepEqual(Object.keys(receipt.dashboard).filter((key) => ["discovered", "join_requested_today", "approved", "postable"].includes(key)).sort(), ["approved", "discovered", "join_requested_today", "postable"]);
  assert.equal(receipt.dashboard.discovered, 1);
});
