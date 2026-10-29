import assert from "node:assert/strict";
import test from "node:test";
import { projectMarketDashboard } from "../src/market-intelligence.mjs";

const now = Date.parse("2026-10-27T06:00:00Z");

test("dashboard exposes only fresh validated market opportunities read-only", () => {
  const dashboard = projectMarketDashboard({
    source: "auto-gtm", status: "ready", generatedAt: "2026-10-27T05:30:00Z",
    campaignId: "campaign-1", portfolioProduct: "product-1",
    leads: [
      { leadId: "valid", segment: "founders", fit: .9, whyNow: .8, reach: .7, evidence: [{ signalId: "s1", url: "https://github.com/org/repo/issues/1" }] },
      { leadId: "bad-score", segment: "founders", fit: null, whyNow: .8, reach: .7, evidence: [{ signalId: "s2", url: "https://github.com/org/repo/issues/2" }] },
      { leadId: "no-evidence", segment: "founders", fit: .8, whyNow: .7, reach: .6, evidence: [] }
    ]
  }, { now });
  assert.equal(dashboard.readOnly, true);
  assert.equal(dashboard.source, "auto-gtm");
  assert.equal(dashboard.opportunityCount, 1);
  assert.equal(dashboard.opportunities[0].opportunityId, "auto-gtm:campaign-1:valid");
  assert.equal(dashboard.opportunities[0].externalSideEffects, false);
  assert.equal("authority" in dashboard.opportunities[0], false);
});

test("dashboard omits stale and non-ready feeds", () => {
  const base = { source: "auto-gtm", generatedAt: "2026-10-27T05:30:00Z", campaignId: "c", portfolioProduct: "p", leads: [] };
  assert.equal(projectMarketDashboard({ ...base, status: "stale" }, { now }).opportunityCount, 0);
  assert.equal(projectMarketDashboard({ ...base, status: "not_initialized" }, { now }).opportunityCount, 0);
  assert.equal(projectMarketDashboard({ ...base, status: "ready", generatedAt: "2026-10-25T00:00:00Z" }, { now }).opportunityCount, 0);
});
