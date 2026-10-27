import { createHash } from "node:crypto";
import { normalizeAccountRuntimeEntry } from "./account-runtime-registry.mjs";
import { canonicalIdentityUrl } from "./execution-binding.mjs";

const MAX_AGENTS = 128;
const MAX_HISTORY = 100;
const MAX_TEXT = 240;
const SECRET_KEY = /(password|passwd|cookie|bearer|token|credential|mfa|passkey|sessionstorage|localstorage|secret|authorizationheader|privatekey|accesskey)/i;
const SECRET_VALUE = /(?:bearer\s+|cookie\s*=|(?:access|refresh|id|auth|csrf)[_-]?token\b|-----begin\s+[^-]+private key-----)/i;
const QUARANTINED_RISK = new Set(["quarantined", "blocked", "suspended", "disabled", "revoked", "error"]);
const RETIRED_PROVIDERS = new Set(["gpm"]);
const text = (value, limit = MAX_TEXT) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
const list = (value, limit = 64) => Array.isArray(value) ? [...new Set(value.map((item) => text(item, 120)).filter(Boolean))].slice(0, limit).sort() : [];

function fail(message, code = "ACCOUNT_AGENT_INVALID") {
  throw Object.assign(new Error(message), { code });
}

function assertSafe(value, path = "accountAgent", depth = 0) {
  if (depth > 6) fail(`${path} is too deeply nested`);
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && SECRET_VALUE.test(value)) fail(`${path} contains secret-like material`, "ACCOUNT_AGENT_SECRET_VALUE");
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) fail(`${path}.${key} is not accepted`, "ACCOUNT_AGENT_SECRET_FIELD");
    assertSafe(child, `${path}.${key}`, depth + 1);
  }
}

function boundedValue(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === "string") return text(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, MAX_HISTORY).map((item) => boundedValue(item, depth + 1)).filter((item) => item !== null);
  if (typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value).slice(0, 32)) {
      if (SECRET_KEY.test(key)) fail(`${key} is not accepted`, "ACCOUNT_AGENT_SECRET_FIELD");
      const normalized = boundedValue(child, depth + 1);
      if (normalized !== null && normalized !== "") output[text(key, 80)] = normalized;
    }
    return output;
  }
  return null;
}

function boundedHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_HISTORY).map((item) => boundedValue(item)).filter((item) => item !== null);
}

function boundedWeights(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, score]) => [text(key, 100), Number.isFinite(Number(score)) ? Math.max(0, Math.min(1, Number(score))) : null]).filter(([key, score]) => key && score !== null));
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function identityReference(input, runtime) {
  const identity = input.verifiedIdentity;
  const candidate = typeof identity === "string"
    ? identity
    : identity && typeof identity === "object"
      ? identity.reference || identity.url || identity.identityReference
      : null;
  return canonicalIdentityUrl(text(candidate, 400) || runtime.identityReference || "");
}

function normalizeAuthority(input) {
  const source = input.authority || input.authorityProvenance || {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return Object.freeze({});
  const allowed = ["reference", "source", "scope", "status", "issuedAt", "validUntil", "issuerType"];
  return Object.freeze(Object.fromEntries(allowed.map((key) => [key, text(source[key], 240)]).filter(([, value]) => value)));
}

/** Create one immutable, secret-free provider-neutral Account Agent. */
export function normalizeAccountAgent(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Account Agent metadata must be an object");
  assertSafe(input);
  // Accept both sanitized account records and this module's own immutable
  // projection so selection remains restart-safe and idempotent.
  const runtimeInput = {
    ...input,
    identityReference: input.identityReference || input.verifiedIdentity?.reference || input.eligibilityBinding?.identityReference,
    sessionHealth: input.sessionHealth || input.sessionState,
    risk: input.risk || (input.status && input.status !== "enabled" ? "disabled" : undefined),
    allowedCampaigns: input.allowedCampaigns || input.eligibilityBinding?.allowedCampaigns,
    allowedTargets: input.allowedTargets || input.eligibilityBinding?.allowedTargets
  };
  const runtime = normalizeAccountRuntimeEntry(runtimeInput);
  const provider = runtime.provider || "orca";
  const profileRef = runtime.providerProfileId || runtime.profileRef;
  const identity = identityReference(runtimeInput, runtime);
  const identityKey = `${runtime.platform}\u0000${runtime.accountId}\u0000${provider}\u0000${profileRef}`;
  const agentId = `account-agent:${createHash("sha256").update(identityKey).digest("hex").slice(0, 24)}`;
  const personaInput = input.persona && typeof input.persona === "object" ? input.persona : {};
  const audienceInput = input.audience && typeof input.audience === "object" && !Array.isArray(input.audience) ? input.audience : {};
  const agent = {
    agentId,
    accountId: runtime.accountId,
    platform: runtime.platform,
    provider,
    profileRef: runtime.profileRef,
    providerProfileId: runtime.providerProfileId,
    verifiedIdentity: Object.freeze({
      reference: identity,
      handle: text(identity ? (input.verifiedIdentity?.handle || input.handle) : "", 160),
      stableId: text(identity ? (input.verifiedIdentity?.stableId || input.identityId) : "", 160)
    }),
    sessionState: runtime.sessionHealth,
    health: text(input.health || runtime.sessionHealth, 80).toLowerCase() || "unknown",
    risk: runtime.risk,
    persona: Object.freeze({
      name: text(personaInput.name || input.personaName, 120),
      style: text(personaInput.style, 160),
      voice: text(personaInput.voice, 160),
      disclosure: text(personaInput.disclosure, 200)
    }),
    audience: Object.freeze({
      segments: list(audienceInput.segments || input.audienceSegments),
      languages: list(audienceInput.languages || input.languages),
      description: text(audienceInput.description, 240)
    }),
    topicWeights: Object.freeze(boundedWeights(input.topicWeights)),
    contentHistory: Object.freeze(boundedHistory(input.contentHistory)),
    engagementHistory: Object.freeze(boundedHistory(input.engagementHistory)),
    performanceHistory: Object.freeze(boundedHistory(input.performanceHistory)),
    quota: runtime.quota,
    cadence: runtime.cadence,
    cooldown: runtime.cooldown,
    authority: normalizeAuthority(input),
    capabilities: Object.freeze(list(input.capabilities)),
    eligibilityBinding: Object.freeze({
      platform: runtime.platform,
      accountId: runtime.accountId,
      provider,
      profileRef,
      identityReference: identity,
      allowedCampaigns: Object.freeze([...runtime.allowedCampaigns]),
      allowedTargets: Object.freeze([...runtime.allowedTargets])
    }),
    lastHealthCheck: runtime.lastHealthCheck,
    runtimeFingerprint: runtime.runtimeFingerprint,
    metadataVersion: runtime.metadataVersion
  };
  return freeze(agent);
}

/** Build a stable, bounded Account Agent registry without side effects. */
export function createAccountAgentRegistry(accounts = []) {
  if (!Array.isArray(accounts)) fail("Account Agent registry input must be an array");
  if (accounts.length > MAX_AGENTS) fail(`Account Agent registry is limited to ${MAX_AGENTS} entries`);
  const agents = accounts.map(normalizeAccountAgent).sort((a, b) => a.agentId.localeCompare(b.agentId));
  const seen = new Set();
  for (const agent of agents) {
    if (seen.has(agent.agentId)) fail(`Duplicate Account Agent: ${agent.agentId}`);
    seen.add(agent.agentId);
  }
  return Object.freeze(agents);
}

function eligible(agent, request = {}, now = Date.now()) {
  const reasons = [];
  const platform = text(request.platform || request.workloadPlatform, 80).toLowerCase();
  const provider = text(request.provider || request.executionProvider, 80).toLowerCase();
  const profile = text(request.profileRef || request.providerProfileId || request.profileReference, 240);
  const campaignId = text(request.campaignId, 160);
  const targetId = text(request.targetId, 160);
  if (platform && agent.platform !== platform) reasons.push("platform:mismatch");
  if (provider && agent.provider !== provider) reasons.push("provider:mismatch");
  if (RETIRED_PROVIDERS.has(agent.provider)) reasons.push("provider:retired_gpm");
  if (profile && agent.profileRef !== profile && agent.providerProfileId !== profile) reasons.push("profile:mismatch");
  if (request.identityReference && agent.verifiedIdentity.reference !== canonicalIdentityUrl(text(request.identityReference, 400))) reasons.push("identity:mismatch");
  if (!new Set(["healthy", "ready", "active"]).has(agent.sessionState)) reasons.push(`session:${agent.sessionState || "unknown"}`);
  if (QUARANTINED_RISK.has(agent.risk)) reasons.push(`risk:${agent.risk}`);
  const allowedCampaigns = agent.eligibilityBinding.allowedCampaigns;
  const allowedTargets = agent.eligibilityBinding.allowedTargets;
  if (allowedCampaigns.length && (!campaignId || (!allowedCampaigns.includes("*") && !allowedCampaigns.includes(campaignId)))) reasons.push("campaign:not_allowed");
  if (allowedTargets.length && (!targetId || (!allowedTargets.includes("*") && !allowedTargets.includes(targetId)))) reasons.push("target:not_allowed");
  const cooldownUntil = Date.parse(agent.cooldown.until || agent.cooldown.untilAt || "");
  if (Number.isFinite(cooldownUntil) && cooldownUntil > now) reasons.push("cooldown:active");
  const limit = Number(agent.quota.maxActionsPerDay ?? agent.quota.dailyLimit);
  const used = Number(agent.quota.usedToday ?? agent.quota.actionsToday ?? 0);
  if (Number.isFinite(limit) && limit >= 0 && Number.isFinite(used) && used >= limit) reasons.push("quota:daily_limit");
  return { eligible: reasons.length === 0, state: reasons.some((item) => item.startsWith("session:") || item.startsWith("risk:")) ? "QUARANTINED" : reasons.length ? "INELIGIBLE" : "ELIGIBLE", reasons };
}

/** Select an Account Agent by exact workload binding, deterministically. */
export function selectAccountAgentCandidate(registry = [], request = {}) {
  const agents = createAccountAgentRegistry(registry);
  const now = request.now instanceof Date ? request.now.getTime() : Date.parse(request.now || "") || Date.now();
  const rows = agents.map((agent) => ({ agent, ...eligible(agent, request, now) }));
  const preferred = list(request.preferredAgentIds || request.preferredAccountIds);
  const selected = rows.filter((row) => row.eligible).sort((a, b) => {
    const ai = preferred.indexOf(a.agent.agentId); const bi = preferred.indexOf(b.agent.agentId);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.agent.agentId.localeCompare(b.agent.agentId);
  })[0] || null;
  return freeze({
    status: selected ? "SELECTED" : "NO_ELIGIBLE_AGENT",
    selected: selected?.agent || null,
    selectionReason: selected ? (preferred.includes(selected.agent.agentId) ? "preferred_agent" : "stable_agent_order") : "all_agents_ineligible",
    candidates: rows.map(({ agent, state, reasons }) => ({ agentId: agent.agentId, accountId: agent.accountId, platform: agent.platform, provider: agent.provider, profileRef: agent.profileRef, eligibilityState: state, eligibilityReasons: reasons }))
  });
}

/** Bounded Mission Control read model; no authority or execution controls. */
export function projectAccountAgentMissionControl(registry = [], request = {}) {
  const selection = selectAccountAgentCandidate(registry, request);
  return freeze({
    readOnly: true,
    observedAt: new Date(request.now || Date.now()).toISOString(),
    agents: selection.candidates,
    selection: { status: selection.status, selectionReason: selection.selectionReason, selectedAgentId: selection.selected?.agentId || null, selectedAccountId: selection.selected?.accountId || null }
  });
}

export const createAccountAgents = createAccountAgentRegistry;
export const selectAccountAgent = selectAccountAgentCandidate;
export const ACCOUNT_AGENT_REGISTRY_MAX = MAX_AGENTS;
