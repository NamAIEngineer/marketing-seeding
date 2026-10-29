import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, discoverUpdate } from "../src/update-discovery.mjs";

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
    assert.match(result.reason, /signed release required/i);
  } finally {
    if (prior === undefined) delete process.env.SEEDING_RELEASE_MANIFEST_URL; else process.env.SEEDING_RELEASE_MANIFEST_URL = prior;
    if (priorVersion === undefined) delete process.env.SEEDING_BUILD_VERSION; else process.env.SEEDING_BUILD_VERSION = priorVersion;
  }
});

test("version comparison is numeric and bounded", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.2", "0.3"), -1);
});

