import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, discoverUpdate, unavailableUpdateResult } from "../src/update-discovery.mjs";

test("update discovery validates HTTPS manifest and reports unsigned verification truthfully", async () => {
  const prior = process.env.SEEDING_RELEASE_MANIFEST_URL;
  const priorVersion = process.env.SEEDING_BUILD_VERSION;
  process.env.SEEDING_RELEASE_MANIFEST_URL = "https://updates.example.test/manifest.json";
  process.env.SEEDING_BUILD_VERSION = "0.3.0";
  try {
    const result = await discoverUpdate({ fetchImpl: async (url) => {
      assert.equal(url, "https://updates.example.test/manifest.json");
      return { ok: true, status: 200, async text() { return JSON.stringify({ version: "0.4.0", downloadUrl: "https://updates.example.test/app.zip", sha256: "a".repeat(64) }); } };
    } });
    assert.equal(result.status, "READY");
    assert.equal(result.updateAvailable, true);
    assert.equal(result.signatureVerified, false);
    assert.equal(result.installEligible, false);
    assert.match(result.reason, /signed release required/i);
  } finally {
    if (prior === undefined) delete process.env.SEEDING_RELEASE_MANIFEST_URL; else process.env.SEEDING_RELEASE_MANIFEST_URL = prior;
    if (priorVersion === undefined) delete process.env.SEEDING_BUILD_VERSION; else process.env.SEEDING_BUILD_VERSION = priorVersion;
  }
});

test("update discovery verifies an Ed25519 manifest when a release key is configured", async () => {
  const priorUrl = process.env.SEEDING_RELEASE_MANIFEST_URL;
  const priorVersion = process.env.SEEDING_BUILD_VERSION;
  const priorKey = process.env.SEEDING_UPDATE_PUBLIC_KEY;
  const priorInstaller = process.env.SEEDING_UPDATE_INSTALLER_ENABLED;
  const priorTeamId = process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID;
  const priorRequirement = process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT;
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const fields = { version: "0.4.0", downloadUrl: "https://updates.example.test/app.zip", sha256: "b".repeat(64) };
  const signature = sign(null, Buffer.from(JSON.stringify(fields)), privateKey).toString("base64");
  process.env.SEEDING_RELEASE_MANIFEST_URL = "https://updates.example.test/manifest.json";
  process.env.SEEDING_BUILD_VERSION = "0.3.0";
  process.env.SEEDING_UPDATE_PUBLIC_KEY = publicPem;
  delete process.env.SEEDING_UPDATE_INSTALLER_ENABLED;
  try {
    const result = await discoverUpdate({ fetchImpl: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ ...fields, signature }); } }) });
    assert.equal(result.signatureVerified, true);
    assert.equal(result.automaticUpdates, false);
    assert.equal(result.installEligible, false);
    assert.match(result.reason, /installer is not configured/i);
  } finally {
    if (priorUrl === undefined) delete process.env.SEEDING_RELEASE_MANIFEST_URL; else process.env.SEEDING_RELEASE_MANIFEST_URL = priorUrl;
    if (priorVersion === undefined) delete process.env.SEEDING_BUILD_VERSION; else process.env.SEEDING_BUILD_VERSION = priorVersion;
    if (priorKey === undefined) delete process.env.SEEDING_UPDATE_PUBLIC_KEY; else process.env.SEEDING_UPDATE_PUBLIC_KEY = priorKey;
    if (priorInstaller === undefined) delete process.env.SEEDING_UPDATE_INSTALLER_ENABLED; else process.env.SEEDING_UPDATE_INSTALLER_ENABLED = priorInstaller;
    if (priorTeamId === undefined) delete process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID; else process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID = priorTeamId;
    if (priorRequirement === undefined) delete process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT; else process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT = priorRequirement;
  }
});

test("update discovery marks a signed release installable only with an explicit installer", async () => {
  const priorUrl = process.env.SEEDING_RELEASE_MANIFEST_URL;
  const priorVersion = process.env.SEEDING_BUILD_VERSION;
  const priorKey = process.env.SEEDING_UPDATE_PUBLIC_KEY;
  const priorInstaller = process.env.SEEDING_UPDATE_INSTALLER_ENABLED;
  const priorTeamId = process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID;
  const priorRequirement = process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT;
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const fields = { version: "0.4.0", downloadUrl: "https://updates.example.test/app.zip", sha256: "c".repeat(64) };
  const signature = sign(null, Buffer.from(JSON.stringify(fields)), privateKey).toString("base64");
  process.env.SEEDING_RELEASE_MANIFEST_URL = "https://updates.example.test/manifest.json";
  process.env.SEEDING_BUILD_VERSION = "0.3.0";
  process.env.SEEDING_UPDATE_PUBLIC_KEY = publicPem;
  process.env.SEEDING_UPDATE_INSTALLER_ENABLED = "true";
  process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID = "TEAMFIXTURE";
  process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT = "anchor apple generic and identifier \"ai.marketing-seeding.local\" and team-identifier \"TEAMFIXTURE\"";
  try {
    const result = await discoverUpdate({ fetchImpl: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ ...fields, signature }); } }) });
    assert.equal(result.signatureVerified, true);
    assert.equal(result.automaticUpdates, true);
    assert.equal(result.installEligible, true);
  } finally {
    if (priorUrl === undefined) delete process.env.SEEDING_RELEASE_MANIFEST_URL; else process.env.SEEDING_RELEASE_MANIFEST_URL = priorUrl;
    if (priorVersion === undefined) delete process.env.SEEDING_BUILD_VERSION; else process.env.SEEDING_BUILD_VERSION = priorVersion;
    if (priorKey === undefined) delete process.env.SEEDING_UPDATE_PUBLIC_KEY; else process.env.SEEDING_UPDATE_PUBLIC_KEY = priorKey;
    if (priorInstaller === undefined) delete process.env.SEEDING_UPDATE_INSTALLER_ENABLED; else process.env.SEEDING_UPDATE_INSTALLER_ENABLED = priorInstaller;
    if (priorTeamId === undefined) delete process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID; else process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID = priorTeamId;
    if (priorRequirement === undefined) delete process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT; else process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT = priorRequirement;
  }
});

test("update discovery stays ineligible when signer Team ID or requirement is absent", async () => {
  const priorUrl = process.env.SEEDING_RELEASE_MANIFEST_URL;
  const priorVersion = process.env.SEEDING_BUILD_VERSION;
  const priorKey = process.env.SEEDING_UPDATE_PUBLIC_KEY;
  const priorInstaller = process.env.SEEDING_UPDATE_INSTALLER_ENABLED;
  const priorTeamId = process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID;
  const priorRequirement = process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT;
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const fields = { version: "0.4.0", downloadUrl: "https://updates.example.test/app.zip", sha256: "d".repeat(64) };
  const signature = sign(null, Buffer.from(JSON.stringify(fields)), privateKey).toString("base64");
  process.env.SEEDING_RELEASE_MANIFEST_URL = "https://updates.example.test/manifest.json";
  process.env.SEEDING_BUILD_VERSION = "0.3.0";
  process.env.SEEDING_UPDATE_PUBLIC_KEY = publicPem;
  process.env.SEEDING_UPDATE_INSTALLER_ENABLED = "true";
  delete process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID;
  delete process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT;
  try {
    const result = await discoverUpdate({ fetchImpl: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ ...fields, signature }); } }) });
    assert.equal(result.signatureVerified, true);
    assert.equal(result.signerConfigured, false);
    assert.equal(result.automaticUpdates, false);
    assert.equal(result.installEligible, false);
    assert.match(result.reason, /signer Team ID\/requirement is not configured/i);
  } finally {
    if (priorUrl === undefined) delete process.env.SEEDING_RELEASE_MANIFEST_URL; else process.env.SEEDING_RELEASE_MANIFEST_URL = priorUrl;
    if (priorVersion === undefined) delete process.env.SEEDING_BUILD_VERSION; else process.env.SEEDING_BUILD_VERSION = priorVersion;
    if (priorKey === undefined) delete process.env.SEEDING_UPDATE_PUBLIC_KEY; else process.env.SEEDING_UPDATE_PUBLIC_KEY = priorKey;
    if (priorInstaller === undefined) delete process.env.SEEDING_UPDATE_INSTALLER_ENABLED; else process.env.SEEDING_UPDATE_INSTALLER_ENABLED = priorInstaller;
    if (priorTeamId === undefined) delete process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID; else process.env.SEEDING_UPDATE_EXPECTED_SIGNER_TEAM_ID = priorTeamId;
    if (priorRequirement === undefined) delete process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT; else process.env.SEEDING_UPDATE_EXPECTED_SIGNER_REQUIREMENT = priorRequirement;
  }
});

test("version comparison is numeric and bounded", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.2", "0.3"), -1);
});

test("scheduled discovery fallback is fail-closed on malformed manifests", () => {
  const result = unavailableUpdateResult(new Error("release manifest JSON is malformed"));
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.updateAvailable, false);
  assert.equal(result.automaticUpdates, false);
  assert.equal(result.installEligible, false);
  assert.equal(result.signatureVerified, false);
  assert.match(result.reason, /malformed/i);
});

