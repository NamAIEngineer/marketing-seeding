import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { projectMarketOpportunities } from "../src/market-intelligence.mjs";

async function fixture(prefix = "strategy-market-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const productRepo = path.join(root, "repo");
  await mkdir(productRepo);
  await writeFile(path.join(productRepo, "README.md"), "verified product evidence", "utf8");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Market strategy", objective: "Research", productRepo });
  const target = await service.createTarget({ channel: "threads", name: "Fixture", url: "https://threads.net/fixture", accountId: "fixture", status: "active" });
  const post = await service.createPost({ campaignId: campaign.id, targetId: target.id, content: "Already published" });
  await service.store.mutate("fixture", "ready", (state) => {
    state.campaigns.find((item) => item.id === campaign.id).productIntelligence = {
      handoff: { readinessStatus: "READY" },
      document: Object.fromEntries(["WHAT_IS_IT", "WHAT_PROBLEM_DOES_IT_SOLVE", "WHY_IS_IT_BETTER", "WHO_NEEDS_IT"].map((field) => [field, { text: field, evidenceRefs: ["readme"] }]))
    };
    state.posts.find((item) => item.id === post.id).status = "published";
  });
  return { service, campaign };
}

function feed(campaignId, generatedAt) {
  return {
    source: "auto-gtm", status: "ready", generatedAt, campaignId, portfolioProduct: "campaign-product",
    leads: [{ leadId: "lead-1", segment: "Vietnamese technical founders", fit: 0.92, whyNow: 0.84, reach: 0.61,
      evidence: [{ signalId: "signal-1", url: "https://github.com/example/issue" }] }]
  };
}

test("fresh Auto-GTM opportunity drives an advisory strategy decision", async () => {
  const { service, campaign } = await fixture();
  const now = new Date("2026-10-27T06:00:00.000Z");
  const opportunities = projectMarketOpportunities(feed(campaign.id, now.toISOString()), { productId: campaign.id, now: now.getTime() });
  const decision = await service.deriveStrategy(campaign.id, { now: now.toISOString(), marketOpportunities: opportunities });
  assert.equal(decision.action, "research");
  assert.equal(decision.eligible, true);
  assert.equal(decision.candidateId, opportunities[0].opportunityId);
  assert.deepEqual(decision.reasons, ["evidence_backed_market_signal", "market_opportunity"]);
  assert.equal(decision.marketOpportunity.provenance.leadId, "lead-1");
  assert.equal(decision.authoritySideEffects, false);
  assert.equal((await service.snapshot()).executionRequests.length, 0);
});

test("stale and cross-campaign opportunities fail closed", async () => {
  const { service, campaign } = await fixture("strategy-market-gate-");
  const now = new Date("2026-10-27T06:00:00.000Z");
  const stale = projectMarketOpportunities(feed(campaign.id, "2026-10-25T06:00:00.000Z"), { productId: campaign.id, now: now.getTime() });
  assert.equal(stale.length, 0);
  const foreign = projectMarketOpportunities(feed("other-campaign", now.toISOString()), { productId: campaign.id, now: now.getTime() });
  const decision = await service.deriveStrategy(campaign.id, { now: now.toISOString(), marketOpportunities: foreign });
  assert.equal(decision.action, "do_nothing");
  assert.deepEqual(decision.reasons, ["no_safe_action_candidate"]);
});
