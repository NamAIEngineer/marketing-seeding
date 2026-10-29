import { readAccountCredentials } from "./account-credentials.mjs";

const LOGIN_URLS = Object.freeze({ linkedin: "https://www.linkedin.com/login" });
const CHALLENGE = /captcha|verify|security check|two-factor|mfa|challenge/i;
const AUTHENTICATED = /feed|sign out|log out/i;

function safeText(value, limit = 4000) { return String(value || "").replace(/[\r\n]+/g, " ").slice(0, limit); }

/**
 * Credential-backed Camoufox login. Secrets are fetched from Keychain inside
 * this call, sent only to the injected browser protocol, then released.
 * No credential value is returned or persisted.
 */
export async function loginAccountWithCamoufox({ platform, accountId, protocol, pageId, loginUrl = null, selectors = {}, expectedIdentity = null } = {}) {
  const channel = String(platform || "").trim().toLowerCase();
  if (!LOGIN_URLS[channel] && !loginUrl) return { status: "BLOCKED", code: "PLATFORM_LOGIN_UNSUPPORTED", reason: "no bounded Camoufox login flow is implemented for this platform" };
  if (!protocol || typeof protocol.navigate !== "function" || typeof protocol.snapshot !== "function" || typeof protocol.resolve !== "function" || typeof protocol.fill !== "function" || typeof protocol.click !== "function") return { status: "BLOCKED", code: "CAMOUFOX_PROTOCOL_INCOMPLETE", reason: "Camoufox protocol lacks login capabilities" };
  const credentials = await readAccountCredentials({ accountId, platform: channel });
  const target = loginUrl || LOGIN_URLS[channel];
  await protocol.navigate(pageId, target);
  let snapshot = safeText(await protocol.snapshot(pageId));
  if (CHALLENGE.test(snapshot)) return { status: "BLOCKED", code: "ACCOUNT_SECURITY_CHALLENGE", reason: "login requires a factor not available from supplied credentials" };
  const usernameRef = await protocol.resolve(pageId, selectors.username || /email|username|phone/i);
  const passwordRef = await protocol.resolve(pageId, selectors.password || /password/i);
  const submitRef = await protocol.resolve(pageId, selectors.submit || /sign in|log in|continue/i);
  if (!usernameRef || !passwordRef || !submitRef) return { status: "BLOCKED", code: "LOGIN_CONTROLS_NOT_FOUND", reason: "bounded login controls were not observed" };
  await protocol.fill(pageId, usernameRef, credentials.username);
  await protocol.fill(pageId, passwordRef, credentials.password);
  await protocol.click({ pageId, ref: submitRef });
  await new Promise((resolve) => setTimeout(resolve, 250));
  snapshot = safeText(await protocol.snapshot(pageId));
  if (CHALLENGE.test(snapshot)) return { status: "BLOCKED", code: "ACCOUNT_SECURITY_CHALLENGE", reason: "login reached a security factor unavailable from supplied credentials" };
  if (!AUTHENTICATED.test(snapshot)) return { status: "UNKNOWN", code: "LOGIN_NOT_CONFIRMED", reason: "post-submit authenticated surface was not observed" };
  // Generic words such as Home/Profile/Feed are insufficient proof. A
  // protocol identity observation must match the bound account exactly.
  if (typeof protocol.observeIdentity !== "function") return { status: "UNKNOWN", code: "LOGIN_IDENTITY_UNAVAILABLE", reason: "authenticated surface lacks exact account identity evidence" };
  const observed = await protocol.observeIdentity(pageId);
  const observedRef = String(observed?.identityReference || observed?.expectedIdentityReference || "").replace(/\/$/, "").toLowerCase();
  const expectedRef = String(expectedIdentity || "").replace(/\/$/, "").toLowerCase();
  if (!observedRef || observed?.ambiguous || (expectedRef && observedRef !== expectedRef)) return { status: "UNKNOWN", code: "LOGIN_IDENTITY_MISMATCH", reason: "authenticated surface identity did not exactly match the account binding" };
  return { status: "READY", code: "LOGIN_CONFIRMED", platform: channel, accountId: String(accountId), loginUrl: target, identityReference: observedRef };
}
