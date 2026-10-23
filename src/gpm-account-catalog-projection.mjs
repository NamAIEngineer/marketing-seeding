import { createHash } from "node:crypto";

const MAX_ROWS = 128;
const CATALOG_STATES = new Set(["OBSERVED", "UNKNOWN", "UNAVAILABLE"]);
const SECRET_KEY = /(cookie|token|secret|password|authorization|credential|session|proxy|storage|note|access[_-]?key|private[_-]?key)/i;

function text(value, limit = 240) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim().slice(0, limit);
  return result || null;
}

function safeDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function profileFingerprint(profileId) {
  return createHash("sha256").update(String(profileId)).digest("hex");
}

function validState(value) {
  const state = String(value || "").trim().toUpperCase();
  return CATALOG_STATES.has(state) ? state : "UNKNOWN";
}

function safeTags(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((tag) => {
    if (typeof tag === "string") return text(tag, 80);
    return tag && typeof tag === "object" ? text(tag.name || tag.id, 80) : null;
  }).filter(Boolean);
}

function safeBrowser(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { name: text(value.name, 80), version: text(value.version, 80) };
}

function normalizeCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return { state: "UNKNOWN", code: "GPM_PROFILE_CATALOG_INPUT_UNKNOWN", count: 0, rows: [] };
  }
  const state = validState(catalog.state);
  const rawRows = Array.isArray(catalog.profiles) ? catalog.profiles : [];
  const rows = [];
  const seen = new Set();
  for (const raw of rawRows.slice(0, MAX_ROWS)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const profileId = text(raw.profileId || raw.id, 160);
    if (!profileId || seen.has(profileId)) continue;
    seen.add(profileId);
    rows.push({
      profileId,
      profileFingerprint: profileFingerprint(profileId),
      name: text(raw.name, 160),
      groupId: text(raw.groupId, 120),
      browser: safeBrowser(raw.browser),
      os: text(raw.os, 80),
      pinned: raw.pinned === true,
      tags: safeTags(raw.tags),
      createdAt: safeDate(raw.createdAt),
      updatedAt: safeDate(raw.updatedAt)
    });
  }
  return {
    state,
    code: text(catalog.code, 120),
    count: Number.isSafeInteger(catalog.count) && catalog.count >= 0 ? catalog.count : rows.length,
    rows
  };
}

function normalizeAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];
  return accounts.slice(0, MAX_ROWS).map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const profileId = text(raw.profileId, 160);
    const accountId = text(raw.accountId, 160);
    if (!profileId || !accountId) return null;
    return {
      sourceIndex: index,
      profileId,
      profileFingerprint: profileFingerprint(profileId),
      platform: text(raw.platform, 80),
      accountId,
      status: text(raw.status, 80),
      health: text(raw.health, 80)
    };
  }).filter(Boolean).sort((left, right) => {
    const a = `${left.profileId}\u0000${left.platform || ""}\u0000${left.accountId}`;
    const b = `${right.profileId}\u0000${right.platform || ""}\u0000${right.accountId}`;
    return a.localeCompare(b);
  });
}

function accountView(account, linkage, reasons = []) {
  return {
    platform: account.platform,
    accountId: account.accountId,
    status: account.status,
    health: account.health,
    profileFingerprint: account.profileFingerprint,
    catalogLinkage: linkage,
    reasons: [...new Set(reasons)]
  };
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

/**
 * Project GPM profile catalog metadata alongside existing execution accounts.
 * Exact profile ID equality is used internally; raw profile IDs never leave
 * this function. This projection never creates accounts or changes readiness.
 */
export function projectGpmAccountCatalog(catalog, executionAccounts = [], { now = new Date() } = {}) {
  const observedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("GPM account catalog observation time must be valid");
  const normalizedCatalog = normalizeCatalog(catalog);
  const accounts = normalizeAccounts(executionAccounts);
  const byProfile = new Map();
  for (const account of accounts) {
    const rows = byProfile.get(account.profileId) || [];
    rows.push(account);
    byProfile.set(account.profileId, rows);
  }
  const catalogObserved = normalizedCatalog.state === "OBSERVED";
  const catalogProfiles = normalizedCatalog.rows.map((profile) => {
    const bound = catalogObserved ? (byProfile.get(profile.profileId) || []) : [];
    const linkage = !catalogObserved ? "NOT_OBSERVED" : bound.length > 1 ? "AMBIGUOUS" : bound.length === 1 ? "EXACT" : "UNBOUND";
    return {
      profileFingerprint: profile.profileFingerprint,
      name: profile.name,
      groupId: profile.groupId,
      browser: profile.browser,
      os: profile.os,
      pinned: profile.pinned,
      tags: profile.tags,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      linkage: {
        status: linkage,
        accountCount: bound.length,
        accountIds: bound.map((account) => account.accountId).sort(),
        accountProfileFingerprints: bound.map((account) => account.profileFingerprint).sort()
      }
    };
  }).sort((left, right) => `${left.name || ""}\u0000${left.profileFingerprint}`.localeCompare(`${right.name || ""}\u0000${right.profileFingerprint}`));
  const accountRows = accounts.map((account) => {
    if (!catalogObserved) return accountView(account, "NOT_OBSERVED", [`catalog:${normalizedCatalog.state.toLowerCase()}`]);
    const matches = normalizedCatalog.rows.filter((profile) => profile.profileId === account.profileId);
    if (matches.length === 0) return accountView(account, "MISSING", ["catalog:profile_missing"]);
    const sameProfile = byProfile.get(account.profileId) || [];
    if (sameProfile.length > 1) return accountView(account, "AMBIGUOUS", ["catalog:duplicate_account_profile"]);
    return accountView(account, "EXACT");
  });
  const boundProfiles = catalogProfiles.filter((profile) => profile.linkage.status === "EXACT").length;
  const unboundProfiles = catalogProfiles.filter((profile) => profile.linkage.status === "UNBOUND").length;
  const ambiguousProfiles = catalogProfiles.filter((profile) => profile.linkage.status === "AMBIGUOUS").length;
  const missingProfiles = accountRows.filter((account) => account.catalogLinkage === "MISSING").length;
  return freeze({
    readOnly: true,
    observedAt: observedAt.toISOString(),
    catalog: {
      state: normalizedCatalog.state,
      code: normalizedCatalog.code,
      count: normalizedCatalog.count,
      profiles: catalogProfiles.slice(0, MAX_ROWS)
    },
    accounts: accountRows.slice(0, MAX_ROWS),
    summary: {
      catalogProfiles: catalogProfiles.length,
      boundProfiles,
      unboundProfiles,
      missingProfiles,
      ambiguousProfiles,
      accountRows: accountRows.length,
      accountIdentityProven: false,
      sessionReadinessProven: false,
      executionEligible: false
    }
  });
}

export { profileFingerprint };
