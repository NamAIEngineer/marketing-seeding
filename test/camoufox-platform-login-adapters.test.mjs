import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMOUFOX_PLATFORM_LOGIN_ADAPTERS,
  getCamoufoxPlatformLoginAdapter,
  listCamoufoxPlatformLoginAdapters,
  loginAccountWithCamoufoxPlatform,
  normalizeCamoufoxIdentityReference
} from "../src/camoufox-platform-login-adapters.mjs";

const FIXTURES = Object.freeze({
  facebook_group: { identity: "https://www.facebook.com/fixture-owner", target: "https://www.facebook.com/groups/fixture-group", other: "https://www.facebook.com/other-owner" },
  threads: { identity: "https://www.threads.net/@fixture-owner", target: "https://www.threads.net/@fixture-topic", other: "https://www.threads.net/@other-owner" },
  reddit: { identity: "https://www.reddit.com/user/fixture_owner", target: "https://www.reddit.com/r/fixture", other: "https://www.reddit.com/user/other_owner" },
  product_hunt: { identity: "https://www.producthunt.com/@fixture-owner", target: "https://www.producthunt.com/posts/fixture", other: "https://www.producthunt.com/@other-owner" },
  indie_hackers: { identity: "https://www.indiehackers.com/u/fixture-owner", target: "https://www.indiehackers.com/groups/fixture", other: "https://www.indiehackers.com/u/other-owner" }
});
const PASSWORD = "fixture-password-must-not-escape";
const USERNAME = "fixture-user@example.test";

function fixtureProtocol(adapter, { identity, snapshot = "login", rights = null } = {}) {
  let submitted = false;
  const calls = [];
  return {
    calls,
    async navigate(pageId, url) { calls.push(["navigate", pageId, url]); },
    async snapshot() {
      calls.push(["snapshot"]);
      if (snapshot === "challenge") return "Verify your account CAPTCHA security check";
      return submitted ? "Home Feed" : "Email Password Sign in";
    },
    async resolve(_pageId, query) {
      const queryText = String(query);
      if (/password/i.test(queryText)) return "password-ref";
      if (/sign|log|continue/i.test(queryText)) return "submit-ref";
      return "username-ref";
    },
    async fill(_pageId, ref, value) { calls.push(["fill", ref, value]); },
    async click({ ref }) { calls.push(["click", ref]); submitted = true; },
    async evaluate(_pageId, expression) {
      calls.push(["evaluate", expression]);
      if (expression === adapter.identityExpression) {
        if (identity === "home-only") return { authenticated: true, ownerSurface: false, authenticatedSurface: true, identityReference: null, candidateCount: 0, ambiguous: false };
        return { authenticated: true, ownerSurface: true, authenticatedSurface: true, identityReference: identity, stableId: identity.split("/").pop().replace(/^@/, ""), source: adapter.rule.source, candidateCount: 1, ambiguous: false, confidence: 140 };
      }
      if (expression.includes("data-can-post")) return rights || { targetMatched: true, canPost: false, authenticatedSurface: true, source: adapter.rule.rightsSource, membershipRequired: true, membershipStatus: "not_member", postingStatus: "blocked", composerVisible: false, submitControlVisible: false, submitControlEnabled: false };
      throw new Error("unexpected expression");
    }
  };
}

for (const platform of listCamoufoxPlatformLoginAdapters()) {
  const fixture = FIXTURES[platform];
  test(`${platform} descriptor normalizes exact identity and rejects other surfaces`, () => {
    const adapter = getCamoufoxPlatformLoginAdapter(platform);
    assert.equal(adapter, CAMOUFOX_PLATFORM_LOGIN_ADAPTERS[platform]);
    assert.equal(normalizeCamoufoxIdentityReference(platform, fixture.identity), fixture.identity.replace("www.", ""));
    assert.equal(normalizeCamoufoxIdentityReference(platform, fixture.other), fixture.other.replace("www.", ""));
    assert.equal(normalizeCamoufoxIdentityReference(platform, "https://example.test/not-an-identity"), null);
  });

  test(`${platform} fixture login requires exact owner identity`, async () => {
    const adapter = getCamoufoxPlatformLoginAdapter(platform);
    const protocol = fixtureProtocol(adapter, { identity: fixture.identity });
    const result = await loginAccountWithCamoufoxPlatform({
      platform, accountId: `${platform}-fixture`, protocol, pageId: "page-1",
      expectedIdentity: fixture.identity, credentials: { username: USERNAME, password: PASSWORD }
    });
    assert.equal(result.status, "READY");
    assert.equal(result.code, "LOGIN_CONFIRMED");
    assert.equal(result.identityVerified, true);
    assert.equal(result.postingRights.status, "NOT_CHECKED");
    assert.equal(result.externalSideEffects, false);
    assert.equal(result.published, false);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(PASSWORD), false);
    assert.equal(serialized.includes(USERNAME), false);
  });

  test(`${platform} challenge fixture is BLOCKED and never READY`, async () => {
    const adapter = getCamoufoxPlatformLoginAdapter(platform);
    const protocol = fixtureProtocol(adapter, { snapshot: "challenge", identity: fixture.identity });
    const result = await loginAccountWithCamoufoxPlatform({
      platform, accountId: `${platform}-challenge`, protocol, expectedIdentity: fixture.identity,
      credentials: { username: USERNAME, password: PASSWORD }
    });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.code, "ACCOUNT_SECURITY_CHALLENGE");
    assert.equal(result.nextAction, "HUMAN_REQUIRED");
    assert.equal(result.identityVerified, false);
    assert.equal(JSON.stringify(result).includes(PASSWORD), false);
  });

  test(`${platform} generic home fixture stays UNKNOWN`, async () => {
    const adapter = getCamoufoxPlatformLoginAdapter(platform);
    const protocol = fixtureProtocol(adapter, { identity: "home-only" });
    const result = await loginAccountWithCamoufoxPlatform({
      platform, accountId: `${platform}-home`, protocol, expectedIdentity: fixture.identity,
      credentials: { username: USERNAME, password: PASSWORD }
    });
    assert.equal(result.status, "UNKNOWN");
    assert.match(result.code, /IDENTITY/);
    assert.equal(result.identityVerified, false);
    assert.notEqual(result.status, "READY");
  });

  test(`${platform} wrong account fixture stays UNKNOWN`, async () => {
    const adapter = getCamoufoxPlatformLoginAdapter(platform);
    const protocol = fixtureProtocol(adapter, { identity: fixture.other });
    const result = await loginAccountWithCamoufoxPlatform({
      platform, accountId: `${platform}-wrong`, protocol, expectedIdentity: fixture.identity,
      credentials: { username: USERNAME, password: PASSWORD }
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.code, "LOGIN_IDENTITY_MISMATCH");
    assert.equal(result.identityVerified, false);
  });
}

test("account identity READY does not imply community posting rights", async () => {
  const adapter = getCamoufoxPlatformLoginAdapter("facebook_group");
  const protocol = fixtureProtocol(adapter, {
    identity: FIXTURES.facebook_group.identity,
    rights: { targetMatched: true, canPost: false, authenticatedSurface: true, source: adapter.rule.rightsSource, membershipRequired: true, membershipStatus: "not_member", postingStatus: "blocked", composerVisible: false, submitControlVisible: false, submitControlEnabled: false }
  });
  const result = await loginAccountWithCamoufoxPlatform({
    platform: "facebook_group", accountId: "facebook-fixture", protocol, expectedIdentity: FIXTURES.facebook_group.identity,
    target: { id: "group-fixture", url: FIXTURES.facebook_group.target }, credentials: { username: USERNAME, password: PASSWORD }
  });
  assert.equal(result.status, "READY");
  assert.equal(result.identityVerified, true);
  assert.equal(result.postingRights.status, "BLOCKED");
  assert.equal(result.postingRights.reason, "target_membership_or_rules_required");
});

for (const platform of ["facebook_group", "reddit", "product_hunt", "indie_hackers"]) {
  test(`${platform} requires accepted rules evidence before posting-rights READY`, async () => {
    const adapter = getCamoufoxPlatformLoginAdapter(platform);
    const target = { id: `${platform}-rules`, url: FIXTURES[platform].target };
    const absent = fixtureProtocol(adapter, {
      identity: FIXTURES[platform].identity,
      rights: { targetMatched: true, canPost: true, authenticatedSurface: true, source: adapter.rule.rightsSource, submitControlEnabled: true }
    });
    const absentResult = await adapter.checkPostingRights({ protocol: absent, pageId: "page-1", target, identityReady: true });
    assert.equal(absentResult.status, "UNKNOWN");
    assert.equal(absentResult.reason, "target_rules_evidence_unavailable");

    const denied = fixtureProtocol(adapter, {
      identity: FIXTURES[platform].identity,
      rights: { targetMatched: true, canPost: true, authenticatedSurface: true, source: adapter.rule.rightsSource, submitControlEnabled: true, rulesEvidencePresent: true, rulesEvidenceAccepted: false, rulesEvidenceDenied: true, rulesStatus: "denied" }
    });
    const deniedResult = await adapter.checkPostingRights({ protocol: denied, pageId: "page-1", target, identityReady: true });
    assert.equal(deniedResult.status, "BLOCKED");
    assert.equal(deniedResult.reason, "target_membership_or_rules_required");

    const accepted = fixtureProtocol(adapter, {
      identity: FIXTURES[platform].identity,
      rights: { targetMatched: true, canPost: true, authenticatedSurface: true, source: adapter.rule.rightsSource, submitControlEnabled: true, rulesEvidencePresent: true, rulesEvidenceAccepted: true, rulesStatus: "reviewed" }
    });
    const acceptedResult = await adapter.checkPostingRights({ protocol: accepted, pageId: "page-1", target, identityReady: true });
    assert.equal(acceptedResult.status, "READY");
    assert.equal(acceptedResult.reason, "target_posting_rights_confirmed");
  });
}

test("unsupported platform and incomplete caller inputs fail closed", async () => {
  const unsupported = await loginAccountWithCamoufoxPlatform({ platform: "linkedin", accountId: "a" });
  assert.equal(unsupported.status, "BLOCKED");
  assert.equal(unsupported.code, "PLATFORM_LOGIN_UNSUPPORTED");
  const adapter = getCamoufoxPlatformLoginAdapter("threads");
  const missingCredentials = await adapter.login({ platform: "threads", accountId: "a", expectedIdentity: FIXTURES.threads.identity, protocol: {} });
  assert.equal(missingCredentials.status, "BLOCKED");
  assert.equal(missingCredentials.code, "CAMOUFOX_PROTOCOL_INCOMPLETE");
  const missingIdentity = await adapter.login({ platform: "threads", accountId: "a", credentials: { username: USERNAME, password: PASSWORD }, protocol: {} });
  assert.equal(missingIdentity.status, "UNKNOWN");
  assert.equal(missingIdentity.code, "EXPECTED_IDENTITY_REQUIRED");
});
