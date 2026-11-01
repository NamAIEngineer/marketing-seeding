import test from "node:test";
import assert from "node:assert/strict";
import { CamoufoxReadinessProvider, registerCamoufoxReadinessProviders } from "../src/camoufox-readiness-provider.mjs";
import { ReadinessProviderRegistry } from "../src/platform-registries.mjs";

const fixtures = Object.freeze({
  threads: { identity: "https://threads.net/@fixture-owner", target: "https://threads.net/@fixture-topic" },
  reddit: { identity: "https://reddit.com/user/fixture_owner", target: "https://reddit.com/r/fixture" },
  facebook_group: { identity: "https://facebook.com/fixture-owner", target: "https://facebook.com/groups/fixture-group" },
  product_hunt: { identity: "https://producthunt.com/@fixture-owner", target: "https://producthunt.com/posts/fixture" },
  indie_hackers: { identity: "https://indiehackers.com/u/fixture-owner", target: "https://indiehackers.com/groups/fixture" }
});

function surface(platform, fixture, { rulesEvidenceAccepted = true } = {}) {
  return {
    async listTabs() { return [{ id: "page-1", profileId: "profile-fixture", url: fixture.target }]; },
    async showTab(id) { return { id, profileId: "profile-fixture", url: fixture.target }; },
    async navigate() {},
    async evaluate(_pageId, expression) {
      if (expression.includes("candidateCount")) return {
        authenticated: true, authenticatedSurface: true, ownerSurface: true,
        identityReference: fixture.identity, stableId: fixture.identity.split("/").filter(Boolean).pop().replace(/^@/, ""),
        source: ({ threads: "threads-owner-profile-surface", reddit: "reddit-owner-profile-surface", facebook_group: "facebook-owner-profile-surface", product_hunt: "product-hunt-owner-profile-surface", indie_hackers: "indie-hackers-owner-profile-surface" })[platform],
        candidateCount: 1, ambiguous: false
      };
      if (expression.includes("data-rules-status")) return {
        targetMatched: true, canPost: true, authenticatedSurface: true, submitControlEnabled: true,
        source: ({ threads: "threads-composer", reddit: "reddit-community-composer", facebook_group: "facebook-group-composer", product_hunt: "product-hunt-composer", indie_hackers: "indie-hackers-community-composer" })[platform],
        rulesEvidencePresent: rulesEvidenceAccepted, rulesEvidenceAccepted, rulesStatus: rulesEvidenceAccepted ? "reviewed" : null
      };
      throw new Error("unexpected readiness expression");
    }
  };
}

test("default Camoufox readiness registration covers every non-LinkedIn publication channel", () => {
  const registry = new ReadinessProviderRegistry();
  registerCamoufoxReadinessProviders(registry, { resolver: null });
  assert.deepEqual(registry.platforms(), ["facebook_group", "indie_hackers", "product_hunt", "reddit", "threads"]);
});

for (const platform of Object.keys(fixtures)) {
  test(`${platform} readiness proves identity and target rights, missing rules stays UNKNOWN`, async () => {
    const fixture = fixtures[platform];
    const provider = new CamoufoxReadinessProvider();
    const context = { platform, provider: "camoufox", accountId: "account-fixture", profileId: "profile-fixture", providerProfileId: "profile-fixture", identityReference: fixture.identity, target: { id: `${platform}-target`, url: fixture.target }, browserSurface: surface(platform, fixture) };
    const ready = await provider.checkReadiness(context);
    assert.equal(ready.state, "READY");
    assert.equal(ready.capabilities.identityVerified, true);
    assert.equal(ready.capabilities.postingRights, true);
    if (platform !== "threads") {
      const unknown = await new CamoufoxReadinessProvider().checkReadiness({ ...context, browserSurface: surface(platform, fixture, { rulesEvidenceAccepted: false }) });
      assert.equal(unknown.state, "UNKNOWN");
      assert.equal(unknown.reasonCode, "target_rules_evidence_unavailable");
    }
  });
}
