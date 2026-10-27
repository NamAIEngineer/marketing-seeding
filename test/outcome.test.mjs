import test from "node:test";
import assert from "node:assert/strict";
import { appendOutcomeSummary, deriveOutcomeSummary, derivePostOutcomeAttributions } from "../src/outcome.mjs";
import { createHash } from "node:crypto";

const at = "2026-01-01T00:00:00.000Z";
const target = { id: "t1", channel: "threads", accountId: "acct-1", profileId: "profile-1" };
const content = "Verified post";
const contentHash = createHash("sha256").update(content).digest("hex");
function verifiedEvidence(publicationUrl = "https://www.threads.net/@owner/post/p1") {
 return { verifiedAt: at, accountMatched: true, targetMatched: true, contentHashMatched: true, accountId: target.accountId, profileId: target.profileId, targetId: target.id, contentHash, publicationUrl, verificationMethod: "independent_fixture" };
}

test("outcome preserves unknown coverage and verified publication distinctions", () => {
 const state={campaigns:[{id:"c1"}],posts:[{id:"p1",campaignId:"c1",status:"published",publicationUrl:"https://x.test/p/1",publicationVerification:{state:"VERIFIED"}},{id:"p2",campaignId:"c1",status:"submit_result_unknown"}],executionReceipts:[],submissionUncertainties:[{id:"u",jobId:"p2",executionId:"e2",status:"UNKNOWN"}],metricSnapshots:[{id:"m",postId:"p1",capturedAt:"2026-01-01",impressions:3,coverage:{impressions:"measured",clicks:"unknown"}}],interactions:[{id:"i",postId:"p1",status:"open"}],replies:[{id:"r",interactionId:"i",status:"draft"}],conversions:[],keywordSnapshots:[]};
 const out=deriveOutcomeSummary(state,"c1",{now:new Date("2026-01-02T00:00:00Z")});
 assert.equal(out.publication.verified,1); assert.equal(out.publication.unknown,1); assert.equal(out.metrics.totals.impressions,3); assert.equal(out.metrics.totals.clicks,null); assert.equal(out.engagement.openInteractions,1);
});

test("outcome is deterministic for same hour bucket",()=>{const s={campaigns:[{id:"c"}],posts:[],executionReceipts:[],submissionUncertainties:[],metricSnapshots:[],interactions:[],replies:[],conversions:[],keywordSnapshots:[]}; const a=deriveOutcomeSummary(s,"c",{now:new Date("2026-01-01T01:10:00Z")}); const b=deriveOutcomeSummary(s,"c",{now:new Date("2026-01-01T01:59:00Z")}); assert.equal(a.summaryId,b.summaryId);});

test("outcome counts acceptance from persisted nested execution receipts",()=>{
 const s={campaigns:[{id:"c"}],posts:[{id:"p",campaignId:"c",status:"submit_result_unknown"}],executionReceipts:[{id:"r",postId:"p",receipt:{submitAcceptanceEvidence:{state:"ACCEPTED"}}}],submissionUncertainties:[],metricSnapshots:[],interactions:[],replies:[],conversions:[],keywordSnapshots:[]};
 const out=deriveOutcomeSummary(s,"c",{now:new Date("2026-01-01T00:00:00Z")});
 assert.equal(out.publication.accepted,1);
});

test("post attribution is explicit, verified, and carries only its own latest metrics", () => {
 const state = { campaigns: [{ id: "c" }], targets: [target], posts: [
   { id: "p1", campaignId: "c", targetId: "t1", content, status: "published", publicationUrl: "https://www.threads.net/@owner/post/p1" },
   { id: "p2", campaignId: "c", targetId: "t1", content: "Other", status: "queued" }
 ], executionRequests: [], executionReceipts: [{ id: "r1", postId: "p1", executionId: "e1", receipt: { submitState: "CONFIRMED", publicationUrl: "https://www.threads.net/@owner/post/p1", publicationEvidence: verifiedEvidence() } }], submissionUncertainties: [], publicationAttempts: [], metricSnapshots: [
   { id: "m-old", postId: "p1", capturedAt: at, impressions: 1, coverage: { impressions: "measured" } },
   { id: "m-new", postId: "p1", capturedAt: "2026-01-01T01:00:00.000Z", impressions: 3, coverage: { impressions: "measured" } },
   { id: "m-other", postId: "p2", capturedAt: "2026-01-01T01:00:00.000Z", impressions: 99, coverage: { impressions: "measured" } }
 ], interactions: [], replies: [], conversions: [{ id: "campaign-conversion", campaignId: "c" }, { id: "post-conversion", campaignId: "c", postId: "p1" }], keywordSnapshots: [] };
 const out = deriveOutcomeSummary(state, "c", { now: new Date("2026-01-01T02:00:00.000Z") });
 assert.deepEqual(out.postAttributions.map((item) => [item.postId, item.status]), [["p1", "VERIFIED"], ["p2", "PARTIAL"]]);
 assert.equal(out.postAttributions[0].metrics.values.impressions, 3);
 assert.equal(out.postAttributions[1].metrics.values.impressions, 99);
 assert.deepEqual(out.postAttributions[0].conversions.ids, ["post-conversion"]);
 assert.deepEqual(out.unassignedConversionIds, ["campaign-conversion"]);
});

test("unknown dominates acceptance and verified-looking evidence", () => {
 const state = { campaigns: [{ id: "c" }], targets: [target], posts: [{ id: "p", campaignId: "c", targetId: "t1", content, status: "submit_result_unknown", publicationUrl: "https://www.threads.net/@owner/post/p1" }], executionRequests: [], executionReceipts: [{ id: "r", postId: "p", receipt: { submitState: "CONFIRMED", publicationUrl: "https://www.threads.net/@owner/post/p1", publicationEvidence: verifiedEvidence() } }], submissionUncertainties: [{ id: "u", jobId: "p", executionId: "e", status: "UNKNOWN" }], publicationAttempts: [], metricSnapshots: [], interactions: [], replies: [], conversions: [], keywordSnapshots: [] };
 assert.equal(deriveOutcomeSummary(state, "c").postAttributions[0].status, "UNKNOWN");
});

test("accepted but unverified, missing identity, and orphan evidence fail closed", () => {
 const state = { campaigns: [{ id: "c" }], targets: [{ id: "t", channel: "threads", accountId: "acct" }], posts: [
   { id: "accepted", campaignId: "c", targetId: "t", content: "accepted", status: "publishing" },
   { id: "missing", campaignId: "c", content: "missing", status: "published", publicationUrl: "https://www.threads.net/@owner/post/missing" },
   { id: "orphan", campaignId: "c", targetId: "t", content: "orphan", status: "queued" }
 ], executionRequests: [], executionReceipts: [
   { id: "ra", postId: "accepted", receipt: { submitState: "SUBMIT_SENT", submitAcceptanceEvidence: { platformAcceptance: "ACCEPTED" } } },
   { id: "ro", postId: "orphan", receipt: { submitState: "CONFIRMED", publicationUrl: "https://www.threads.net/@owner/post/orphan", publicationEvidence: { ...verifiedEvidence(), targetId: "t" } } }
 ], submissionUncertainties: [], publicationAttempts: [], metricSnapshots: [], interactions: [], replies: [], conversions: [], keywordSnapshots: [] };
 const attribution = deriveOutcomeSummary(state, "c").postAttributions;
 assert.equal(attribution.find((item) => item.postId === "accepted").status, "PARTIAL");
 assert.equal(attribution.find((item) => item.postId === "missing").status, "PARTIAL");
 assert.equal(attribution.find((item) => item.postId === "orphan").status, "PARTIAL");
});

test("provider-aware publication verification requires the exact GPM binding", () => {
 const gpmTarget = {
   id: "gpm-target", channel: "linkedin", accountId: "linkedin_primary", profileId: "gpm-profile",
   provider: "gpm", providerProfileId: "gpm-profile", identityReference: "https://www.linkedin.com/in/owner/",
   url: "https://www.linkedin.com/feed/"
 };
 const gpmContent = "GPM verified publication";
 const gpmHash = createHash("sha256").update(gpmContent).digest("hex");
 const evidence = {
   state: "VERIFIED", verifiedAt: at, accountMatched: true, targetMatched: true, contentHashMatched: true,
   accountId: "linkedin_primary", profileId: "gpm-profile", targetId: "gpm-target", contentHash: gpmHash,
   provider: "gpm", providerProfileId: "gpm-profile", identityReference: "https://www.linkedin.com/in/owner",
   targetUrl: "https://www.linkedin.com/feed/", publicationUrl: "https://www.linkedin.com/feed/update/urn:li:activity:1"
 };
 const base = {
   campaigns: [{ id: "gpm-campaign" }], targets: [gpmTarget], executionAccounts: [{
     id: "linkedin:linkedin_primary", platform: "linkedin", accountId: "linkedin_primary", profileId: "gpm-profile",
     provider: "gpm", providerProfileId: "gpm-profile", identityReference: "https://www.linkedin.com/in/owner"
   }],
   posts: [{ id: "gpm-post", campaignId: "gpm-campaign", targetId: "gpm-target", content: gpmContent,
     status: "published", publicationUrl: evidence.publicationUrl }], executionReceipts: [{ id: "gpm-receipt", postId: "gpm-post",
     receipt: { submitState: "CONFIRMED", publicationUrl: evidence.publicationUrl, provider: "gpm", providerProfileId: "gpm-profile",
       identityReference: evidence.identityReference, targetUrl: evidence.targetUrl, publicationEvidence: evidence } }],
   submissionUncertainties: [], executionRequests: [], publicationAttempts: [], metricSnapshots: [], interactions: [], replies: [], conversions: [], keywordSnapshots: []
 };
 assert.equal(deriveOutcomeSummary(base, "gpm-campaign").postAttributions[0].status, "VERIFIED");
 const wrongProvider = structuredClone(base);
 wrongProvider.executionReceipts[0].receipt.provider = "orca";
 wrongProvider.executionReceipts[0].receipt.publicationEvidence.provider = "orca";
 assert.equal(deriveOutcomeSummary(wrongProvider, "gpm-campaign").postAttributions[0].status, "PARTIAL");
});

test("attribution output is bounded, deterministic, and append is idempotent", () => {
 const state = { campaigns: [{ id: "c" }], targets: [], posts: Array.from({ length: 120 }, (_, index) => ({ id: `p-${String(index).padStart(3, "0")}`, campaignId: "c", status: "queued" })), executionReceipts: [], submissionUncertainties: [], executionRequests: [], publicationAttempts: [], metricSnapshots: [], interactions: [], replies: [], conversions: [], keywordSnapshots: [] };
 const first = deriveOutcomeSummary(state, "c", { now: new Date("2026-01-01T00:00:00.000Z") });
 const second = deriveOutcomeSummary(state, "c", { now: new Date("2026-01-01T00:59:00.000Z") });
 assert.equal(first.postAttributions.length, 100);
 assert.equal(first.summaryId, second.summaryId);
 const campaign = {};
 appendOutcomeSummary(campaign, first); appendOutcomeSummary(campaign, second);
 assert.equal(campaign.outcomeSummaries.length, 1);
});
