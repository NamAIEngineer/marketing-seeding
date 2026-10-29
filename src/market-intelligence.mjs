/**
 * Provider-neutral, read-only market intelligence projection.
 *
 * The Auto-GTM feed is an evidence source, not an authority source. This
 * module accepts only an already validated fresh `ready` feed and produces a
 * bounded projection for strategy consumers. It never mutates state or calls
 * a provider.
 */
const MAX_OPPORTUNITIES = 48;
const MAX_EVIDENCE = 24;
const MAX_TEXT = 240;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const text = (value, max = MAX_TEXT) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const id = (value, max = 160) => {
  const normalized = text(value, max);
  return /^[A-Za-z0-9._:-]{1,160}$/.test(normalized) ? normalized : null;
};
// Auto-GTM scores are evidence fields. Coercing null, empty strings, or
// booleans to zero would turn malformed input into a valid opportunity.
const score = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const date = (value) => Number.isFinite(Date.parse(String(value || ""))) ? new Date(value).toISOString() : null;

function evidenceRefs(evidence = []) {
  if (!Array.isArray(evidence)) return [];
  const refs = [];
  for (const item of evidence.slice(0, MAX_EVIDENCE)) {
    if (!item || typeof item !== "object") continue;
    const signalId = id(item.signalId);
    const url = text(item.url, 500);
    if (signalId) refs.push(`signal:${signalId}`);
    if (/^https?:\/\//i.test(url)) refs.push(url);
  }
  return [...new Set(refs)].slice(0, MAX_EVIDENCE);
}

function freshness(generatedAt, now, maxAgeMs) {
  const timestamp = Date.parse(generatedAt || "");
  if (!Number.isFinite(timestamp)) return null;
  const ageMs = Math.max(0, now - timestamp);
  return { state: ageMs <= maxAgeMs ? "FRESH" : "STALE", ageMs, generatedAt: new Date(timestamp).toISOString() };
}

function feedOpportunity(feed, lead, { productId = null, now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  if (!feed || typeof feed !== "object" || feed.source !== "auto-gtm" || feed.status !== "ready") return null;
  const feedFreshness = freshness(feed.generatedAt, now, maxAgeMs);
  if (!feedFreshness || feedFreshness.state !== "FRESH") return null;
  if (!lead || typeof lead !== "object") return null;
  const leadId = id(lead.leadId);
  if (!leadId) return null;
  const campaignId = feed.campaignId == null ? null : id(feed.campaignId);
  if (feed.campaignId != null && !campaignId) return null;
  const fitScore = score(lead.fit);
  const whyNowScore = score(lead.whyNow);
  const reachScore = score(lead.reach);
  if ([fitScore, whyNowScore, reachScore].some((value) => value === null)) return null;
  const evidence = evidenceRefs(lead.evidence);
  if (!evidence.length) return null;
  const product = id(productId || feed.portfolioProduct, 200);
  const segment = text(lead.segment, 180);
  if (!segment) return null;
  return Object.freeze({
    opportunityId: `auto-gtm:${campaignId || "uncampaigned"}:${leadId}`,
    source: "auto-gtm",
    productId: product,
    campaignId,
    segment,
    audience: segment,
    painPoint: null,
    fitScore,
    whyNowScore,
    reachScore,
    evidenceRefs: evidence,
    discoveredAt: feedFreshness.generatedAt,
    freshness: feedFreshness,
    provenance: Object.freeze({ source: "auto-gtm", feedGeneratedAt: feedFreshness.generatedAt, leadId }),
    advisory: true,
    authoritySideEffects: false,
    externalSideEffects: false
  });
}

function socialOpportunity(signal, { productId = null, campaignId = null, now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  if (!signal || typeof signal !== "object") return null;
  const signalId = id(signal.signalId);
  const observedAt = date(signal.observedAt || signal.discoveredAt);
  const freshnessValue = freshness(observedAt, now, maxAgeMs);
  if (!signalId || !freshnessValue || freshnessValue.state !== "FRESH") return null;
  const refs = evidenceRefs(signal.evidence || [{ signalId, url: signal.sourceUrl }]);
  if (!refs.length) return null;
  const textValue = text(signal.normalizedText || signal.painPoint || signal.topic);
  if (!textValue) return null;
  const product = productId == null ? null : id(productId, 200);
  const campaign = campaignId == null ? null : id(campaignId);
  if (productId != null && !product) return null;
  if (campaignId != null && !campaign) return null;
  return Object.freeze({
    opportunityId: `social:${signalId}`,
    source: text(signal.source || signal.platform || "social", 80) || "social",
    productId: product,
    campaignId: campaign,
    segment: text(signal.audience || signal.topic || "", 180) || null,
    audience: text(signal.audience || "", 180) || null,
    painPoint: text(signal.painPoint || textValue, 240) || null,
    fitScore: score(signal.fitScore),
    whyNowScore: score(signal.whyNowScore),
    reachScore: score(signal.reachScore),
    evidenceRefs: refs,
    discoveredAt: freshnessValue.generatedAt,
    freshness: freshnessValue,
    provenance: Object.freeze({ source: text(signal.source || signal.platform || "social", 80) || "social", signalId, sourceUrl: text(signal.sourceUrl, 500) || null }),
    advisory: true,
    authoritySideEffects: false,
    externalSideEffects: false
  });
}

/** Normalize fresh Auto-GTM and optional social evidence into bounded opportunities. */
export function projectMarketOpportunities(feed, { productId = null, socialSignals = [], now = Date.now(), maxAgeMs = MAX_AGE_MS, limit = MAX_OPPORTUNITIES } = {}) {
  const boundedLimit = Number.isInteger(limit) ? Math.max(0, Math.min(MAX_OPPORTUNITIES, limit)) : MAX_OPPORTUNITIES;
  const rows = [];
  const seen = new Set();
  for (const lead of Array.isArray(feed?.leads) ? feed.leads : []) {
    const candidate = feedOpportunity(feed, lead, { productId, now, maxAgeMs });
    if (!candidate || seen.has(candidate.opportunityId)) continue;
    seen.add(candidate.opportunityId); rows.push(candidate);
  }
  for (const signal of Array.isArray(socialSignals) ? socialSignals : []) {
    const candidate = socialOpportunity(signal, { productId, campaignId: feed?.campaignId || null, now, maxAgeMs });
    if (!candidate || seen.has(candidate.opportunityId)) continue;
    seen.add(candidate.opportunityId); rows.push(candidate);
  }
  return Object.freeze(rows
    .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || (b.whyNowScore ?? -1) - (a.whyNowScore ?? -1) || a.opportunityId.localeCompare(b.opportunityId))
    .slice(0, boundedLimit));
}

/** Read-only Mission Control projection. No authority or execution fields. */
export function projectMarketDashboard(feed, options = {}) {
  const opportunities = projectMarketOpportunities(feed, options);
  return Object.freeze({
    readOnly: true,
    source: "auto-gtm",
    opportunityCount: opportunities.length,
    opportunities
  });
}

export { MAX_OPPORTUNITIES, MAX_AGE_MS };
export default projectMarketOpportunities;
