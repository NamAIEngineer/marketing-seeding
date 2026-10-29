/**
 * Strict, standalone Camoufox login adapters for non-LinkedIn channels.
 *
 * The caller owns credential retrieval and passes { username, password } only
 * for the duration of this call. This module never persists, logs, or returns
 * credential material. It only observes rendered, read-only page evidence and
 * returns a bounded login/identity/target-rights result.
 */

const SUPPORTED_PLATFORMS = Object.freeze([
  "facebook_group",
  "threads",
  "reddit",
  "product_hunt",
  "indie_hackers"
]);

const RESULT_STATES = Object.freeze(["READY", "BLOCKED", "UNKNOWN"]);
const RIGHTS_STATES = Object.freeze(["READY", "BLOCKED", "UNKNOWN", "NOT_CHECKED"]);
const MAX_TEXT = 240;
const MAX_REASON = 320;
const SAFE_ACCOUNT_ID = /^[A-Za-z0-9._:@+-]{1,160}$/;
const SHARED_CHALLENGE_PATTERNS = Object.freeze([
  /captcha/i,
  /recaptcha/i,
  /security\s+check/i,
  /suspicious\s+(?:login|activity)/i,
  /checkpoint/i,
  /two[-\s]?factor/i,
  /multi[-\s]?factor/i,
  /mfa/i,
  /one[-\s]?time\s+(?:code|password)/i,
  /confirm\s+(?:it'?s|your)\s+you/i,
  /verify\s+your\s+(?:identity|account)/i,
  /account\s+(?:locked|suspended|restricted)/i,
  /access\s+(?:blocked|denied)/i
]);

const text = (value, limit = MAX_TEXT) => typeof value === "string"
  ? value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
  : "";

const key = (value) => text(value, 80).toLowerCase();

function result(status, code, reason, fields = {}) {
  const normalizedStatus = RESULT_STATES.includes(status) ? status : "UNKNOWN";
  return {
    status: normalizedStatus,
    code: text(code || "UNKNOWN", 100),
    reason: text(reason || "No bounded result", MAX_REASON),
    ...fields,
    externalSideEffects: false,
    published: false,
    publicationReference: null
  };
}

function safeErrorCode(error, fallback = "CAMOUFOX_LOGIN_FAILED") {
  const value = text(error?.code, 100);
  return /^[A-Z][A-Z0-9_]{2,99}$/.test(value) ? value : fallback;
}

function safeErrorReason(error, fallback = "Camoufox login observation failed") {
  // Protocol implementations can include page/session data in thrown text;
  // never echo arbitrary error messages from a credential-bearing call.
  void error;
  return fallback;
}

function platformOf(value) {
  const platform = key(value);
  return SUPPORTED_PLATFORMS.includes(platform) ? platform : null;
}

function accountOf(value) {
  const accountId = text(value, 160);
  return accountId && SAFE_ACCOUNT_ID.test(accountId) ? accountId : null;
}

function hostOf(url) {
  return String(url.hostname || "").toLowerCase().replace(/^www\./, "");
}

function canonicalPath(pathname) {
  const value = String(pathname || "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return value || "/";
}

const FACEBOOK_RESERVED = new Set([
  "home", "groups", "pages", "watch", "marketplace", "login", "settings", "friends",
  "notifications", "messages", "share", "search", "photo", "reel", "events", "gaming"
]);

const IDENTITY_RULES = Object.freeze({
  facebook_group: Object.freeze({
    hosts: Object.freeze(["facebook.com"]),
    canonicalHost: "facebook.com",
    source: "facebook-owner-profile-surface",
    loginUrl: "https://www.facebook.com/login/",
    identityReference(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (url.protocol !== "https:" || !this.hosts.includes(hostOf(url))) return null;
      const path = canonicalPath(url.pathname).toLowerCase();
      if (path === "/profile.php") {
        const id = url.searchParams.get("id") || "";
        if (!/^\d{3,80}$/.test(id)) return null;
        return `https://${this.canonicalHost}/profile.php?id=${id}`;
      }
      const match = canonicalPath(url.pathname).match(/^\/([a-z0-9][a-z0-9._-]{2,99})$/i);
      if (!match || FACEBOOK_RESERVED.has(match[1].toLowerCase())) return null;
      return `https://${this.canonicalHost}/${match[1].toLowerCase()}`;
    },
    targetUrl(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (!/^https?:$/.test(url.protocol) || hostOf(url) !== "facebook.com") return null;
      if (!/^\/groups\/[^/]+(?:\/.*)?$/i.test(canonicalPath(url.pathname))) return null;
      url.hash = "";
      return url.toString();
    },
    usernameQuery: /email|phone|username|mobile/i,
    submitQuery: /log\s*in|login|sign\s*in|continue/i,
    rightsSource: "facebook-group-composer",
    requireRulesEvidence: true,
    identityExpression: null,
    postingRightsExpression: null
  }),
  threads: Object.freeze({
    hosts: Object.freeze(["threads.net", "threads.com"]),
    canonicalHost: "threads.net",
    source: "threads-owner-profile-surface",
    loginUrl: "https://www.threads.net/login/",
    identityReference(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (url.protocol !== "https:" || !this.hosts.includes(hostOf(url))) return null;
      const match = canonicalPath(url.pathname).match(/^\/@([a-z0-9][a-z0-9._-]{0,49})$/i);
      return match ? `https://${this.canonicalHost}/@${match[1].toLowerCase()}` : null;
    },
    targetUrl(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (!/^https?:$/.test(url.protocol) || !this.hosts.includes(hostOf(url))) return null;
      url.hash = "";
      return url.toString();
    },
    usernameQuery: /email|phone|username|user\s*name/i,
    submitQuery: /log\s*in|login|sign\s*in|continue/i,
    rightsSource: "threads-composer",
    identityExpression: null,
    postingRightsExpression: null
  }),
  reddit: Object.freeze({
    hosts: Object.freeze(["reddit.com"]),
    canonicalHost: "reddit.com",
    source: "reddit-owner-profile-surface",
    loginUrl: "https://www.reddit.com/login/",
    identityReference(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (url.protocol !== "https:" || !this.hosts.includes(hostOf(url))) return null;
      const match = canonicalPath(url.pathname).match(/^\/user\/([a-z0-9_-]{3,50})$/i);
      return match ? `https://${this.canonicalHost}/user/${match[1].toLowerCase()}` : null;
    },
    targetUrl(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (!/^https?:$/.test(url.protocol) || hostOf(url) !== "reddit.com") return null;
      if (!/^\/(?:r\/[a-z0-9_+-]{2,80}|user\/[a-z0-9_-]{3,50})(?:\/.*)?$/i.test(canonicalPath(url.pathname))) return null;
      url.hash = "";
      return url.toString();
    },
    usernameQuery: /email|username|user\s*name/i,
    submitQuery: /log\s*in|login|sign\s*in|continue/i,
    rightsSource: "reddit-community-composer",
    requireRulesEvidence: true,
    identityExpression: null,
    postingRightsExpression: null
  }),
  product_hunt: Object.freeze({
    hosts: Object.freeze(["producthunt.com"]),
    canonicalHost: "producthunt.com",
    source: "product-hunt-owner-profile-surface",
    loginUrl: "https://www.producthunt.com/login/",
    identityReference(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (url.protocol !== "https:" || !this.hosts.includes(hostOf(url))) return null;
      const match = canonicalPath(url.pathname).match(/^\/@([a-z0-9][a-z0-9._-]{0,79})$/i);
      return match ? `https://${this.canonicalHost}/@${match[1].toLowerCase()}` : null;
    },
    targetUrl(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (!/^https?:$/.test(url.protocol) || hostOf(url) !== "producthunt.com") return null;
      if (!/^\/(?:posts?|products?|topics?|\@)[^/]*(?:\/.*)?$/i.test(canonicalPath(url.pathname))) return null;
      url.hash = "";
      return url.toString();
    },
    usernameQuery: /email|username|user\s*name/i,
    submitQuery: /log\s*in|login|sign\s*in|continue/i,
    rightsSource: "product-hunt-composer",
    requireRulesEvidence: true,
    identityExpression: null,
    postingRightsExpression: null
  }),
  indie_hackers: Object.freeze({
    hosts: Object.freeze(["indiehackers.com"]),
    canonicalHost: "indiehackers.com",
    source: "indie-hackers-owner-profile-surface",
    loginUrl: "https://www.indiehackers.com/login/",
    identityReference(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (url.protocol !== "https:" || !this.hosts.includes(hostOf(url))) return null;
      const match = canonicalPath(url.pathname).match(/^\/u\/([a-z0-9][a-z0-9._-]{0,79})$/i);
      return match ? `https://${this.canonicalHost}/u/${match[1].toLowerCase()}` : null;
    },
    targetUrl(value) {
      let url;
      try { url = new URL(String(value)); } catch { return null; }
      if (!/^https?:$/.test(url.protocol) || hostOf(url) !== "indiehackers.com") return null;
      if (!/^\/(?:u|groups?|posts?|products?)(?:\/|$)/i.test(canonicalPath(url.pathname))) return null;
      url.hash = "";
      return url.toString();
    },
    usernameQuery: /email|username|user\s*name/i,
    submitQuery: /log\s*in|login|sign\s*in|continue/i,
    rightsSource: "indie-hackers-community-composer",
    requireRulesEvidence: true,
    identityExpression: null,
    postingRightsExpression: null
  })
});

/**
 * Build an explicit identity observation expression for one platform. Every
 * expression only reads visible owner-surface links and URL state. It never
 * reads browser storage, cookies, tokens, or page credentials.
 */
function identityExpressionFor(platform, rule) {
  const hosts = JSON.stringify(rule.hosts);
  const source = JSON.stringify(rule.source);
  let parser;
  if (platform === "facebook_group") {
    parser = `
      if (host !== "facebook.com") return null;
      if (path === "/profile.php") {
        const id = url.searchParams.get("id") || "";
        if (!/^\\d{3,80}$/.test(id)) return null;
        return { reference: "https://facebook.com/profile.php?id=" + id, stableId: id };
      }
      const match = path.match(/^\\/([a-z0-9][a-z0-9._-]{2,99})$/i);
      if (!match || ["home","groups","pages","watch","marketplace","login","settings","friends","notifications","messages","share","search","photo","reel","events","gaming"].includes(match[1].toLowerCase())) return null;
      return { reference: "https://facebook.com/" + match[1].toLowerCase(), stableId: match[1].toLowerCase() };
    `;
  } else if (platform === "threads") {
    parser = `
      if (!hosts.includes(host)) return null;
      const match = path.match(/^\\/@([a-z0-9][a-z0-9._-]{0,49})$/i);
      return match ? { reference: "https://threads.net/@" + match[1].toLowerCase(), stableId: match[1].toLowerCase() } : null;
    `;
  } else if (platform === "reddit") {
    parser = `
      if (host !== "reddit.com") return null;
      const match = path.match(/^\\/user\\/([a-z0-9_-]{3,50})$/i);
      return match ? { reference: "https://reddit.com/user/" + match[1].toLowerCase(), stableId: match[1].toLowerCase() } : null;
    `;
  } else if (platform === "product_hunt") {
    parser = `
      if (host !== "producthunt.com") return null;
      const match = path.match(/^\\/@([a-z0-9][a-z0-9._-]{0,79})$/i);
      return match ? { reference: "https://producthunt.com/@" + match[1].toLowerCase(), stableId: match[1].toLowerCase() } : null;
    `;
  } else {
    parser = `
      if (host !== "indiehackers.com") return null;
      const match = path.match(/^\\/u\\/([a-z0-9][a-z0-9._-]{0,79})$/i);
      return match ? { reference: "https://indiehackers.com/u/" + match[1].toLowerCase(), stableId: match[1].toLowerCase() } : null;
    `;
  }
  return `(() => {
    const hosts = ${hosts};
    const visible = (node) => Boolean(node && node.getClientRects && node.getClientRects().length);
    const ownerSurface = (node) => Boolean(node && node.closest && node.closest('nav,header,[role="navigation"],[data-testid*="profile"],[data-testid*="account"]'));
    const parse = (value) => {
      try {
        const url = new URL(value, location.href);
        const host = url.hostname.toLowerCase().replace(/^www\\./, '');
        const path = (url.pathname.replace(/\\/{2,}/g, '/').replace(/\\/$/, '') || '/').toLowerCase();
        ${parser}
      } catch { return null; }
    };
    const candidates = Array.from(document.querySelectorAll('a[href]'))
      .filter((node) => visible(node) && ownerSurface(node))
      .map((node) => { const identity = parse(node.href); return identity ? { ...identity, ownerSurface: true } : null; })
      .filter(Boolean)
      .filter((candidate, index, all) => all.findIndex((other) => other.reference === candidate.reference) === index);
    const unique = candidates.map((candidate) => ({ ...candidate, source: ${source}, score: 140 }));
    const one = unique.length === 1 ? unique[0] : null;
    const challengeDetected = /\\/(?:checkpoint|challenge|captcha|security[-_]check)(?:\\/|$)/i.test(location.pathname);
    return {
      authenticated: Boolean(one), authenticatedSurface: Boolean(one), ownerSurface: Boolean(one),
      identityReference: one?.reference || null, stableId: one?.stableId || null,
      source: one?.source || ${source}, identitySource: one?.source || null, confidence: one?.score || 0,
      ambiguous: unique.length > 1, candidateCount: unique.length,
      candidates: unique.slice(0, 8).map(({ reference, stableId, source, score }) => ({ reference, stableId, source, score })),
      challengeDetected
    };
  })()`;
}

/**
 * Build a read-only target rights probe. It checks the requested target URL,
 * explicit platform rights markers, and visible composer controls. It never
 * fills, clicks, submits, or otherwise mutates the page.
 */
function postingRightsExpressionFor(rule, targetUrl) {
  const expected = JSON.stringify(targetUrl);
  const source = JSON.stringify(rule.rightsSource);
  return `(() => {
    const expected = new URL(${expected}, location.href);
    const actual = new URL(location.href);
    const normalize = (url) => url.origin.toLowerCase() + (url.pathname.replace(/\\/$/, '') || '/') + url.search;
    const targetMatched = normalize(actual) === normalize(expected) || actual.pathname.toLowerCase().startsWith(expected.pathname.toLowerCase().replace(/\\/$/, '') + '/');
    const visible = (node) => Boolean(node && node.getClientRects && node.getClientRects().length);
    const editors = Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')).filter(visible);
    const controls = Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible);
    const postControl = controls.find((node) => /^(post|submit|publish|comment|reply|share|create|send)$/i.test((node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim()));
    const explicit = document.querySelector('[data-can-post],[data-posting-rights],[data-membership-status],[data-posting-status]');
    const explicitCanPost = explicit?.getAttribute('data-can-post');
    const membershipStatus = (explicit?.getAttribute('data-membership-status') || '').toLowerCase();
    const postingStatus = (explicit?.getAttribute('data-posting-status') || '').toLowerCase();
    const membershipRequired = membershipStatus === 'required' || membershipStatus === 'not_member' || postingStatus === 'blocked';
    const rightsDeclared = explicitCanPost === 'true' || explicitCanPost === 'false' || Boolean(membershipStatus || postingStatus);
    const canPost = explicitCanPost === 'true' || (targetMatched && editors.length === 1 && Boolean(postControl) && postControl.disabled !== true && postControl.getAttribute('aria-disabled') !== 'true');
    const rules = document.querySelector('[data-rules-status],[data-community-rules],[data-group-rules]');
    const rulesStatus = (rules?.getAttribute('data-rules-status') || rules?.getAttribute('data-community-rules') || rules?.getAttribute('data-group-rules') || '').toLowerCase();
    const rulesEvidenceAccepted = ['reviewed','accepted','acknowledged','available','visible'].includes(rulesStatus);
    const rulesEvidenceDenied = ['denied','rejected','blocked','required','pending'].includes(rulesStatus);
    return {
      targetMatched, canPost: Boolean(canPost), rightsDeclared, authenticatedSurface: Boolean(targetMatched && (editors.length || explicit || postControl)),
      membershipRequired, membershipStatus: membershipStatus || null, postingStatus: postingStatus || null,
      source: ${source}, composerVisible: editors.length === 1, submitControlVisible: Boolean(postControl),
      submitControlEnabled: Boolean(postControl && postControl.disabled !== true && postControl.getAttribute('aria-disabled') !== 'true'),
      rulesStatus: rulesStatus || null, rulesEvidencePresent: Boolean(rulesStatus), rulesEvidenceAccepted, rulesEvidenceDenied
    };
  })()`;
}

// Keep the policy literals immutable while deriving their expression strings
// in a separate descriptor map.
const LOGIN_RULES = Object.fromEntries(Object.entries(IDENTITY_RULES).map(([platform, rule]) => [platform, { ...rule }]));
for (const [platform, rule] of Object.entries(LOGIN_RULES)) {
  rule.identityExpression = identityExpressionFor(platform, rule);
  rule.postingRightsExpression = postingRightsExpressionFor(rule, "https://example.invalid/");
}

function freezeRules() {
  for (const rule of Object.values(LOGIN_RULES)) Object.freeze(rule);
}
freezeRules();

function challengeMatch(snapshot, rule) {
  const value = typeof snapshot === "string" ? snapshot : "";
  return [...SHARED_CHALLENGE_PATTERNS, ...(rule.challengePatterns || [])].some((pattern) => pattern.test(value));
}

function identityFromValue(rule, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const evidence = value.evidence && typeof value.evidence === "object" ? value.evidence : {};
  const identityReference = value.identityReference || value.profileUrl || value.profileURL || value.url || value.expectedIdentityReference;
  const normalizedReference = rule.identityReference(identityReference);
  const source = text(value.source || value.identitySource || evidence.identitySource, 120) || null;
  const state = key(value.state || value.status);
  const candidateCount = Number.isFinite(Number(value.candidateCount))
    ? Math.max(0, Number(value.candidateCount))
    : Array.isArray(value.candidates) ? value.candidates.length : null;
  const ambiguous = value.ambiguous === true || value.identityAmbiguous === true || evidence.identityAmbiguous === true || candidateCount > 1;
  const authenticated = value.authenticated === true || value.authenticatedSurface === true || evidence.sessionAuthenticated === true || state === "ready";
  const ownerSurface = value.ownerSurface === true || source === rule.source || evidence.identitySource === rule.source;
  const identityVerified = value.identityVerified === true || evidence.identityVerified === true;
  const stableId = text(value.stableId || value.identityId || evidence.stableIdentityId, 160) || null;
  return {
    state: state.toUpperCase() || null,
    identityReference: normalizedReference,
    stableId,
    source,
    confidence: Number.isFinite(Number(value.confidence || evidence.identityConfidence)) ? Math.max(0, Number(value.confidence || evidence.identityConfidence)) : 0,
    candidateCount,
    ambiguous,
    authenticated,
    ownerSurface,
    identityVerified,
    challengeDetected: value.challengeDetected === true || value.securityChallenge === true || ["challenge", "challenged", "mfa", "security_challenge"].includes(state),
    platform: key(value.platform || evidence.platform) || null,
    accountId: text(value.accountId || value.account, 160) || null
  };
}

function stableIdentityFromReference(adapter, value) {
  const normalized = adapter.rule.identityReference(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (adapter.platform === "facebook_group" && url.pathname.toLowerCase() === "/profile.php") return url.searchParams.get("id")?.toLowerCase() || null;
    return url.pathname.split("/").filter(Boolean).pop()?.replace(/^@/, "").toLowerCase() || null;
  } catch { return null; }
}

function safeIdentityEvidence(identity) {
  return {
    identitySource: identity?.source || null,
    identityConfidence: Number(identity?.confidence) || 0,
    identityAmbiguous: identity?.ambiguous === true,
    candidateCount: Number.isFinite(identity?.candidateCount) ? identity.candidateCount : null,
    authenticatedSurface: identity?.authenticated === true,
    ownerSurface: identity?.ownerSurface === true,
    stableIdentityId: identity?.stableId || null
  };
}

async function observeIdentity({ adapter, protocol, pageId, accountId, expectedIdentity }) {
  let observed = null;
  let evaluateError = null;
  if (typeof protocol.evaluate === "function") {
    try { observed = await protocol.evaluate(pageId, adapter.identityExpression); }
    catch (error) { evaluateError = error; }
  }
  // A protocol supplied identity observation is accepted only after the same
  // descriptor-specific proof checks below. It is a fallback for injected
  // test/host protocols that do not expose evaluate().
  if (!observed || typeof observed !== "object") {
    if (typeof protocol.observeIdentity === "function") {
      try {
        observed = await protocol.observeIdentity({ pageId, platform: adapter.platform, expectedIdentity });
      } catch (error) {
        if (!evaluateError) evaluateError = error;
      }
    }
  }
  const identity = identityFromValue(adapter.rule, observed);
  if (!identity) return { identity: null, error: evaluateError };
  if (identity.challengeDetected) return { identity, error: null };
  if (identity.platform && identity.platform !== adapter.platform) return { identity, error: null };
  if (identity.accountId && identity.accountId !== accountId) return { identity, error: null };
  return { identity, error: evaluateError };
}

function identityResult(adapter, { accountId, expectedIdentity, identity, loginEvidence, challengeDetected = false, error = null } = {}) {
  const expectedReference = adapter.rule.identityReference(expectedIdentity);
  const evidence = {
    loginUrl: adapter.loginUrl,
    challengeDetected: Boolean(challengeDetected || identity?.challengeDetected),
    loginControlsObserved: loginEvidence?.controlsObserved === true,
    ...safeIdentityEvidence(identity)
  };
  if (evidence.challengeDetected) {
    return result("BLOCKED", "ACCOUNT_SECURITY_CHALLENGE", "Camoufox login reached a security challenge requiring owner action", {
      platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false,
      postingRights: { status: "UNKNOWN", targetId: null, reason: "login_challenge", evidence: null }, evidence,
      nextAction: "HUMAN_REQUIRED"
    });
  }
  if (!expectedReference) {
    return result("UNKNOWN", "EXPECTED_IDENTITY_REQUIRED", "exact platform identity URL is required before Camoufox login can be marked ready", {
      platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false,
      postingRights: { status: "UNKNOWN", targetId: null, reason: "identity_required", evidence: null }, evidence,
      nextAction: "CONFIGURE_EXPECTED_IDENTITY"
    });
  }
  if (!identity?.identityReference) {
    return result("UNKNOWN", error ? safeErrorCode(error, "LOGIN_IDENTITY_UNAVAILABLE") : "LOGIN_IDENTITY_UNAVAILABLE", "authenticated page did not expose an exact owner identity proof", {
      platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false,
      postingRights: { status: "UNKNOWN", targetId: null, reason: "identity_unavailable", evidence: null }, evidence,
      nextAction: "REVIEW_IDENTITY"
    });
  }
  if (identity.platform && identity.platform !== adapter.platform) {
    return result("UNKNOWN", "LOGIN_PLATFORM_BINDING_MISMATCH", "observed identity belongs to a different platform", {
      platform: adapter.platform, accountId, identityReference: identity.identityReference, identityVerified: false, authenticated: false,
      postingRights: { status: "UNKNOWN", targetId: null, reason: "platform_binding_mismatch", evidence: null }, evidence,
      nextAction: "REVIEW_IDENTITY"
    });
  }
  if (identity.accountId && identity.accountId !== accountId) {
    return result("UNKNOWN", "LOGIN_ACCOUNT_BINDING_MISMATCH", "observed account binding did not match the requested account", {
      platform: adapter.platform, accountId, identityReference: identity.identityReference, identityVerified: false, authenticated: false,
      postingRights: { status: "UNKNOWN", targetId: null, reason: "account_binding_mismatch", evidence: null }, evidence,
      nextAction: "REVIEW_IDENTITY"
    });
  }
  const expectedStable = stableIdentityFromReference(adapter, expectedIdentity);
  const observedStable = identity.stableId?.toLowerCase() || null;
  const stableMatches = !observedStable || !expectedStable || observedStable === expectedStable;
  const sourceMatches = identity.source === adapter.rule.source || identity.source === adapter.rule.rightsSource;
  const proofReady = identity.authenticated && identity.ownerSurface && !identity.ambiguous && identity.candidateCount !== null ? identity.candidateCount === 1 : identity.authenticated && identity.ownerSurface && !identity.ambiguous;
  if (identity.identityReference !== expectedReference || !stableMatches || !sourceMatches || !proofReady) {
    return result("UNKNOWN", identity.identityReference !== expectedReference || !stableMatches ? "LOGIN_IDENTITY_MISMATCH" : "LOGIN_IDENTITY_PROOF_INSUFFICIENT", "authenticated surface did not provide an unambiguous exact owner identity match", {
      platform: adapter.platform, accountId, identityReference: identity.identityReference, identityVerified: false, authenticated: identity.authenticated === true,
      postingRights: { status: "UNKNOWN", targetId: null, reason: "identity_not_ready", evidence: null }, evidence,
      nextAction: "REVIEW_IDENTITY"
    });
  }
  return result("READY", "LOGIN_CONFIRMED", "Camoufox login and exact platform identity confirmed", {
    platform: adapter.platform, accountId, identityReference: expectedReference, identityVerified: true, authenticated: true,
    postingRights: { status: "NOT_CHECKED", targetId: null, reason: "target_not_supplied", evidence: null }, evidence,
    nextAction: "USE_AUTHENTICATED_SESSION"
  });
}

async function checkPostingRights(adapter, { protocol, pageId, target, identityReady } = {}) {
  const targetId = text(target?.id || target?.targetId, 160) || null;
  const rawUrl = text(target?.url || target?.targetUrl, 2_000);
  if (!target) return { status: "NOT_CHECKED", targetId: null, reason: "target_not_supplied", evidence: null };
  const targetUrl = adapter.rule.targetUrl(rawUrl);
  if (!targetUrl) return { status: "UNKNOWN", targetId, reason: "target_url_invalid", evidence: null };
  if (!identityReady) return { status: "UNKNOWN", targetId, reason: "login_not_ready", evidence: null };
  try {
    if (typeof protocol.navigate === "function") await protocol.navigate(pageId, targetUrl);
    if (typeof protocol.evaluate !== "function") return { status: "UNKNOWN", targetId, reason: "rights_probe_unavailable", evidence: null };
    const value = await protocol.evaluate(pageId, postingRightsExpressionFor(adapter.rule, targetUrl));
    const evidence = value && typeof value === "object" ? {
      targetMatched: value.targetMatched === true,
      source: text(value.source, 120) || null,
      canPost: value.canPost === true,
      authenticatedSurface: value.authenticatedSurface === true,
      membershipRequired: value.membershipRequired === true,
      rightsDeclared: value.rightsDeclared === true,
      membershipStatus: text(value.membershipStatus, 80) || null,
      postingStatus: text(value.postingStatus, 80) || null,
      composerVisible: value.composerVisible === true,
      submitControlVisible: value.submitControlVisible === true,
      submitControlEnabled: value.submitControlEnabled === true,
      rulesStatus: text(value.rulesStatus, 80).toLowerCase() || null,
      rulesEvidencePresent: value.rulesEvidencePresent === true || Boolean(text(value.rulesStatus, 80)),
      rulesEvidenceAccepted: value.rulesEvidenceAccepted === true || ["reviewed", "accepted", "acknowledged", "available", "visible"].includes(text(value.rulesStatus, 80).toLowerCase()),
      rulesEvidenceDenied: value.rulesEvidenceDenied === true || ["denied", "rejected", "blocked", "required", "pending"].includes(text(value.rulesStatus, 80).toLowerCase())
    } : null;
    if (!evidence || evidence.source !== adapter.rule.rightsSource || !evidence.targetMatched) {
      return { status: "UNKNOWN", targetId, reason: "target_rights_evidence_unavailable", evidence };
    }
    if (adapter.rule.requireRulesEvidence && !evidence.rulesEvidenceAccepted) {
      if (evidence.rulesEvidenceDenied || evidence.membershipRequired || evidence.postingStatus === "blocked") {
        return { status: "BLOCKED", targetId, reason: "target_membership_or_rules_required", evidence };
      }
      return { status: "UNKNOWN", targetId, reason: "target_rules_evidence_unavailable", evidence };
    }
    if (evidence.canPost && evidence.authenticatedSurface) return { status: "READY", targetId, reason: "target_posting_rights_confirmed", evidence };
    if (evidence.membershipRequired || evidence.postingStatus === "blocked" || (evidence.rightsDeclared && evidence.canPost === false)) {
      return { status: "BLOCKED", targetId, reason: evidence.membershipRequired ? "target_membership_or_rules_required" : "target_posting_restricted", evidence };
    }
    return { status: "UNKNOWN", targetId, reason: "target_posting_rights_ambiguous", evidence };
  } catch (error) {
    return { status: "UNKNOWN", targetId, reason: safeErrorCode(error, "TARGET_RIGHTS_PROBE_FAILED").toLowerCase(), evidence: null };
  }
}

async function verifyAdapterIdentity(adapter, input = {}) {
  const protocol = input.protocol;
  const pageId = text(input.pageId, 120) || "page-1";
  const accountId = accountOf(input.accountId);
  const expectedIdentity = text(input.expectedIdentity || input.expectedIdentityUrl || input.identityReference, 600);
  if (!protocol || typeof protocol.evaluate !== "function" && typeof protocol.observeIdentity !== "function") {
    return result("BLOCKED", "CAMOUFOX_PROTOCOL_INCOMPLETE", "Camoufox protocol lacks read-only identity observation", { platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false, postingRights: { status: "UNKNOWN", targetId: null, reason: "protocol_unavailable", evidence: null }, nextAction: "REPAIR_PROTOCOL" });
  }
  if (!accountId) return result("BLOCKED", "ACCOUNT_BINDING_REQUIRED", "platform and accountId are required", { platform: adapter.platform, accountId: null, identityReference: null, identityVerified: false, authenticated: false, postingRights: { status: "UNKNOWN", targetId: null, reason: "account_required", evidence: null }, nextAction: "CONFIGURE_ACCOUNT" });
  const observed = await observeIdentity({ adapter, protocol, pageId, accountId, expectedIdentity });
  return identityResult(adapter, { accountId, expectedIdentity, identity: observed.identity, loginEvidence: input.loginEvidence, error: observed.error });
}

async function loginAdapter(adapter, input = {}) {
  const protocol = input.protocol;
  const pageId = text(input.pageId, 120) || "page-1";
  const accountId = accountOf(input.accountId);
  const expectedIdentity = text(input.expectedIdentity || input.expectedIdentityUrl || input.identityReference, 600);
  if (!accountId) return result("BLOCKED", "ACCOUNT_BINDING_REQUIRED", "platform and accountId are required", { platform: adapter.platform, accountId: null, identityReference: null, identityVerified: false, authenticated: false, postingRights: { status: "UNKNOWN", targetId: null, reason: "account_required", evidence: null }, nextAction: "CONFIGURE_ACCOUNT" });
  if (!expectedIdentity || !adapter.rule.identityReference(expectedIdentity)) return result("UNKNOWN", "EXPECTED_IDENTITY_REQUIRED", "a valid exact platform identity URL is required", { platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false, postingRights: { status: "UNKNOWN", targetId: null, reason: "identity_required", evidence: null }, nextAction: "CONFIGURE_EXPECTED_IDENTITY" });
  if (!protocol || ["navigate", "snapshot", "resolve", "fill", "click"].some((method) => typeof protocol[method] !== "function") || (typeof protocol.evaluate !== "function" && typeof protocol.observeIdentity !== "function")) {
    return result("BLOCKED", "CAMOUFOX_PROTOCOL_INCOMPLETE", "Camoufox protocol lacks bounded login and identity capabilities", { platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false, postingRights: { status: "UNKNOWN", targetId: null, reason: "protocol_unavailable", evidence: null }, nextAction: "REPAIR_PROTOCOL" });
  }
  const credentials = input.credentials;
  const username = credentials && typeof credentials === "object" ? String(credentials.username || credentials.email || credentials.login || "") : "";
  const password = credentials && typeof credentials === "object" ? String(credentials.password || "") : "";
  if (!username || !password) return result("BLOCKED", "CREDENTIALS_REQUIRED", "caller-supplied in-memory credentials are required", { platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false, postingRights: { status: "UNKNOWN", targetId: null, reason: "credentials_required", evidence: null }, nextAction: "SUPPLY_CREDENTIALS" });
  let initialSnapshot = "";
  try {
    await protocol.navigate(pageId, adapter.loginUrl);
    const initialSnapshotValue = await protocol.snapshot(pageId);
    initialSnapshot = typeof initialSnapshotValue === "string" ? initialSnapshotValue : "";
    if (challengeMatch(initialSnapshot, adapter.rule)) return identityResult(adapter, { accountId, expectedIdentity, challengeDetected: true, loginEvidence: { controlsObserved: false } });
    const usernameRef = await protocol.resolve(pageId, adapter.usernameQuery);
    const passwordRef = await protocol.resolve(pageId, /password/i);
    const submitRef = await protocol.resolve(pageId, adapter.submitQuery);
    if (!usernameRef || !passwordRef || !submitRef) {
      if (/\b(?:sign\s*in|log\s*in|login|password|email)\b/i.test(initialSnapshot)) {
        return result("BLOCKED", "LOGIN_CONTROLS_NOT_FOUND", "bounded login controls were not observed", {
          platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false,
          postingRights: { status: "UNKNOWN", targetId: null, reason: "login_controls_unavailable", evidence: null },
          evidence: { loginUrl: adapter.loginUrl, challengeDetected: false, loginControlsObserved: false, identitySource: null, identityConfidence: 0, identityAmbiguous: false, candidateCount: null, authenticatedSurface: false, ownerSurface: false, stableIdentityId: null },
          nextAction: "REVIEW_LOGIN"
        });
      }
    }
    if (usernameRef && passwordRef && submitRef) {
      await protocol.fill(pageId, usernameRef, username);
      await protocol.fill(pageId, passwordRef, password);
      await protocol.click({ pageId, ref: submitRef });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const afterSnapshotValue = await protocol.snapshot(pageId);
      const afterSnapshot = typeof afterSnapshotValue === "string" ? afterSnapshotValue : "";
      if (challengeMatch(afterSnapshot, adapter.rule)) return identityResult(adapter, { accountId, expectedIdentity, challengeDetected: true, loginEvidence: { controlsObserved: true } });
    }
    const observed = await observeIdentity({ adapter, protocol, pageId, accountId, expectedIdentity });
    const checked = identityResult(adapter, { accountId, expectedIdentity, identity: observed.identity, loginEvidence: { controlsObserved: Boolean(usernameRef && passwordRef && submitRef) }, error: observed.error });
    if (checked.status === "READY") {
      checked.postingRights = await checkPostingRights(adapter, { protocol, pageId, target: input.target || (input.targetId || input.targetUrl ? { id: input.targetId, url: input.targetUrl } : null), identityReady: true });
      if (checked.postingRights.status === "READY") checked.nextAction = "USE_AUTHENTICATED_SESSION_WITH_TARGET_RIGHTS";
      else if (checked.postingRights.status === "BLOCKED") checked.nextAction = "DO_NOT_POST_TARGET";
    }
    return checked;
  } catch (error) {
    const challenge = challengeMatch(initialSnapshot, adapter.rule) || /challenge|captcha|mfa|security/i.test(text(error?.message, 400));
    return result(challenge ? "BLOCKED" : "UNKNOWN", challenge ? "ACCOUNT_SECURITY_CHALLENGE" : safeErrorCode(error), challenge ? "Camoufox login reached a security challenge requiring owner action" : safeErrorReason(error), {
      platform: adapter.platform, accountId, identityReference: null, identityVerified: false, authenticated: false,
      postingRights: { status: "UNKNOWN", targetId: null, reason: challenge ? "login_challenge" : "login_failed", evidence: null },
      evidence: { loginUrl: adapter.loginUrl, challengeDetected: challenge, loginControlsObserved: false, identitySource: null, identityConfidence: 0, identityAmbiguous: false, candidateCount: null, authenticatedSurface: false, ownerSurface: false, stableIdentityId: null },
      nextAction: challenge ? "HUMAN_REQUIRED" : "REVIEW_LOGIN"
    });
  } finally {
    // Drop references to credential values before returning. The caller owns
    // the original object and remains responsible for clearing it as well.
    // eslint-disable-next-line no-unused-vars
    void username; void password;
  }
}

function buildAdapter(platform, rule) {
  const adapter = {
    platform,
    loginUrl: rule.loginUrl,
    usernameQuery: rule.usernameQuery,
    submitQuery: rule.submitQuery,
    identityExpression: rule.identityExpression,
    postingRightsExpression: rule.postingRightsExpression,
    rule,
    async login(input) { return loginAdapter(adapter, input); },
    async verifyIdentity(input) { return verifyAdapterIdentity(adapter, input); },
    async checkPostingRights(input) { return checkPostingRights(adapter, input); }
  };
  return Object.freeze(adapter);
}

const ADAPTERS = Object.freeze(Object.fromEntries(Object.entries(LOGIN_RULES).map(([platform, rule]) => [platform, buildAdapter(platform, rule)])));

/** Immutable descriptor registry consumed by the existing Camoufox login path. */
export const CAMOUFOX_PLATFORM_LOGIN_ADAPTERS = ADAPTERS;
export const CAMOUFOX_LOGIN_ADAPTERS = ADAPTERS;

export function getCamoufoxPlatformLoginAdapter(platform) {
  return ADAPTERS[platformOf(platform)] || null;
}

export const getCamoufoxLoginAdapter = getCamoufoxPlatformLoginAdapter;

export function listCamoufoxPlatformLoginAdapters() {
  return [...SUPPORTED_PLATFORMS];
}

export async function loginAccountWithCamoufoxPlatform(input = {}) {
  const platform = platformOf(input.platform || input.channel);
  if (!platform) return result("BLOCKED", "PLATFORM_LOGIN_UNSUPPORTED", "no bounded Camoufox login adapter is registered for this platform", { platform: key(input.platform || input.channel) || null, accountId: accountOf(input.accountId), identityReference: null, identityVerified: false, authenticated: false, postingRights: { status: "UNKNOWN", targetId: null, reason: "platform_unsupported", evidence: null }, nextAction: "USE_SUPPORTED_PLATFORM" });
  return getCamoufoxPlatformLoginAdapter(platform).login(input);
}

export const camoufoxPlatformLoginRegistry = Object.freeze({
  resolve: getCamoufoxPlatformLoginAdapter,
  get: getCamoufoxPlatformLoginAdapter,
  list: listCamoufoxPlatformLoginAdapters,
  login: loginAccountWithCamoufoxPlatform
});

export const CAMOUFOX_PLATFORM_LOGIN_REGISTRY = camoufoxPlatformLoginRegistry;

/** Normalize and validate a platform identity without performing browser work. */
export function normalizeCamoufoxIdentityReference(platform, value) {
  const adapter = getCamoufoxPlatformLoginAdapter(platform);
  return adapter ? adapter.rule.identityReference(value) : null;
}

export { RESULT_STATES, RIGHTS_STATES, SUPPORTED_PLATFORMS };
