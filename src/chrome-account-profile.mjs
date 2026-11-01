import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";

/**
 * Chromium account runtime boundary.
 *
 * Account profiles are deliberately separate from public observation.  The
 * only profile root accepted by this module is the app-owned macOS directory;
 * callers cannot point it at a personal Chrome profile or import cookies.
 */

export const CHROME_ACCOUNT_PROFILE_ROOT_SEGMENTS = Object.freeze([
  "Library",
  "Application Support",
  "Marketing Seeding OS",
  "chrome-profiles"
]);

export const CHROME_LOGIN_URLS = Object.freeze({
  linkedin: "https://www.linkedin.com/login",
  facebook: "https://www.facebook.com/login/"
});

export const CHROME_IDENTITY_PROBE_URLS = Object.freeze({
  linkedin: "https://www.linkedin.com/in/me/",
  facebook: "https://www.facebook.com/me"
});

const SAFE_PLATFORM = /^(?:linkedin|facebook)$/;
const SAFE_ACCOUNT_ID = /^[A-Za-z0-9._:@+-]{1,160}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:@/-]{1,240}$/;
const LOGIN_OR_CHALLENGE = /(?:^|\/)login(?:\/|$)|checkpoint|challenge|captcha|consent|authorize|security[-_ ]check/i;
const MAX_TEXT = 400;

function text(value, limit = MAX_TEXT) {
  return String(value ?? "").replace(/[\u0000\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function requiredSafe(value, label, pattern = SAFE_REFERENCE) {
  const normalized = text(value, 240);
  if (!normalized || !pattern.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function normalizedPlatform(value) {
  const platform = text(value, 40).toLowerCase();
  if (!SAFE_PLATFORM.test(platform)) throw Object.assign(new Error("Chrome account platform must be linkedin or facebook"), { code: "CHROME_PLATFORM_UNSUPPORTED" });
  return platform;
}

function normalizedAccountId(value) {
  return requiredSafe(value, "Chrome accountId", SAFE_ACCOUNT_ID);
}

/** Exact app-owned profile root. */
export function chromeAccountProfileRoot({ homeDir = os.homedir() } = {}) {
  const home = path.resolve(String(homeDir || os.homedir()));
  return path.join(home, ...CHROME_ACCOUNT_PROFILE_ROOT_SEGMENTS);
}

/**
 * Resolve one account profile without accepting arbitrary path material.
 * `facebook_group` is intentionally collapsed to `facebook` so there is one
 * persistent profile per platform/account, as required by the account seam.
 */
export function chromeAccountProfilePath(platform, accountId, { homeDir, profileRoot } = {}) {
  const normalized = normalizedPlatform(platform);
  const account = normalizedAccountId(accountId);
  const root = path.resolve(String(profileRoot || chromeAccountProfileRoot({ homeDir })));
  const profilePath = path.resolve(root, `${normalized}-${account}`);
  const relative = path.relative(root, profilePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Object.assign(new Error("Chrome account profile escaped app-owned root"), { code: "CHROME_PROFILE_ROOT_VIOLATION" });
  }
  return profilePath;
}

export function chromeAccountSource(accountId) {
  return `chrome-account:${normalizedAccountId(accountId)}`;
}

export function chromeEvidenceHash(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function hostOf(url) {
  return String(url.hostname || "").toLowerCase().replace(/^www\./, "");
}

function canonicalPath(url) {
  return String(url.pathname || "/").replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
}

function challengeResult(platform, observedUrl, code, reason, extra = {}) {
  const evidence = { platform, observedUrl: text(observedUrl, 500), code, ...extra };
  return {
    status: code === "CHROME_LOGIN_CHALLENGE" ? "BLOCKED" : "UNKNOWN",
    code,
    reason,
    platform,
    identityReference: null,
    stableId: null,
    observedUrl: text(observedUrl, 500) || null,
    source: null,
    evidenceHash: chromeEvidenceHash(evidence)
  };
}

/**
 * Verify the only identity redirects accepted by the account runtime.
 * A login, checkpoint, consent or ambiguous surface never becomes READY.
 */
export function verifyChromeIdentity({ platform, url, title = "", bodyText = "", candidateCount = 1 } = {}) {
  const normalized = normalizedPlatform(platform);
  const observedUrl = text(url, 500);
  let parsed;
  try { parsed = new URL(observedUrl); } catch { return challengeResult(normalized, observedUrl, "CHROME_IDENTITY_URL_INVALID", "Identity redirect URL is invalid"); }
  if (parsed.protocol !== "https:") return challengeResult(normalized, observedUrl, "CHROME_IDENTITY_URL_INVALID", "Identity redirect must use HTTPS");
  if (LOGIN_OR_CHALLENGE.test(`${parsed.hostname}${parsed.pathname}`)) {
    return challengeResult(normalized, observedUrl, "CHROME_LOGIN_CHALLENGE", "Login, checkpoint, consent, or security challenge remains visible");
  }
  if (Number(candidateCount) !== 1) return challengeResult(normalized, observedUrl, "CHROME_IDENTITY_AMBIGUOUS", "Identity surface has zero or multiple candidates", { candidateCount: Number(candidateCount) || 0 });

  const host = hostOf(parsed);
  const pathname = canonicalPath(parsed);
  let identityReference = null;
  let stableId = null;
  if (normalized === "linkedin") {
    if (host !== "linkedin.com") return challengeResult(normalized, observedUrl, "CHROME_IDENTITY_DOMAIN_MISMATCH", "Identity redirect is outside linkedin.com");
    const match = pathname.match(/^\/in\/([a-z0-9][a-z0-9._%-]{1,199})$/i);
    if (!match || match[1].toLowerCase() === "me") {
      return challengeResult(normalized, observedUrl, "CHROME_IDENTITY_REDIRECT_UNVERIFIED", "linkedin.com/in/me did not redirect to a canonical /in/<slug>/ profile");
    }
    stableId = match[1].toLowerCase();
    identityReference = `https://www.linkedin.com/in/${stableId}`;
  } else {
    if (host !== "facebook.com") return challengeResult(normalized, observedUrl, "CHROME_IDENTITY_DOMAIN_MISMATCH", "Identity redirect is outside facebook.com");
    if (pathname.toLowerCase() === "/profile.php") {
      const id = parsed.searchParams.get("id") || "";
      if (!/^\d{3,80}$/.test(id)) return challengeResult(normalized, observedUrl, "CHROME_IDENTITY_REDIRECT_UNVERIFIED", "Facebook /profile.php redirect lacks a numeric id");
      stableId = id;
      identityReference = `https://www.facebook.com/profile.php?id=${id}`;
    } else {
      const match = pathname.match(/^\/([a-z0-9][a-z0-9._-]{2,99})$/i);
      const reserved = new Set(["home", "groups", "pages", "watch", "marketplace", "login", "settings", "friends", "notifications", "messages", "share", "search", "photo", "reel", "events", "gaming", "me"]);
      if (!match || reserved.has(match[1].toLowerCase())) {
        return challengeResult(normalized, observedUrl, "CHROME_IDENTITY_REDIRECT_UNVERIFIED", "facebook.com/me did not redirect to /profile.php?id=... or /username");
      }
      stableId = match[1].toLowerCase();
      identityReference = `https://www.facebook.com/${stableId}`;
    }
  }
  // Login/challenge text is only considered when the redirect itself is not a
  // canonical profile. Profile posts can legitimately mention these words.
  void title;
  void bodyText;
  const evidence = { platform: normalized, observedUrl: parsed.toString(), identityReference, stableId, candidateCount: 1 };
  return {
    status: "READY",
    code: "CHROME_IDENTITY_VERIFIED",
    reason: "Direct platform identity redirect verified",
    platform: normalized,
    identityReference,
    stableId,
    observedUrl: parsed.toString(),
    source: null,
    evidenceHash: chromeEvidenceHash(evidence)
  };
}

function defaultChromeExecutablePath() {
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  return "/usr/bin/google-chrome";
}

async function loadPlaywright(playwright) {
  if (playwright?.chromium) return playwright;
  try { return await import("playwright-core"); }
  catch (error) { throw Object.assign(new Error("Playwright Chromium is unavailable"), { code: "CHROME_PLAYWRIGHT_UNAVAILABLE", cause: error }); }
}

async function pageBodyText(page) {
  try {
    if (typeof page.locator === "function") return await page.locator("body").innerText({ timeout: 1_000 });
    if (typeof page.evaluate === "function") return await page.evaluate(() => document.body?.innerText || "");
  } catch {}
  return "";
}

function pageUrl(page) {
  try { return typeof page.url === "function" ? page.url() : String(page.url || ""); } catch { return ""; }
}

/** Visible persistent profile manager. No credentials or storage-state APIs. */
export class ChromeAccountProfileManager {
  #playwright;
  #executablePath;
  #homeDir;
  #profileRoot;
  #ttlMs;
  #sessions = new Map();
  constructor({ playwright = null, executablePath = process.env.SEEDING_CHROME_EXECUTABLE_PATH || defaultChromeExecutablePath(), homeDir = os.homedir(), profileRoot = null, ttlMs = 15 * 60_000 } = {}) {
    this.#playwright = playwright;
    this.#executablePath = text(executablePath, 500) || defaultChromeExecutablePath();
    this.#homeDir = homeDir;
    this.#profileRoot = profileRoot;
    this.#ttlMs = Math.max(60_000, Number(ttlMs) || 15 * 60_000);
  }
  profilePath(platform, accountId) { return chromeAccountProfilePath(platform, accountId, { homeDir: this.#homeDir, profileRoot: this.#profileRoot }); }
  source(accountId) { return chromeAccountSource(accountId); }
  identityProbeUrl(platform) { return CHROME_IDENTITY_PROBE_URLS[normalizedPlatform(platform)]; }
  async #context() {
    const pw = await loadPlaywright(this.#playwright);
    if (!pw?.chromium || typeof pw.chromium.launchPersistentContext !== "function") {
      throw Object.assign(new Error("Playwright Chromium launchPersistentContext is unavailable"), { code: "CHROME_PLAYWRIGHT_UNAVAILABLE" });
    }
    return pw.chromium;
  }
  async start({ platform, accountId, profilePath = null } = {}) {
    const normalized = normalizedPlatform(platform);
    const account = normalizedAccountId(accountId);
    const existing = [...this.#sessions.values()].find((session) => session.platform === normalized && session.accountId === account);
    if (existing) await this.close(existing.sessionId);
    const resolvedProfilePath = profilePath || this.profilePath(normalized, account);
    const root = path.resolve(String(this.#profileRoot || chromeAccountProfileRoot({ homeDir: this.#homeDir })));
    const relative = path.relative(root, path.resolve(resolvedProfilePath));
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Object.assign(new Error("Chrome profile must remain under the app-owned root"), { code: "CHROME_PROFILE_ROOT_VIOLATION" });
    await mkdir(resolvedProfilePath, { recursive: true });
    const chromium = await this.#context();
    // `headless: false` is intentional: Nam must be able to complete SSO,
    // MFA, CAPTCHA, or checkpoint prompts in this dedicated app profile.
    const context = await chromium.launchPersistentContext(resolvedProfilePath, {
      headless: false,
      executablePath: this.#executablePath,
      viewport: null,
      locale: "en-US",
      ...((this.#executablePath && process.platform === "darwin") ? { args: ["--new-window"] } : {})
    });
    const pages = typeof context.pages === "function" ? context.pages() : [];
    const page = pages[0] || await context.newPage();
    const loginUrl = CHROME_LOGIN_URLS[normalized];
    if (typeof page.goto === "function") await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    const sessionId = `${normalized}:${account}:${Date.now()}`;
    const startedAt = new Date().toISOString();
    this.#sessions.set(sessionId, { sessionId, platform: normalized, accountId: account, profilePath: resolvedProfilePath, context, page, loginUrl, startedAt, expiresAt: new Date(Date.now() + this.#ttlMs).toISOString(), status: "WAITING_FOR_USER", identityReference: null, evidenceHash: null });
    return this.status(sessionId);
  }
  async poll(sessionId, { navigateToIdentityProbe = true } = {}) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "CHROME_LOGIN_SESSION_NOT_FOUND" };
    if (Date.now() > Date.parse(session.expiresAt)) { await this.close(sessionId); return { status: "BLOCKED", code: "CHROME_LOGIN_SESSION_EXPIRED", reason: "Chrome login window expired" }; }
    const current = pageUrl(session.page);
    if (navigateToIdentityProbe && (!current || LOGIN_OR_CHALLENGE.test(current) || current === session.loginUrl)) {
      try { if (typeof session.page.goto === "function") await session.page.goto(CHROME_IDENTITY_PROBE_URLS[session.platform], { waitUntil: "domcontentloaded" }); }
      catch (error) { return { ...this.status(sessionId), status: "UNKNOWN", code: String(error?.code || "CHROME_IDENTITY_PROBE_FAILED").slice(0, 100) }; }
    }
    const observedUrl = pageUrl(session.page);
    const result = verifyChromeIdentity({ platform: session.platform, url: observedUrl, title: typeof session.page.title === "function" ? await session.page.title().catch(() => "") : "", bodyText: await pageBodyText(session.page), candidateCount: 1 });
    if (result.status === "READY") {
      session.status = "READY";
      session.identityReference = result.identityReference;
      session.evidenceHash = result.evidenceHash;
      session.observedUrl = result.observedUrl;
      session.identityEvidence = result;
    } else if (result.code === "CHROME_LOGIN_CHALLENGE") session.status = "WAITING_FOR_USER";
    else session.status = "WAITING_FOR_USER";
    return this.status(sessionId);
  }
  status(sessionId) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "CHROME_LOGIN_SESSION_NOT_FOUND" };
    return {
      sessionId: session.sessionId,
      platform: session.platform,
      accountId: session.accountId,
      status: session.status,
      code: session.status === "READY" ? "LOGIN_CONFIRMED" : "WAITING_FOR_USER",
      reason: session.status === "READY" ? "Direct platform identity redirect verified" : "Complete login in the visible Chrome window; identity remains unverified",
      loginUrl: session.loginUrl,
      identityProbeUrl: CHROME_IDENTITY_PROBE_URLS[session.platform],
      profilePath: session.profilePath,
      source: chromeAccountSource(session.accountId),
      identityReference: session.identityReference,
      evidenceHash: session.evidenceHash,
      observedUrl: session.observedUrl || null,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt
    };
  }
  async retryLogin({ platform, accountId, credentialReference = null } = {}) {
    const normalized = normalizedPlatform(platform);
    const account = normalizedAccountId(accountId);
    const reference = credentialReference == null ? null : requiredSafe(credentialReference, "credentialReference");
    // Deliberately no Keychain read and no live retry in this bounded task.
    return { status: "UNKNOWN", code: "CHROME_RETRY_NOT_EXECUTED", reason: "Retry is staged for a human-approved live run", platform: normalized, accountId: account, credentialReference: reference };
  }
  async close(sessionId) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "CHROME_LOGIN_SESSION_NOT_FOUND" };
    this.#sessions.delete(String(sessionId));
    try { await session.context?.close?.(); } catch {}
    return { sessionId: String(sessionId), status: "CLOSED" };
  }
  async closeAll() { for (const sessionId of [...this.#sessions.keys()]) await this.close(sessionId); }
}

export default ChromeAccountProfileManager;
