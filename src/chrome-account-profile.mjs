import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readlink } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { readAccountCredentials } from "./account-credentials.mjs";

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
const CHALLENGE_TEXT = /(?:captcha|recaptcha|two[- ]factor|2fa|verification code|security code|confirm it(?:'|’)s you|unusual activity|checkpoint|security check|verify your identity|xác minh|mã xác minh)/i;
const LOGIN_FAILURE_TEXT = /(?:incorrect password|wrong password|invalid password|couldn['’]t log in|could not log in|unexpected error|try again|sai mật khẩu|không thể đăng nhập)/i;
const AUTH_SURFACE_TEXT = /(?:sign\s*in|log\s*in|create\s+account|choose\s+an?\s+account|checkpoint|captcha|security\s+check|consent(?:\s+required)?)/i;
const MAX_TEXT = 400;

export const EVIDENCE_SOURCES = Object.freeze(["camoufox-public", "chrome-account:<id>", "github-api"]);
const CHROME_SOURCE_PATTERN = /^chrome-account:[A-Za-z0-9._:@+-]{1,160}$/;

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

export function normalizeEvidenceSource(value, { provider = null, accountId = null } = {}) {
  const requested = text(value, 240);
  const normalizedProvider = text(provider, 80).toLowerCase();
  const fallback = normalizedProvider === "chrome" && accountId
    ? chromeAccountSource(accountId)
    : normalizedProvider === "camoufox"
      ? "camoufox-public"
      : normalizedProvider === "github-api"
        ? "github-api"
        : null;
  const source = requested || fallback;
  if (!source) return null;
  if (source === "camoufox-public" || source === "github-api" || CHROME_SOURCE_PATTERN.test(source)) return source;
  throw Object.assign(new Error("Evidence source must be camoufox-public, chrome-account:<id>, or github-api"), { code: "EVIDENCE_SOURCE_INVALID" });
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
  // A canonical-looking URL can still render a login wall or challenge. Keep
  // the first bounded text only; never promote that surface to READY.
  if (AUTH_SURFACE_TEXT.test(text(title, 240)) || AUTH_SURFACE_TEXT.test(text(bodyText, 400))) {
    return challengeResult(normalized, observedUrl, "CHROME_LOGIN_CHALLENGE", "Login, checkpoint, consent, or security challenge remains visible");
  }
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

export function defaultChromeExecutablePath() {
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

async function defaultChromeProcessInspector(profilePath) {
  const lock = path.join(profilePath, "SingletonLock");
  let target;
  try { target = await readlink(lock); } catch { return { live: false, code: "CHROME_PROFILE_NOT_RUNNING" }; }
  const match = String(target).match(/-(\d+)$/);
  if (!match) return { live: false, code: "CHROME_PROFILE_PID_UNRESOLVED" };
  const pid = Number(match[1]);
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]); 
    const command = String(stdout || "").trim();
    const exact = command.includes(`--user-data-dir=${profilePath}`) && /Google Chrome(?:\.app)?\/Contents\/MacOS\/Google Chrome|google-chrome/i.test(command);
    return { live: exact, pid, command, code: exact ? "CHROME_PROFILE_RUNNING" : "CHROME_PROFILE_PID_MISMATCH" };
  } catch { return { live: false, pid, code: "CHROME_PROFILE_PROCESS_GONE" }; }
}

async function defaultChromeProbeLauncher({ executablePath, profilePath, url }) {
  const child = spawn(executablePath, [`--user-data-dir=${profilePath}`, "--new-window", url], { detached: true, stdio: "ignore" });
  child.unref();
}

async function defaultChromeHistoryReader(profilePath) {
  const history = path.join(profilePath, "Default", "History");
  const query = "SELECT url,title,last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 40;";
  const parse = (stdout) => String(stdout || "").trim().split("\\n").filter(Boolean).map((line) => { const [url, title, stamp] = line.split("\\t"); return { url, title, lastVisitTime: Number(stamp) || 0 }; });
  try {
    const { stdout } = await execFileAsync("sqlite3", ["-readonly", history, "-separator", "\\t", query], { timeout: 5_000, maxBuffer: 256 * 1024 });
    return parse(stdout);
  } catch {
    // Chrome holds a write lock on its live History DB. Immutable read-only
    // mode reads the last committed navigation without modifying the profile.
    try {
      const { stdout } = await execFileAsync("sqlite3", ["-readonly", `file:${history}?immutable=1`, "-separator", "\\t", query], { timeout: 5_000, maxBuffer: 256 * 1024 });
      return parse(stdout);
    } catch { return []; }
  }
}

function chromeTimeMicros(value) { return Math.floor(Number(value) || 0); }

/** Visible persistent profile manager. No credentials or storage-state APIs. */
export class ChromeAccountProfileManager {
  #playwright;
  #executablePath;
  #homeDir;
  #profileRoot;
  #ttlMs;
  #sessions = new Map();
  #retryAttempts = new Map();
  #processInspector;
  #historyReader;
  #probeLauncher;
  #sleepFn;
  constructor({ playwright = null, executablePath = process.env.SEEDING_CHROME_EXECUTABLE_PATH || defaultChromeExecutablePath(), homeDir = os.homedir(), profileRoot = null, ttlMs = 15 * 60_000, processInspector = null, historyReader = null, probeLauncher = null, sleepFn = null } = {}) {
    this.#playwright = playwright;
    this.#executablePath = text(executablePath, 500) || defaultChromeExecutablePath();
    this.#homeDir = homeDir;
    this.#profileRoot = profileRoot;
    this.#ttlMs = Math.max(60_000, Number(ttlMs) || 15 * 60_000);
    this.#processInspector = processInspector || defaultChromeProcessInspector;
    this.#historyReader = historyReader || defaultChromeHistoryReader;
    this.#probeLauncher = probeLauncher || defaultChromeProbeLauncher;
    this.#sleepFn = sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
  /**
   * Re-verify a browser session already owned by this manager. This path never
   * reads Keychain credentials, fills login controls, or starts a new login.
   * A missing/expired in-memory session fails closed so callers cannot promote
   * a profile based on stale state.
   */
  async verifySession(sessionId, options = {}) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "CHROME_LOGIN_SESSION_NOT_FOUND", reason: "Chrome session is not attached to this runtime" };
    return this.poll(sessionId, { navigateToIdentityProbe: options.navigateToIdentityProbe !== false });
  }

  /**
   * Verify an app-owned profile without credential submission. If an attached
   * session exists, reuse it. Otherwise return a bounded busy/not-found result;
   * attaching to an arbitrary Chrome process is intentionally unsupported unless
   * the process was created by this manager.
   */
  async verifyExistingProfile({ platform, accountId, sessionId = null } = {}) {
    const normalized = normalizedPlatform(platform);
    const account = normalizedAccountId(accountId);
    const attached = sessionId
      ? this.#sessions.get(String(sessionId))
      : [...this.#sessions.values()].find((item) => item.platform === normalized && item.accountId === account);
    if (!attached) {
      const profilePath = this.profilePath(normalized, account);
      const process = await this.#processInspector(profilePath);
      if (!process?.live) return { status: "UNKNOWN", code: process?.code || "CHROME_PROFILE_NOT_RUNNING", reason: "App-owned Chrome profile has no verified live process; no login or credential action was attempted", platform: normalized, accountId: account, profilePath, source: chromeAccountSource(account) };
      const probeStartedAt = Date.now();
      try { await this.#probeLauncher({ executablePath: this.#executablePath, profilePath, url: CHROME_IDENTITY_PROBE_URLS[normalized] }); } catch (error) { return { status: "UNKNOWN", code: "CHROME_IDENTITY_PROBE_FAILED", reason: String(error?.message || "Could not navigate existing Chrome profile").slice(0, 240), platform: normalized, accountId: account, profilePath, source: chromeAccountSource(account) }; }
      const minChromeTime = chromeTimeMicros((probeStartedAt + 1_000) * 1000) + 11_644_473_600_000_000;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const rows = await this.#historyReader(profilePath);
        const candidates = rows.filter((item) => chromeTimeMicros(item.lastVisitTime) >= minChromeTime && /linkedin\.com\/in\/|facebook\.com\/(?:profile\.php|[A-Za-z0-9])/i.test(String(item.url || "")));
        // `/me` is the probe input, not an identity. Try all fresh rows so a
        // same-timestamp probe row cannot mask the canonical profile redirect.
        for (const row of candidates) {
          const result = verifyChromeIdentity({ platform: normalized, url: row.url, title: row.title || "", bodyText: "", candidateCount: 1 });
          if (result.status === "READY") return { ...result, platform: normalized, accountId: account, source: chromeAccountSource(account), profilePath, pid: process.pid, evidenceHash: chromeEvidenceHash({ ...result, profilePath, pid: process.pid, probeStartedAt, historyLastVisitTime: row.lastVisitTime }) };
        }
        await this.#sleepFn(500);
      }
      return { status: "UNKNOWN", code: "CHROME_IDENTITY_HISTORY_NOT_FRESH", reason: "Existing Chrome profile did not produce a fresh canonical identity redirect", platform: normalized, accountId: account, profilePath, pid: process.pid, source: chromeAccountSource(account) };
    }
    if (attached.platform !== normalized || attached.accountId !== account) {
      return { status: "UNKNOWN", code: "CHROME_PROFILE_BINDING_MISMATCH", reason: "Attached Chrome session does not match requested account", platform: normalized, accountId: account };
    }
    return this.verifySession(attached.sessionId, { navigateToIdentityProbe: true });
  }

  async poll(sessionId, { navigateToIdentityProbe = true } = {}) {
    const session = this.#sessions.get(String(sessionId));
    if (!session) return { status: "UNKNOWN", code: "CHROME_LOGIN_SESSION_NOT_FOUND" };
    if (Date.now() > Date.parse(session.expiresAt)) { await this.close(sessionId); return { status: "BLOCKED", code: "CHROME_LOGIN_SESSION_EXPIRED", reason: "Chrome login window expired" }; }
    const current = pageUrl(session.page);
    // Only leave the initial login URL automatically. Account chooser, SSO,
    // CAPTCHA, checkpoint, and consent URLs are operator-owned surfaces;
    // navigating away would destroy the recovery flow and cause false
    // CONTROLS_NOT_FOUND results.
    const initialLoginSurface = !current || current === session.loginUrl || current.replace(/\/$/, "") === session.loginUrl.replace(/\/$/, "");
    if (navigateToIdentityProbe && initialLoginSurface) {
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
      code: session.resultCode || (session.status === "READY" ? "LOGIN_CONFIRMED" : "WAITING_FOR_USER"),
      reason: session.resultReason || (session.status === "READY" ? "Direct platform identity redirect verified" : "Complete login in the visible Chrome window; identity remains unverified"),
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
  async retryLogin({ platform, accountId, credentialPlatform = null, credentialReference = null } = {}) {
    const normalized = normalizedPlatform(platform);
    const account = normalizedAccountId(accountId);
    const credentialKeyPlatform = text(credentialPlatform || platform, 40).toLowerCase();
    const reference = credentialReference == null ? null : requiredSafe(credentialReference, "credentialReference");
    const key = `${normalized}:${account}`;
    if ((this.#retryAttempts.get(key) || 0) >= 1) {
      const existing = [...this.#sessions.values()].find((item) => item.platform === normalized && item.accountId === account);
      return existing ? { ...this.status(existing.sessionId), status: existing.status === "READY" ? "READY" : "BLOCKED", code: "CHROME_RETRY_LIMIT_REACHED", reason: "Tài khoản đã được thử tự đăng nhập một lần; không thử lại tự động" } : { status: "BLOCKED", code: "CHROME_RETRY_LIMIT_REACHED", reason: "Tài khoản đã được thử tự đăng nhập một lần; không thử lại tự động", platform: normalized, accountId: account };
    }
    this.#retryAttempts.set(key, 1);
    let credentials;
    try { credentials = await readAccountCredentials({ platform: credentialKeyPlatform, accountId: account }); }
    catch (error) { return { status: "BLOCKED", code: String(error?.code || "KEYCHAIN_CREDENTIAL_UNAVAILABLE"), reason: "Không đọc được credential từ macOS Keychain; không thử lại tự động", platform: normalized, accountId: account, credentialReference: reference }; }
    let started;
    try { started = await this.start({ platform: normalized, accountId: account }); }
    catch (error) { credentials = null; return { status: "BLOCKED", code: String(error?.code || "CHROME_LOGIN_LAUNCH_FAILED"), reason: String(error?.message || "Không mở được Chrome profile").replace(/\s+/g, " ").slice(0, 240), platform: normalized, accountId: account }; }
    const session = this.#sessions.get(started.sessionId);
    const page = session?.page;
    if (!session || !page) { credentials = null; return { status: "BLOCKED", code: "CHROME_LOGIN_PAGE_UNAVAILABLE", reason: "Chrome profile không có trang đăng nhập", platform: normalized, accountId: account }; }
    const initialUrl = pageUrl(page);
    if (initialUrl && !LOGIN_OR_CHALLENGE.test(initialUrl)) {
      try { await page.goto(CHROME_IDENTITY_PROBE_URLS[normalized], { waitUntil: "domcontentloaded" }); }
      catch {}
      const existingIdentity = verifyChromeIdentity({ platform: normalized, url: pageUrl(page), title: typeof page.title === "function" ? await page.title().catch(() => "") : "", bodyText: await pageBodyText(page), candidateCount: 1 });
      if (existingIdentity.status === "READY") {
        credentials = null; session.status = "READY"; session.resultCode = existingIdentity.code; session.resultReason = existingIdentity.reason; session.identityReference = existingIdentity.identityReference; session.evidenceHash = existingIdentity.evidenceHash; session.observedUrl = existingIdentity.observedUrl; session.identityEvidence = existingIdentity; return this.status(started.sessionId);
      }
    }
    const selectors = normalized === "linkedin"
      ? { username: ['input[name="session_key"]', '#username', 'input[autocomplete="username"]'], password: ['input[name="session_password"]', '#password', 'input[autocomplete="current-password"]'], submit: ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Sign in")'] }
      : { username: ['input[name="email"]', 'input[autocomplete="username"]', '#email'], password: ['input[name="pass"]', 'input[autocomplete="current-password"]', '#pass'], submit: ['button[name="login"]', 'button[type="submit"]', 'input[type="submit"]'] };
    const findVisible = async (candidates) => {
      for (const selector of candidates) {
        try { const locator = page.locator(selector).first(); if (await locator.count() && await locator.isVisible()) return locator; } catch {}
      }
      return null;
    };
    const usernameField = await findVisible(selectors.username);
    const passwordField = await findVisible(selectors.password);
    if (!usernameField || !passwordField) {
      const body = await pageBodyText(page); const challenge = CHALLENGE_TEXT.test(body) || LOGIN_OR_CHALLENGE.test(pageUrl(page));
      session.status = "BLOCKED"; session.resultCode = challenge ? "CHROME_LOGIN_CHALLENGE" : "CHROME_LOGIN_CONTROLS_NOT_FOUND"; session.resultReason = challenge ? "Nền tảng yêu cầu CAPTCHA/2FA/checkpoint; cửa sổ Chrome được giữ mở" : "Không tìm thấy đủ ô đăng nhập trong Chrome profile";
      credentials = null; return this.status(started.sessionId);
    }
    try {
      await usernameField.fill(credentials.username); await passwordField.fill(credentials.password);
      const submit = await findVisible(selectors.submit); if (!submit) throw Object.assign(new Error("Không tìm thấy nút đăng nhập"), { code: "CHROME_LOGIN_CONTROLS_NOT_FOUND" });
      await submit.click(); if (typeof page.waitForTimeout === "function") await page.waitForTimeout(8_000);
    } catch (error) {
      session.status = "BLOCKED"; session.resultCode = String(error?.code || "CHROME_LOGIN_SUBMIT_FAILED"); session.resultReason = String(error?.message || "Không thể gửi form đăng nhập").replace(/\s+/g, " ").slice(0, 240); credentials = null; return this.status(started.sessionId);
    }
    credentials = null;
    const body = await pageBodyText(page); const observedUrl = pageUrl(page);
    if (CHALLENGE_TEXT.test(body) || /checkpoint|challenge|captcha|security[-_ ]check/i.test(observedUrl)) {
      session.status = "BLOCKED"; session.resultCode = "CHROME_LOGIN_CHALLENGE"; session.resultReason = "Nền tảng yêu cầu CAPTCHA/2FA/checkpoint; cửa sổ Chrome được giữ mở cho Nam"; session.observedUrl = observedUrl; session.evidenceHash = chromeEvidenceHash({ platform: normalized, accountId: account, observedUrl, code: session.resultCode, attempt: 1 }); return this.status(started.sessionId);
    }
    if (LOGIN_FAILURE_TEXT.test(body) && LOGIN_OR_CHALLENGE.test(observedUrl)) {
      session.status = "BLOCKED"; session.resultCode = "CHROME_LOGIN_FAILED"; session.resultReason = "Đăng nhập không thành công; không thử lại tự động"; session.observedUrl = observedUrl; session.evidenceHash = chromeEvidenceHash({ platform: normalized, accountId: account, observedUrl, code: session.resultCode, attempt: 1 }); return this.status(started.sessionId);
    }
    try { await page.goto(CHROME_IDENTITY_PROBE_URLS[normalized], { waitUntil: "domcontentloaded" }); }
    catch (error) { session.status = "BLOCKED"; session.resultCode = String(error?.code || "CHROME_IDENTITY_PROBE_FAILED"); session.resultReason = "Không thể kiểm tra danh tính sau đăng nhập; không thử lại tự động"; return this.status(started.sessionId); }
    const result = verifyChromeIdentity({ platform: normalized, url: pageUrl(page), title: typeof page.title === "function" ? await page.title().catch(() => "") : "", bodyText: await pageBodyText(page), candidateCount: 1 });
    session.status = result.status === "READY" ? "READY" : "BLOCKED"; session.resultCode = result.code; session.resultReason = result.reason; session.identityReference = result.identityReference; session.evidenceHash = result.evidenceHash; session.observedUrl = result.observedUrl; session.identityEvidence = result;
    return this.status(started.sessionId);
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
