import assert from "node:assert/strict";
import test from "node:test";
import { CamoufoxPlaywrightProtocolClient } from "../src/camoufox-playwright-protocol.mjs";
import { mutationExpressionHash } from "../src/browser-mutation-policy.mjs";

const expression = "(() => ({ sessionAuthenticated: true }))()";
const mutation = "(() => ({ changed: true }))()";

function page() {
  return {
    url: () => "https://www.linkedin.com/feed/",
    async evaluate(source) { return source === expression ? { sessionAuthenticated: true } : { changed: true }; },
    locator() {
      return {
        async evaluateAll() { return []; },
        nth() { return { async fill() {}, async click() {}, async setInputFiles() {} }; }
      };
    },
    async goto() {},
    async waitForURL() {},
    async waitForFunction() {}
  };
}

function context() {
  const pages = [page()];
  return {
    pages: () => pages,
    async newPage() { const value = page(); pages.push(value); return value; }
  };
}

test("Camoufox protocol attaches and permits safe readiness expression", async () => {
  const client = new CamoufoxPlaywrightProtocolClient({
    context: context(), profileReference: "linkedin-profile",
    expectedIdentity: { platform: "linkedin", accountId: "account-1", identityReference: "https://www.linkedin.com/in/member" }
  });
  assert.deepEqual(await client.attach(), { attached: true });
  assert.deepEqual(await client.evaluate("page-1-0", "true").catch((error) => error.code), "CAMOUFOX_PAGE_NOT_FOUND");
  const [tab] = await client.listTabs();
  assert.deepEqual(await client.evaluate(tab.id, expression), { sessionAuthenticated: true });
});

test("Camoufox protocol independently extracts and compares the rendered LinkedIn identity", async () => {
  const expected = "https://www.linkedin.com/in/member";
  const renderedIdentity = "https://www.linkedin.com/in/member/";
  const observedSources = [];
  const livePage = {
    url: () => "https://www.linkedin.com/feed/",
    async evaluate(source) {
      observedSources.push(source);
      if (source.includes("const identityVerified")) {
        return { sessionAuthenticated: true, identityVerified: true, feedReachable: true, securityChallenge: false, loginRequired: false };
      }
      if (source.includes("linkedin-navigation-surface")) {
        return { identityReference: renderedIdentity, stableId: "member", ambiguous: false, confidence: 140, source: "linkedin-navigation-surface", candidates: [{ reference: renderedIdentity, score: 140 }] };
      }
      throw new Error("unexpected protocol expression");
    },
    locator() { return { async evaluateAll() { return []; }, nth() { return { async fill() {}, async click() {}, async setInputFiles() {} }; } }; },
    async goto() {}, async waitForURL() {}, async waitForFunction() {}
  };
  const liveContext = { pages: () => [livePage], async newPage() { return livePage; } };
  const client = new CamoufoxPlaywrightProtocolClient({
    context: liveContext, profileReference: "linkedin-profile",
    expectedIdentity: { platform: "linkedin", accountId: "account-1", identityReference: expected }
  });
  await client.attach();
  const observed = await client.observeIdentity();
  assert.equal(observed.state, "READY");
  assert.equal(observed.identityReference, expected);
  assert.equal(observed.expectedIdentityReference, expected);
  assert.equal(observed.evidence.identityVerified, true);
  assert.equal(observed.evidence.stableIdentityIdVerified, true);
  assert.equal(observed.evidence.identitySource, "linkedin-navigation-surface");
  assert.equal(observedSources.length, 2);
});

test("Camoufox protocol recognizes the rendered LinkedIn owner profile module", async () => {
  const expected = "https://www.linkedin.com/in/member";
  const page = {
    url: () => "https://www.linkedin.com/feed/foryou/",
    async evaluate(source) {
      if (source.includes("const identityVerified")) return { sessionAuthenticated: true, identityVerified: true, feedReachable: true, securityChallenge: false, loginRequired: false };
      if (source.includes("linkedin-owner-profile-module")) return { identityReference: expected, stableId: "member", ambiguous: false, confidence: 160, source: "linkedin-owner-profile-module", candidates: [{ reference: expected, score: 160, ownerModule: true }] };
      throw new Error("unexpected protocol expression");
    },
    locator() { return { async evaluateAll() { return []; }, nth() { return { async fill() {}, async click() {}, async setInputFiles() {} }; } }; },
    async goto() {}, async waitForURL() {}, async waitForFunction() {}
  };
  const client = new CamoufoxPlaywrightProtocolClient({ context: { pages: () => [page], async newPage() { return page; } }, profileReference: "linkedin-profile", expectedIdentity: { platform: "linkedin", accountId: "account-1", identityReference: expected } });
  await client.attach();
  const observed = await client.observeIdentity();
  assert.equal(observed.state, "READY");
  assert.equal(observed.evidence.identitySource, "linkedin-owner-profile-module");
});

test("Camoufox protocol keeps a generic authenticated surface UNKNOWN without owner identity evidence", async () => {
  const genericPage = {
    url: () => "https://www.linkedin.com/feed/",
    async evaluate(source) {
      if (source.includes("const identityVerified")) return { sessionAuthenticated: true, identityVerified: true, feedReachable: true, securityChallenge: false, loginRequired: false };
      if (source.includes("linkedin-navigation-surface")) return { identityReference: "https://www.linkedin.com/in/member", stableId: "member", ambiguous: false, confidence: 20, source: "linkedin-rendered-profile-link", candidates: [{ reference: "https://www.linkedin.com/in/member", score: 20 }] };
      throw new Error("unexpected protocol expression");
    },
    locator() { return { async evaluateAll() { return []; }, nth() { return { async fill() {}, async click() {}, async setInputFiles() {} }; } }; },
    async goto() {}, async waitForURL() {}, async waitForFunction() {}
  };
  const client = new CamoufoxPlaywrightProtocolClient({ context: { pages: () => [genericPage], async newPage() { return genericPage; } }, profileReference: "linkedin-profile", expectedIdentity: { platform: "linkedin", accountId: "account-1" } });
  await client.attach();
  const observed = await client.observeIdentity();
  assert.equal(observed.state, "UNKNOWN");
  assert.equal(observed.evidence.identityVerified, false);
});

test("Camoufox protocol fails closed when rendered LinkedIn identity is ambiguous or different", async () => {
  const page = (identity) => ({
    url: () => "https://www.linkedin.com/feed/",
    async evaluate(source) {
      if (source.includes("const identityVerified")) return { sessionAuthenticated: true, identityVerified: true, feedReachable: true, securityChallenge: false, loginRequired: false };
      if (source.includes("linkedin-navigation-surface")) return identity;
      throw new Error("unexpected protocol expression");
    },
    locator() { return { async evaluateAll() { return []; }, nth() { return { async fill() {}, async click() {}, async setInputFiles() {} }; } }; },
    async goto() {}, async waitForURL() {}, async waitForFunction() {}
  });
  for (const identity of [
    { identityReference: "https://www.linkedin.com/in/other", stableId: "other", ambiguous: false, confidence: 140, source: "linkedin-navigation-surface", candidates: [] },
    { identityReference: null, ambiguous: true, confidence: 140, source: "linkedin-navigation-surface", candidates: [{ reference: "https://www.linkedin.com/in/a", score: 140 }, { reference: "https://www.linkedin.com/in/b", score: 140 }] }
  ]) {
    const client = new CamoufoxPlaywrightProtocolClient({
      context: { pages: () => [page(identity)], async newPage() { return page(identity); } },
      profileReference: "linkedin-profile",
      expectedIdentity: { platform: "linkedin", accountId: "account-1", identityReference: "https://www.linkedin.com/in/member" }
    });
    await client.attach();
    const observed = await client.observeIdentity();
    assert.equal(observed.state, "UNKNOWN");
    assert.equal(observed.evidence.identityVerified, false);
  }
});

test("Camoufox protocol rejects credential and private session material", async () => {
  const client = new CamoufoxPlaywrightProtocolClient({ context: context(), profileReference: "profile" });
  await client.attach();
  const [tab] = await client.listTabs();
  for (const source of [
    "(() => password)()",
    "(() => accessToken)()",
    "(() => sessionToken)()",
    "(() => document.cookie)()",
    "(() => localStorage.getItem('x'))()",
    "(() => authorization)()",
    "(() => document['coo' + 'kie'])()",
    "(() => window['local' + 'Storage'])()",
    "(() => globalThis['session' + 'Storage'])()"
  ]) {
    await assert.rejects(() => client.evaluate(tab.id, source), { code: "CAMOUFOX_EXPRESSION_REJECTED" });
    await assert.rejects(() => client.waitForExpression(tab.id, source), { code: "CAMOUFOX_EXPRESSION_REJECTED" });
  }
});

test("Camoufox read-only evaluation rejects page side effects and reflective access", async () => {
  const client = new CamoufoxPlaywrightProtocolClient({ context: context(), profileReference: "profile" });
  await client.attach();
  const [tab] = await client.listTabs();
  for (const source of [
    "(() => { document.body.innerHTML = 'changed'; return true; })()",
    "(() => { fetch('https://example.test'); return true; })()",
    "(() => { location = 'https://example.test'; return true; })()",
    "(() => { location.assign('https://example.test'); return true; })()",
    "(() => { document.querySelector('button').click(); return true; })()",
    "(() => { document.body.setAttribute('data-x', '1'); return true; })()",
    "(() => { Reflect.get(document, 'cookie'); return true; })()",
    "(() => { globalThis['fetch']('https://example.test'); return true; })()",
    "(() => { window['location']['assign']?.('https://example.test'); return true; })()",
    "(() => { (document.querySelector('button'), document.body).textContent += 'changed'; return true; })()",
    "(() => { const call = globalThis?.fetch; call?.('https://example.test'); return true; })()",
    "(() => { const target = document.body; target?.appendChild?.(document.createElement('div')); return true; })()",
    "(() => `${fetch('https://example.test')}`)()",
    "(() => `${`${location = 'https://example.test'}`}`)()"
  ]) {
    await assert.rejects(() => client.evaluate(tab.id, source), { code: "CAMOUFOX_EXPRESSION_REJECTED" });
    await assert.rejects(() => client.waitForExpression(tab.id, source), { code: "CAMOUFOX_EXPRESSION_REJECTED" });
  }
});

test("Camoufox read-only evaluation keeps bounded DOM observations usable", async () => {
  const client = new CamoufoxPlaywrightProtocolClient({ context: context(), profileReference: "profile" });
  await client.attach();
  const [tab] = await client.listTabs();
  assert.deepEqual(await client.evaluate(tab.id, "(() => { const path = location.pathname; return path === '/feed/'; })()"), { changed: true });
});

test("Camoufox mutation evaluation requires operation and exact expression hash", async () => {
  const client = new CamoufoxPlaywrightProtocolClient({
    context: context(), profileReference: "profile",
    mutationExpressionHashes: { LINKEDIN_COMPOSER_TRIGGER: [mutationExpressionHash(mutation)] }
  });
  await client.attach();
  const [tab] = await client.listTabs();
  assert.deepEqual(await client.evaluateMutation(tab.id, mutation, {
    operation: "LINKEDIN_COMPOSER_TRIGGER", expressionHash: mutationExpressionHash(mutation)
  }), { changed: true });
  await assert.rejects(() => client.evaluateMutation(tab.id, mutation, {
    operation: "LINKEDIN_COMPOSER_TRIGGER", expressionHash: "sha256:" + "0".repeat(64)
  }), { code: "CAMOUFOX_MUTATION_UNAUTHORIZED" });
});

test("Camoufox protocol rejects stale refs and detaches", async () => {
  const client = new CamoufoxPlaywrightProtocolClient({ context: context(), profileReference: "profile" });
  await client.attach();
  const [tab] = await client.listTabs();
  await assert.rejects(() => client.click({ pageId: tab.id, ref: "cf-9" }), { code: "CAMOUFOX_ELEMENT_REF_STALE" });
  assert.deepEqual(await client.detach(), { detached: true });
  await assert.rejects(() => client.listTabs(), { code: "CAMOUFOX_PROTOCOL_DETACHED" });
});
