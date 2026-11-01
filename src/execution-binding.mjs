/**
 * Provider-aware execution identity.
 *
 * `profileId` is retained as a legacy storage alias. New bindings must carry
 * an explicit provider and providerProfileId. Missing provider is accepted only
 * for legacy rows, where the compatibility adapter is explicitly ORCA; UUID
 * shape is never used to select a provider.
 */
const text = (value) => String(value ?? "").trim();

export const LEGACY_ORCA_PROVIDER = "orca";

function required(value, label) {
  const result = text(value);
  if (!result) throw new Error(`${label} is required`);
  return result;
}

export function canonicalProvider(value, { allowLegacy = true } = {}) {
  const provider = text(value).toLowerCase();
  if (provider) return provider;
  if (allowLegacy) return LEGACY_ORCA_PROVIDER;
  throw new Error("execution provider is required");
}

export function canonicalIdentityUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    // Facebook numeric profiles encode their immutable identity in `id`.
    // Preserve that one bounded query parameter across provider-aware binding
    // comparisons; all other identity query material remains discarded.
    if (url.hostname.replace(/^www\./, "") === "facebook.com" && url.pathname.toLowerCase() === "/profile.php") {
      const id = url.searchParams.get("id") || "";
      url.search = /^\d{3,80}$/.test(id) ? `?id=${encodeURIComponent(id)}` : "";
    } else {
      url.search = "";
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function canonicalTargetUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return raw;
  }
}

/** Normalize one complete provider/account/profile/identity/target binding. */
export function normalizeExecutionBinding(input = {}, { allowLegacy = true, requireTarget = false } = {}) {
  const platform = required(input.platform || input.channel, "execution platform").toLowerCase();
  const accountId = required(input.accountId, "execution accountId");
  const explicitProvider = text(input.provider).toLowerCase();
  // `profileId` is the only historical storage alias. The other aliases are
  // provider-aware references and must never silently select the legacy lane.
  if (!explicitProvider && (text(input.providerProfileId) || text(input.profileReference))) {
    throw new Error("provider is required when providerProfileId or profileReference is supplied");
  }
  const provider = canonicalProvider(input.provider, { allowLegacy });
  const profileAliases = [
    ["providerProfileId", input.providerProfileId],
    ["profileReference", input.profileReference],
    ["profileRef", input.profileRef],
    ["profileId", input.profileId]
  ].map(([name, value]) => [name, text(value)]).filter(([, value]) => value);
  const providerProfileId = required(profileAliases[0]?.[1], "provider profile ID");
  for (const [name, value] of profileAliases) {
    if (value !== providerProfileId) throw new Error(`${name} must match providerProfileId in an explicit execution binding`);
  }
  const suppliedProfileId = text(input.profileId);
  const identityReference = canonicalIdentityUrl(input.identityReference || input.expectedIdentityUrl || input.verifiedIdentityUrl);
  if (requireTarget && !text(input.targetId)) throw new Error("execution targetId is required");
  if (requireTarget && !text(input.targetUrl || input.url)) throw new Error("execution target URL is required");
  return {
    platform,
    accountId,
    provider,
    providerProfileId,
    // Compatibility alias. It is deliberately not used for provider routing.
    profileId: suppliedProfileId || providerProfileId,
    identityReference,
    expectedIdentityUrl: identityReference,
    targetId: text(input.targetId) || null,
    targetUrl: canonicalTargetUrl(input.targetUrl || input.url)
  };
}

export function accountExecutionBinding(account, options = {}) {
  return normalizeExecutionBinding(account, options);
}

export function targetExecutionBinding(target, account = null, options = {}) {
  return normalizeExecutionBinding({ ...(account || {}), ...(target || {}), platform: target?.channel || target?.platform || account?.platform, targetId: target?.id || target?.targetId, targetUrl: target?.url || target?.targetUrl }, options);
}

export function bindingMatches(left, right, { requireIdentity = true, requireTarget = true } = {}) {
  if (!left || !right) return false;
  let a;
  let b;
  try {
    a = normalizeExecutionBinding(left, { allowLegacy: true, requireTarget: false });
    b = normalizeExecutionBinding(right, { allowLegacy: true, requireTarget: false });
  } catch {
    return false;
  }
  if (a.platform !== b.platform || a.accountId !== b.accountId || a.provider !== b.provider || a.providerProfileId !== b.providerProfileId) return false;
  if (requireIdentity) {
    // A provider-aware lane must carry a verified identity on both sides.
    // Legacy ORCA rows retain their historical identity-optional contract.
    if (a.provider !== LEGACY_ORCA_PROVIDER && (!a.identityReference || !b.identityReference)) return false;
    // Legacy rows may predate identity persistence. Compare identity only when
    // both sides carry it; provider-aware rows above remain strict.
    if (a.identityReference && b.identityReference && a.identityReference !== b.identityReference) return false;
  }
  if (requireTarget) {
    if (!a.targetId || !b.targetId || a.targetId !== b.targetId) return false;
    // Provider-aware lanes require the exact canonical URL. Legacy ORCA
    // records may predate target URL persistence, but still compare URLs when
    // both sides carry them.
    if (a.provider !== LEGACY_ORCA_PROVIDER && (!a.targetUrl || !b.targetUrl)) return false;
    if (a.targetUrl && b.targetUrl && a.targetUrl !== b.targetUrl) return false;
  }
  return true;
}

/**
 * Compare a registered account with its exact target binding. The account and
 * target are intentionally checked as separate records before their combined
 * binding is used by downstream authority/session code.
 */
export function accountTargetBindingMatches(target, account, { requireTarget = true } = {}) {
  if (!target || !account) return false;
  const providerAware = Boolean(account.provider || account.providerProfileId);
  if (providerAware && (!text(target.provider) || !text(target.providerProfileId) || !canonicalIdentityUrl(target.identityReference || target.expectedIdentityUrl))) return false;
  try {
    const accountBinding = normalizeExecutionBinding({
      ...account,
      platform: account.platform || target.channel,
      targetId: target.id || target.targetId,
      targetUrl: target.url || target.targetUrl
    }, { allowLegacy: true, requireTarget });
    const targetBinding = targetExecutionBinding(target, account, { allowLegacy: true, requireTarget });
    return bindingMatches(accountBinding, targetBinding, { requireIdentity: true, requireTarget });
  } catch {
    return false;
  }
}

/** Compare an authorization destination to the registered target/account. */
export function destinationBindingMatches(destination, target, account, { requireTarget = true } = {}) {
  if (!destination || !target || !account) return false;
  if (!accountTargetBindingMatches(target, account, { requireTarget })) return false;
  try {
    return bindingMatches(destination, targetExecutionBinding(target, account, { allowLegacy: true, requireTarget }), {
      requireIdentity: true,
      requireTarget
    });
  } catch {
    return false;
  }
}

export function bindingFingerprintInput(value, { requireTarget = false } = {}) {
  const binding = normalizeExecutionBinding(value, { allowLegacy: true, requireTarget });
  return {
    platform: binding.platform,
    accountId: binding.accountId,
    provider: binding.provider,
    providerProfileId: binding.providerProfileId,
    identityReference: binding.identityReference,
    targetId: binding.targetId,
    targetUrl: binding.targetUrl
  };
}

export function providerProfileMatches(left, right) {
  try {
    const a = normalizeExecutionBinding(left);
    const b = normalizeExecutionBinding(right);
    return a.provider === b.provider && a.providerProfileId === b.providerProfileId;
  } catch {
    return false;
  }
}

/** Stable coordination key. Legacy rows preserve the old ORCA key shape. */
export function executionProfileKey(targetOrAccount = {}) {
  const platform = text(targetOrAccount.platform || targetOrAccount.channel).toLowerCase();
  const provider = canonicalProvider(targetOrAccount.provider, { allowLegacy: true });
  const profile = text(targetOrAccount.providerProfileId || targetOrAccount.profileReference || targetOrAccount.profileRef || targetOrAccount.profileId);
  if (!platform || !profile) return null;
  return provider === LEGACY_ORCA_PROVIDER ? `${platform}:${profile}` : `${platform}:${provider}:${profile}`;
}

