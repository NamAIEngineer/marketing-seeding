import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { ChromeAccountProfileManager, chromeAccountProfilePath, chromeAccountProfileRoot, chromeAccountSource, normalizeEvidenceSource, verifyChromeIdentity } from "../src/chrome-account-profile.mjs";

test("Chrome account profile path stays under the app-owned root", () => {
  const root = chromeAccountProfileRoot({ homeDir: "/Users/test" });
  assert.equal(root, "/Users/test/Library/Application Support/Marketing Seeding OS/chrome-profiles");
  assert.equal(chromeAccountProfilePath("linkedin", "linkedin_nam", { homeDir: "/Users/test" }), `${root}/linkedin-linkedin_nam`);
  assert.throws(() => chromeAccountProfilePath("linkedin", "../personal", { homeDir: "/Users/test" }), /invalid/);
  assert.equal(chromeAccountSource("linkedin_nam"), "chrome-account:linkedin_nam");
  assert.equal(normalizeEvidenceSource(null, { provider: "chrome", accountId: "linkedin_nam" }), "chrome-account:linkedin_nam");
  assert.equal(normalizeEvidenceSource("camoufox-public"), "camoufox-public");
});

test("Chrome identity parser fails closed until direct platform redirect evidence", () => {
  assert.ok(["UNKNOWN", "BLOCKED"].includes(verifyChromeIdentity({ platform: "linkedin", url: "https://www.linkedin.com/in/me/" }).status));
  assert.ok(["UNKNOWN", "BLOCKED"].includes(verifyChromeIdentity({ platform: "linkedin", url: "https://www.linkedin.com/login" }).status));
  const linkedIn = verifyChromeIdentity({ platform: "linkedin", url: "https://www.linkedin.com/in/nam-dev/" });
  assert.equal(linkedIn.status, "READY");
  assert.equal(linkedIn.identityReference, "https://www.linkedin.com/in/nam-dev");
  const numericFacebook = verifyChromeIdentity({ platform: "facebook", url: "https://www.facebook.com/profile.php?id=123456789" });
  assert.equal(numericFacebook.status, "READY");
  const namedFacebook = verifyChromeIdentity({ platform: "facebook", url: "https://www.facebook.com/nam.dev" });
  assert.equal(namedFacebook.status, "READY");
  assert.equal(verifyChromeIdentity({ platform: "linkedin", url: "https://www.linkedin.com/in/nam-dev/", bodyText: "Sign in to continue" }).status, "BLOCKED");
  assert.equal(verifyChromeIdentity({ platform: "linkedin", url: "https://www.linkedin.com/in/nam-dev/", candidateCount: 2 }).status, "UNKNOWN");
  assert.ok(["UNKNOWN", "BLOCKED"].includes(verifyChromeIdentity({ platform: "facebook", url: "https://www.facebook.com/me" }).status));
});

test("Chrome manager launches one visible persistent app profile and leaves login window open", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "chrome-profile-manager-"));
  const calls = [];
  const page = {
    url: () => "about:blank",
    goto: async (url, options) => { calls.push(["goto", url, options]); },
    title: async () => "LinkedIn Login",
    locator: () => ({ innerText: async () => "Sign in" })
  };
  const context = { pages: () => [page], newPage: async () => page, close: async () => { calls.push(["close"]); } };
  const manager = new ChromeAccountProfileManager({
    homeDir,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    playwright: { chromium: { launchPersistentContext: async (profilePath, options) => { calls.push(["launch", profilePath, options]); return context; } } },
    ttlMs: 60_000
  });
  const session = await manager.start({ platform: "linkedin", accountId: "linkedin_nam" });
  const launch = calls.find(([name]) => name === "launch");
  assert.equal(launch[1], `${homeDir}/Library/Application Support/Marketing Seeding OS/chrome-profiles/linkedin-linkedin_nam`);
  assert.equal(launch[2].headless, false);
  assert.equal(launch[2].viewport, null);
  assert.equal(calls.find(([name]) => name === "goto")[1], "https://www.linkedin.com/login");
  assert.equal(session.status, "WAITING_FOR_USER");
  assert.equal(session.source, "chrome-account:linkedin_nam");
  assert.equal(session.identityReference, null);
  const retry = await manager.retryLogin({ platform: "linkedin", accountId: "linkedin_nam", credentialReference: "keychain:marketing/linkedin_nam" });
  assert.equal(retry.code, "CHROME_LOGIN_CONTROLS_NOT_FOUND");
  await manager.close(retry.sessionId);
  assert.deepEqual(calls.at(-1), ["close"]);
  await rm(homeDir, { recursive: true, force: true });
});

test("Chrome manager can verify an attached existing session without credential submission", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "chrome-profile-verify-"));
  let currentUrl = "https://www.linkedin.com/feed/";
  let fills = 0;
  const page = {
    url: () => currentUrl,
    goto: async (url) => { currentUrl = url === "https://www.linkedin.com/in/me/" ? "https://www.linkedin.com/in/nam-dev/" : url; },
    title: async () => "Nam Dev | LinkedIn",
    locator: () => ({ innerText: async () => "Nam Dev" })
  };
  const context = { pages: () => [page], newPage: async () => page, close: async () => {} };
  const manager = new ChromeAccountProfileManager({
    homeDir, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    playwright: { chromium: { launchPersistentContext: async () => context } }, ttlMs: 60_000
  });
  const started = await manager.start({ platform: "linkedin", accountId: "linkedin_nam" });
  const verified = await manager.verifyExistingProfile({ platform: "linkedin", accountId: "linkedin_nam", sessionId: started.sessionId });
  assert.equal(verified.status, "READY");
  assert.equal(verified.identityReference, "https://www.linkedin.com/in/nam-dev");
  assert.equal(fills, 0);
  await manager.close(started.sessionId);
  await rm(homeDir, { recursive: true, force: true });
});

test("Chrome identity proof rejects a profile shell that still shows an auth surface", () => {
  const result = verifyChromeIdentity({ platform: "facebook", url: "https://www.facebook.com/nam.dev", title: "Sign in to Facebook" });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.code, "CHROME_LOGIN_CHALLENGE");
});

test("Chrome identity proof keeps account chooser and consent surfaces fail-closed", () => {
  const chooser = verifyChromeIdentity({ platform: "facebook", url: "https://www.facebook.com/nam.dev", title: "Choose an account to continue" });
  assert.equal(chooser.status, "BLOCKED");
  // Account chooser text is not accepted as identity proof; the canonical
  // redirect plus a clean authenticated surface remains the bounded signal.
  const consent = verifyChromeIdentity({ platform: "facebook", url: "https://www.facebook.com/nam.dev", bodyText: "Cookie consent required" });
  assert.equal(consent.status, "BLOCKED");
});

test("manual Chrome service seam persists canonical store source and identity evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chrome-service-seam-"));
  const store = new JsonStore(path.join(directory, "state.json"));
  let started;
  const manager = {
    async start(input) {
      started = input;
      return { sessionId: "linkedin:linkedin_nam:1", platform: "linkedin", accountId: "linkedin_nam", profilePath: chromeAccountProfilePath("linkedin", "linkedin_nam", { homeDir: directory }), status: "WAITING_FOR_USER", source: "chrome-account:linkedin_nam" };
    },
    async poll() {
      return { sessionId: "linkedin:linkedin_nam:1", platform: "linkedin", accountId: "linkedin_nam", status: "READY", identityReference: "https://www.linkedin.com/in/nam-dev", observedUrl: "https://www.linkedin.com/in/nam-dev/", evidenceHash: "a".repeat(64), source: "chrome-account:linkedin_nam" };
    }
  };
  const service = new SeedingService(store, { chromeAccountProfileManager: manager });
  await service.init();
  const first = await service.startChromeAccountLogin({ platform: "linkedin", accountId: "linkedin_nam" });
  assert.equal(started.accountId, "linkedin_nam");
  assert.equal(first.account.provider, "chrome");
  assert.equal(first.account.source, "chrome-account:linkedin_nam");
  assert.match(first.account.chromeProfilePath, /Library\/Application Support\/Marketing Seeding OS\/chrome-profiles\/linkedin-linkedin_nam$/);
  const ready = await service.pollChromeAccountLogin("linkedin:linkedin_nam:1");
  assert.equal(ready.status, "READY");
  const state = await store.read();
  assert.equal(state.executionAccounts[0].identityEvidenceHash, "a".repeat(64));
  assert.equal(state.executionAccounts[0].loginStatus, "READY");
  await rm(directory, { recursive: true, force: true });
});
