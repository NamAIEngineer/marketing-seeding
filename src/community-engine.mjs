/**
 * Bounded Facebook/LinkedIn Groups discovery and membership projection.
 *
 * This module is deliberately side-effect free. It scores public observations,
 * creates join intents (never platform requests), and derives a postable state
 * only from authenticated membership/rule/warm-up evidence. A HTTP 200 page or
 * a login shell is never treated as authenticated evidence.
 */
import { createHash } from "node:crypto";

export const COMMUNITY_PLATFORMS = Object.freeze(["facebook_group", "linkedin_group"]);
export const JOIN_CAPS = Object.freeze({ daily: 3, weekly: 15 });
export const DEFAULT_SCORE_THRESHOLD = 60;
export const RULE_CLASSES = Object.freeze(["promo_ok", "promo_thread_only", "no_promo", "unclear"]);
export const MEMBERSHIP_STATES = Object.freeze(["UNKNOWN", "REQUEST_PENDING", "APPROVED", "DECLINED", "JOINED"]);

const RELEVANCE_TERMS = Object.freeze([
  "figma", "ui", "ux", "user experience", "product design", "design system", "ai design",
  "ai agent", "claude code", "codex", "mcp", "build in public", "thiết kế", "cộng đồng ui/ux"
]);
const LANGUAGE_TERMS = Object.freeze({ vi: ["việt", "tiếng việt", "cộng đồng", "thiết kế"], en: ["design", "product", "community", "figma", "developer"] });

function text(value, max = 6000) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function list(value, max = 64) { return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 160)).filter(Boolean))].slice(0, max); }
function iso(value, fallback = new Date().toISOString()) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function boundedNumber(value, fallback = null, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function hostFor(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } }
function validPublicUrl(url) {
  try {
    const parsed = new URL(String(url));
    const hostname = parsed.hostname.toLowerCase();
    const approvedHost = ["facebook.com", "linkedin.com"].some((host) => hostname === host || hostname.endsWith(`.${host}`));
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && approvedHost;
  } catch { return false; }
}

export function classifyRules(input = {}) {
  const explicit = text(input.classification || input.ruleClass || "").toLowerCase();
  if (RULE_CLASSES.includes(explicit)) return explicit;
  const body = text([input.text, input.markdown, input.title].filter(Boolean).join(" ")).toLowerCase();
  if (!body) return "unclear";
  if (/no\s+(self[- ]?promo|promotion|advertis|marketing)|không\s+(quảng cáo|tự quảng bá)|cấm.*(quảng bá|link)|promotional links?\s+(are\s+)?not allowed/.test(body)) return "no_promo";
  if (/promo(?:tion)?\s+only\s+in\s+(a\s+)?thread|self[- ]?promo(?:tion)?\s+thread|megathread|chỉ.*(thread|chủ đề)/.test(body)) return "promo_thread_only";
  if (/self[- ]?promo(?:tion)?\s+(is\s+)?allowed|promotional links?\s+allowed|quảng cáo.*(được phép|cho phép)|tự quảng bá.*(được phép|cho phép)/.test(body)) return "promo_ok";
  return "unclear";
}

export function normalizeDiscoveryObservation(input = {}) {
  const platform = text(input.platform, 40).toLowerCase();
  if (!COMMUNITY_PLATFORMS.includes(platform)) throw new Error(`Unsupported community platform: ${platform}`);
  const url = text(input.url, 500);
  if (!validPublicUrl(url)) throw new Error("A public Facebook or LinkedIn URL is required");
  const sourceUrl = text(input.sourceUrl || url, 500);
  if (!validPublicUrl(sourceUrl)) throw new Error("A public discovery source URL is required");
  const capturedAt = iso(input.capturedAt);
  const rules = classifyRules({ ...input.rules, text: input.rules?.text || input.ruleText || input.description });
  return {
    id: text(input.id || `${platform}:${hash(url).slice(0, 16)}`, 120), platform, url, host: hostFor(url),
    name: text(input.name || input.title || "Unnamed community", 240), description: text(input.description, 1200),
    sourceUrl, sourceType: text(input.sourceType || "public_discovery", 80), capturedAt,
    observedHttpStatus: boundedNumber(input.observedHttpStatus, "UNKNOWN", 100, 599),
    authenticatedGroupRead: input.authenticatedGroupRead === true,
    loginShell: input.loginShell === true,
    members: boundedNumber(input.members ?? input.memberCount, null, 0, 2_000_000_000),
    recentPosts: boundedNumber(input.recentPosts, null, 0, 1_000_000),
    language: text(input.language, 40).toLowerCase() || "UNKNOWN",
    keywords: list(input.keywords), relevanceTerms: list(input.relevanceTerms),
    rules: { classification: rules, sourceUrl: text(input.rules?.sourceUrl || input.rulesUrl || url, 500), capturedAt: iso(input.rules?.capturedAt || capturedAt), evidence: text(input.rules?.evidence || input.ruleText, 1000) },
    evidenceRefs: list(input.evidenceRefs, 16),
  };
}

function termHits(observation) {
  const haystack = [observation.name, observation.description, ...observation.keywords, ...observation.relevanceTerms].join(" ").toLowerCase();
  return RELEVANCE_TERMS.filter((term) => haystack.includes(term));
}

export function scoreCommunity(input, { threshold = DEFAULT_SCORE_THRESHOLD } = {}) {
  const observation = normalizeDiscoveryObservation(input);
  const hits = termHits(observation);
  const relevance = Math.min(100, hits.length * 22);
  const size = observation.members === null ? null : observation.members >= 100_000 ? 100 : observation.members >= 10_000 ? 80 : observation.members >= 1_000 ? 60 : observation.members >= 100 ? 35 : 15;
  const activity = observation.recentPosts === null ? null : observation.recentPosts >= 30 ? 100 : observation.recentPosts >= 10 ? 75 : observation.recentPosts >= 3 ? 50 : 20;
  const language = observation.language === "UNKNOWN" ? null : (observation.language === "vi" || observation.language === "en" ? 100 : 40);
  const promoPolicy = observation.rules.classification === "promo_ok" ? 100 : observation.rules.classification === "promo_thread_only" ? 55 : observation.rules.classification === "no_promo" ? 0 : null;
  const known = [relevance, size, activity, language, promoPolicy].filter((value) => value !== null);
  const score = known.length ? Math.round(known.reduce((total, value) => total + value, 0) / known.length) : null;
  const eligible = score !== null && score >= threshold && !["no_promo", "unclear"].includes(observation.rules.classification);
  return { ...observation, score, threshold, eligible, scoreInputs: { relevance: { value: relevance, hits }, size, activity, language, promoPolicy }, scoreStatus: score === null ? "UNKNOWN_INSUFFICIENT_PUBLIC_DATA" : "OBSERVED_PUBLIC_DATA" };
}

function startOfDay(value) { const date = new Date(iso(value)); date.setUTCHours(0, 0, 0, 0); return date; }
function withinDays(value, now, days) { return new Date(iso(value)).getTime() >= startOfDay(new Date(new Date(iso(now)).getTime() - days * 86_400_000)).getTime(); }

export function projectJoinIntents({ accountId, observations = [], priorRequests = [], now = new Date().toISOString(), threshold = DEFAULT_SCORE_THRESHOLD } = {}) {
  const account = text(accountId, 160);
  if (!account) throw new Error("accountId is required");
  const capturedNow = iso(now);
  const mine = (Array.isArray(priorRequests) ? priorRequests : []).filter((item) => text(item.accountId, 160) === account);
  const today = mine.filter((item) => withinDays(item.requestedAt, capturedNow, 0)).length;
  const week = mine.filter((item) => withinDays(item.requestedAt, capturedNow, 7)).length;
  const used = new Set(mine.map((item) => text(item.communityId, 160)).filter(Boolean));
  const scored = observations.map((item) => item?.scoreInputs ? item : scoreCommunity(item, { threshold }));
  let daily = today; let weekly = week;
  const intents = [];
  for (const community of scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))) {
    const duplicate = used.has(community.id);
    const capBlocked = daily >= JOIN_CAPS.daily || weekly >= JOIN_CAPS.weekly;
    const eligible = community.eligible && !duplicate && !capBlocked;
    const reason = duplicate ? "DUPLICATE_REQUEST" : capBlocked ? "JOIN_CAP_REACHED" : !community.eligible ? (community.rules.classification === "no_promo" ? "RULE_NO_PROMO" : community.rules.classification === "unclear" ? "RULE_UNCLEAR" : "SCORE_BELOW_THRESHOLD") : "AUTH_REQUIRED";
    const status = eligible ? "UNKNOWN_AUTH_BLOCKED" : "NOT_REQUESTED";
    if (eligible) { daily += 1; weekly += 1; used.add(community.id); }
    intents.push({ communityId: community.id, accountId: account, platform: community.platform, requestedAt: eligible ? capturedNow : null, status, reason, externalSideEffect: false, truthfulAnswerStatus: "NOT_EVALUATED", evidenceRefs: community.evidenceRefs, receipt: { kind: "join_request_intent", observed: false, authenticated: false, status, reason } });
  }
  return { accountId: account, capturedAt: capturedNow, caps: { ...JOIN_CAPS, joinRequestedTodayBefore: today, joinRequestedWeekBefore: week, joinRequestedToday: daily, joinRequestedWeek: weekly }, intents };
}

export function answerMembershipQuestions({ questions = [], accountProfile = {}, productFacts = {} } = {}) {
  const profile = accountProfile && typeof accountProfile === "object" ? accountProfile : {};
  const facts = productFacts && typeof productFacts === "object" ? productFacts : {};
  return (Array.isArray(questions) ? questions : []).slice(0, 12).map((question) => {
    const prompt = text(question?.prompt || question, 500);
    const lower = prompt.toLowerCase();
    const candidates = lower.includes("product") || lower.includes("sản phẩm") ? [facts.description, facts.repoUrl] : lower.includes("profession") || lower.includes("job") || lower.includes("nghề") ? [profile.profession, profile.role] : lower.includes("location") || lower.includes("địa điểm") ? [profile.location] : [];
    const answer = candidates.map((item) => text(item, 300)).find(Boolean) || null;
    return { prompt, answer, status: answer ? "SUPPORTED_BY_DECLARED_FACT" : "UNKNOWN_NEEDS_HUMAN", basis: answer ? { source: lower.includes("product") || lower.includes("sản phẩm") ? "productFacts" : "accountProfile" } : null };
  });
}

export function derivePostableState({ membershipStatus = "UNKNOWN", rulesClass = "unclear", warmupDays = 0, meaningfulInteractions = 0, rulesEvidence = false, now = new Date().toISOString() } = {}) {
  const membership = text(membershipStatus, 40).toUpperCase();
  const rule = RULE_CLASSES.includes(text(rulesClass, 40).toLowerCase()) ? text(rulesClass, 40).toLowerCase() : "unclear";
  const warmup = boundedNumber(warmupDays, 0, 0, 3650);
  const interactions = boundedNumber(meaningfulInteractions, 0, 0, 100_000);
  const eligible = membership === "JOINED" && rule === "promo_ok" && rulesEvidence === true && warmup >= 7 && interactions >= 2;
  return { checkedAt: iso(now), membershipStatus: MEMBERSHIP_STATES.includes(membership) ? membership : "UNKNOWN", rulesClass: rule, rulesEvidence: rulesEvidence === true, warmupDays: warmup, meaningfulInteractions: interactions, postable: eligible, decision: eligible ? "POSTABLE" : "BLOCKED_UNTIL_MEMBERSHIP_RULES_WARMUP" };
}

export function communityDashboard({ discoveries = [], joinProjection = {}, memberships = [] } = {}) {
  const rows = Array.isArray(discoveries) ? discoveries : [];
  const requests = Array.isArray(joinProjection.intents) ? joinProjection.intents : [];
  const joined = (Array.isArray(memberships) ? memberships : []).map((item) => derivePostableState(item));
  return { observedAt: iso(joinProjection.capturedAt), discovered: rows.length, join_requested_today: Number(joinProjection.caps?.joinRequestedToday || 0), approved: joined.filter((item) => ["APPROVED", "JOINED"].includes(item.membershipStatus)).length, postable: joined.filter((item) => item.postable).length, auth_unknown: requests.filter((item) => item.status === "UNKNOWN_AUTH_BLOCKED").length, rule_blocked: rows.filter((item) => ["no_promo", "unclear"].includes(item.rules?.classification)).length, caps: joinProjection.caps || { ...JOIN_CAPS }, rows: rows.map((item) => ({ id: item.id, platform: item.platform, name: item.name, score: item.score ?? null, rule: item.rules?.classification || "unclear", status: memberships.find((candidate) => candidate.communityId === item.id)?.membershipStatus || "UNKNOWN", postable: Boolean(memberships.find((candidate) => candidate.communityId === item.id)?.postable) })) };
}

export function buildCommunityReceipt({ runId = `community-${Date.now()}`, capturedAt = new Date().toISOString(), sourceReceipts = [], discoveries = [], joinProjection = {}, memberships = [], notes = [] } = {}) {
  const dashboard = communityDashboard({ discoveries, joinProjection, memberships });
  const payload = { schemaVersion: 1, runId: text(runId, 120), capturedAt: iso(capturedAt), scope: { platforms: COMMUNITY_PLATFORMS, externalSideEffects: false, publication: "DISABLED" }, sourceReceipts, discoveries, joinProjection, memberships, dashboard, notes: list(notes, 32) };
  return { ...payload, receiptHash: hash(payload) };
}

