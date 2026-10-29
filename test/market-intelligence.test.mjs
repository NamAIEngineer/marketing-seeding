import assert from "node:assert/strict";
import test from "node:test";
import { projectMarketOpportunities } from "../src/market-intelligence.mjs";

const now = Date.parse("2026-10-27T06:00:00Z");
const feed = (overrides = {}) => ({
  source: "auto-gtm", status: "ready", generatedAt: "2026-10-27T05:30:00Z",
  campaignId: "campaign-demo", portfolioProduct: "product-demo",
  leads: [{ leadId: "lead-1", segment: "founders", fit: .9, whyNow: .8, reach: .7,
    evidence: [{ signalId: "signal-1", url: "https://github.com/org/repo/issues/1" }] }], ...overrides
});

test("projects fresh Auto-GTM leads with identity, scores and evidence", () => {
  const [row] = projectMarketOpportunities(feed(), { now });
  assert.equal(row.opportunityId, "auto-gtm:campaign-demo:lead-1");
  assert.equal(row.productId, "product-demo");
  assert.equal(row.segment, "founders");
  assert.deepEqual(row.evidenceRefs, ["signal:signal-1", "https://github.com/org/repo/issues/1"]);
  assert.equal(row.advisory, true);
  assert.equal(row.externalSideEffects, false);
});

test("fails closed for stale, non-ready, malformed and evidence-free rows", () => {
  assert.deepEqual(projectMarketOpportunities(feed({ status: "stale" }), { now }), []);
  assert.deepEqual(projectMarketOpportunities(feed({ generatedAt: "2026-10-25T00:00:00Z" }), { now }), []);
  assert.deepEqual(projectMarketOpportunities(feed({ leads: [{ leadId: "lead-1", segment: "founders", fit: .9, whyNow: .8, reach: .7, evidence: [] }] }), { now }), []);
  assert.deepEqual(projectMarketOpportunities(feed({ leads: [{ leadId: "bad id!", segment: "founders", fit: .9, whyNow: .8, reach: .7, evidence: [{ signalId: "x", url: "https://github.com/x" }] }] }), { now }), []);
});

test("retains optional fresh social signals without granting authority", () => {
  const rows = projectMarketOpportunities(feed({ leads: [] }), { now, socialSignals: [{
    signalId: "social-1", source: "reddit", platform: "reddit", topic: "context loss",
    painPoint: "agents lose context", normalizedText: "agents lose context", observedAt: "2026-10-27T05:40:00Z",
    sourceUrl: "https://www.reddit.com/r/example/comments/1", evidence: [{ signalId: "social-1", url: "https://www.reddit.com/r/example/comments/1" }]
  }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].opportunityId, "social:social-1");
  assert.equal(rows[0].painPoint, "agents lose context");
  assert.equal(rows[0].authoritySideEffects, false);
});
