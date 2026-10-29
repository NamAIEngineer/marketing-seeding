import test from "node:test";
import assert from "node:assert/strict";
import { profileFingerprint, projectGpmAccountCatalog } from "../src/gpm-account-catalog-projection.mjs";

const catalog = {
  state: "OBSERVED",
  code: "GPM_PROFILE_CATALOG_OBSERVED",
  count: 3,
  profiles: [
    { profileId: "profile-a", name: "Alpha", groupId: null, browser: { name: "Chrome", version: "152" }, os: "macOS", pinned: true, tags: ["linkedin"], createdAt: "2026-10-21 09:30:02" },
    { profileId: "profile-b", name: "Beta", browser: { name: "Chrome", version: "152" }, os: "macOS", pinned: false, tags: [] },
    { profileId: "profile-c", name: "Gamma", browser: null, os: "unknown", pinned: false, tags: [] }
  ]
};

test("exact profile ID binding is read-only and never exposes raw profile IDs", () => {
  const accounts = [{ platform: "linkedin", accountId: "account-a", profileId: "profile-a", status: "enabled", health: "unknown" }];
  const before = structuredClone(accounts);
  const result = projectGpmAccountCatalog(catalog, accounts, { now: "2026-10-23T00:00:00.000Z" });
  assert.deepEqual(accounts, before);
  assert.equal(result.catalog.profiles.find((row) => row.name === "Alpha").linkage.status, "EXACT");
  assert.equal(result.accounts[0].catalogLinkage, "EXACT");
  assert.equal(result.accounts[0].profileFingerprint, profileFingerprint("profile-a"));
  assert.equal(JSON.stringify(result).includes("profile-a"), false);
  assert.equal(result.summary.accountIdentityProven, false);
  assert.equal(result.summary.sessionReadinessProven, false);
  assert.equal(result.summary.executionEligible, false);
});

test("name similarity cannot bind an account and missing account profile is explicit", () => {
  const result = projectGpmAccountCatalog(catalog, [{ platform: "linkedin", accountId: "account-x", profileId: "profile-missing", status: "enabled", health: "healthy" }]);
  assert.equal(result.accounts[0].catalogLinkage, "MISSING");
  assert.deepEqual(result.accounts[0].reasons, ["catalog:profile_missing"]);
  assert.equal(result.catalog.profiles.find((row) => row.name === "Alpha").linkage.status, "UNBOUND");
});

test("duplicate account profile rows remain ambiguous and do not become execution eligible", () => {
  const result = projectGpmAccountCatalog(catalog, [
    { platform: "linkedin", accountId: "account-a", profileId: "profile-a", status: "enabled", health: "healthy" },
    { platform: "linkedin", accountId: "account-b", profileId: "profile-a", status: "enabled", health: "healthy" }
  ]);
  const profile = result.catalog.profiles.find((row) => row.name === "Alpha");
  assert.equal(profile.linkage.status, "AMBIGUOUS");
  assert.equal(profile.linkage.accountCount, 2);
  assert.deepEqual(result.accounts.map((row) => row.catalogLinkage), ["AMBIGUOUS", "AMBIGUOUS"]);
  assert.equal(result.summary.ambiguousProfiles, 1);
  assert.equal(result.summary.executionEligible, false);
});

test("unknown catalog state never binds or promotes account metadata", () => {
  const result = projectGpmAccountCatalog({ state: "UNKNOWN", code: "GPM_PROFILE_CATALOG_SCHEMA_UNKNOWN", profiles: [] }, [{ platform: "linkedin", accountId: "account-a", profileId: "profile-a", status: "enabled", health: "healthy" }]);
  assert.equal(result.catalog.state, "UNKNOWN");
  assert.equal(result.accounts[0].catalogLinkage, "NOT_OBSERVED");
  assert.deepEqual(result.accounts[0].reasons, ["catalog:unknown"]);
  assert.equal(result.summary.executionEligible, false);
});

test("secret-like and unallowlisted fields are never copied", () => {
  const result = projectGpmAccountCatalog({
    ...catalog,
    profiles: [{ ...catalog.profiles[0], raw_proxy: "secret", storage_path: "/private", note: "private" }]
  }, [{ platform: "linkedin", accountId: "account-a", profileId: "profile-a", status: "enabled", health: "healthy", cookie: "secret", sessionToken: "secret", raw_proxy: "secret" }]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("raw_proxy"), false);
  assert.equal(serialized.includes("storage_path"), false);
  assert.equal(serialized.includes("sessionToken"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.deepEqual(Object.keys(result.accounts[0]).sort(), ["accountId", "catalogLinkage", "health", "platform", "profileFingerprint", "reasons", "status"]);
});

test("projection ordering is deterministic and output is deeply frozen", () => {
  const first = projectGpmAccountCatalog(catalog, [
    { platform: "reddit", accountId: "r", profileId: "profile-b", status: "enabled", health: "unknown" },
    { platform: "linkedin", accountId: "l", profileId: "profile-a", status: "enabled", health: "unknown" }
  ], { now: "2026-10-23T00:00:00.000Z" });
  const second = projectGpmAccountCatalog(catalog, [
    { platform: "linkedin", accountId: "l", profileId: "profile-a", status: "enabled", health: "unknown" },
    { platform: "reddit", accountId: "r", profileId: "profile-b", status: "enabled", health: "unknown" }
  ], { now: "2026-10-23T00:00:00.000Z" });
  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.catalog.profiles[0]), true);
});
