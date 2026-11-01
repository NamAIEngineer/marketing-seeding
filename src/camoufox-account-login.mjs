import { readAccountCredentials } from "./account-credentials.mjs";

const LOGIN_URLS = Object.freeze({ linkedin: "https://www.linkedin.com/login", facebook: "https://www.facebook.com/login/", facebook_group: "https://www.facebook.com/login/" });
const CHALLENGE = /captcha|verify|security check|two-factor|mfa|challenge/i;
const AUTHENTICATED = /feed|sign out|log out/i;

function safeText(value, limit = 4000) { return String(value || "").replace(/[\r\n]+/g, " ").slice(0, limit); }
function snapshotEvidence(value) {
  const raw = safeText(value, 1200);
  return { snapshot: raw || null, snapshotHash: raw ? cryptoHash(raw) : null };
}
function cryptoHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
async function dismissConsent(protocol, pageId, selectors = {}) {
  const ref = await protocol.resolve(pageId, selectors.consent || /accept|agree|allow|continue without|use essential|got it|not now|dismiss/i);
  if (!ref) return false;
  try { await protocol.click({ pageId, ref }); return true; } catch { return false; }
}

/**
 * Credential-backed Camoufox login. Secrets are fetched from Keychain inside
 * this call, sent only to the injected browser protocol, then released.
 * No credential value is returned or persisted.
 */
export async function loginAccountWithCamoufox({ platform, accountId, protocol, pageId, loginUrl = null, selectors = {}, expectedIdentity = null, credentials = null, readCredentials = null } = {}) {
  const channel = String(platform || "").trim().toLowerCase();
  if (!LOGIN_URLS[channel] && !loginUrl) return { status: "BLOCKED", code: "PLATFORM_LOGIN_UNSUPPORTED", reason: "no bounded Camoufox login flow is implemented for this platform" };
  if (!protocol || typeof protocol.navigate !== "function" || typeof protocol.snapshot !== "function" || typeof protocol.resolve !== "function" || typeof protocol.fill !== "function" || typeof protocol.click !== "function") return { status: "BLOCKED", code: "CAMOUFOX_PROTOCOL_INCOMPLETE", reason: "Camoufox protocol lacks login capabilities" };
  const credentialReader = typeof readCredentials === "function" ? readCredentials : readAccountCredentials;
  const suppliedCredentials = credentials && typeof credentials === "object"
    ? credentials
    : await credentialReader({ accountId, platform: channel });
  const username = String(suppliedCredentials?.username || suppliedCredentials?.email || suppliedCredentials?.login || "");
  const password = String(suppliedCredentials?.password || "");
  if (!username || !password) return { status: "BLOCKED", code: "CREDENTIALS_REQUIRED", reason: "caller-supplied in-memory credentials are required" };
  const target = loginUrl || LOGIN_URLS[channel];
  await protocol.navigate(pageId, target);
  let snapshot = safeText(await protocol.snapshot(pageId));
  const initialEvidence = snapshotEvidence(snapshot);
  if (CHALLENGE.test(snapshot)) return { status: "BLOCKED", code: "ACCOUNT_SECURITY_CHALLENGE", reason: "login requires a factor not available from supplied credentials" };
  // Consent/interstitial surfaces can hide the credential form in Camoufox.
  // Dismiss only a visible, labelled consent control; never bypass a challenge.
  if (await dismissConsent(protocol, pageId, selectors)) snapshot = safeText(await protocol.snapshot(pageId));
  const usernameRef = await protocol.resolve(pageId, selectors.username || /email|username|phone/i);
  const passwordRef = await protocol.resolve(pageId, selectors.password || /password/i);
  const submitRef = await protocol.resolve(pageId, selectors.submit || /sign in|log in|continue/i);
  if (!usernameRef || !passwordRef || !submitRef) return { status: "BLOCKED", code: "LOGIN_CONTROLS_NOT_FOUND", reason: "bounded login controls were not observed", evidence: { loginUrl: target, ...initialEvidence, postConsentSnapshot: snapshotEvidence(snapshot) } };
  await protocol.fill(pageId, usernameRef, username);
  await protocol.fill(pageId, passwordRef, password);
  await protocol.click({ pageId, ref: submitRef });
  await new Promise((resolve) => setTimeout(resolve, 250));
  snapshot = safeText(await protocol.snapshot(pageId));
  if (CHALLENGE.test(snapshot)) return { status: "BLOCKED", code: "ACCOUNT_SECURITY_CHALLENGE", reason: "login reached a security factor unavailable from supplied credentials" };
  if (!AUTHENTICATED.test(snapshot)) return { status: "UNKNOWN", code: "LOGIN_NOT_CONFIRMED", reason: "post-submit authenticated surface was not observed", evidence: { loginUrl: target, ...snapshotEvidence(snapshot) } };
  // Generic words such as Home/Profile/Feed are insufficient proof. A
  // protocol identity observation must match the bound account exactly.
  if (typeof protocol.observeIdentity !== "function") return { status: "UNKNOWN", code: "LOGIN_IDENTITY_UNAVAILABLE", reason: "authenticated surface lacks exact account identity evidence" };
  const observed = await protocol.observeIdentity(pageId);
  const observedState = String(observed?.state || observed?.status || "").trim().toUpperCase();
  if (observedState && observedState !== "READY") {
    if (["CHALLENGED", "CHALLENGE", "MFA", "SECURITY_CHALLENGE"].includes(observedState)) return { status: "BLOCKED", code: "ACCOUNT_SECURITY_CHALLENGE", reason: "authenticated surface is waiting for a security factor" };
    return { status: "UNKNOWN", code: "LOGIN_SESSION_NOT_READY", reason: "browser identity evidence did not prove an authenticated ready session" };
  }
  const observedPlatform = String(observed?.platform || "").trim().toLowerCase();
  const observedAccountId = String(observed?.accountId || "").trim();
  if ((observedPlatform && observedPlatform !== channel) || (observedAccountId && observedAccountId !== String(accountId))) {
    return { status: "UNKNOWN", code: "LOGIN_ACCOUNT_BINDING_MISMATCH", reason: "authenticated surface account binding did not match the requested account" };
  }
  const observedRef = String(observed?.identityReference || observed?.expectedIdentityReference || "").replace(/\/$/, "").toLowerCase();
  const expectedRef = String(expectedIdentity || "").replace(/\/$/, "").toLowerCase();
  if (!observedRef || observed?.ambiguous || (expectedRef && observedRef !== expectedRef)) return { status: "UNKNOWN", code: expectedRef ? "LOGIN_IDENTITY_MISMATCH" : "LOGIN_IDENTITY_UNAVAILABLE", reason: expectedRef ? "authenticated surface identity did not exactly match the account binding" : "authenticated surface identity could not be derived" };
  return { status: "READY", code: "LOGIN_CONFIRMED", platform: channel, accountId: String(accountId), loginUrl: target, identityReference: observedRef };
}
