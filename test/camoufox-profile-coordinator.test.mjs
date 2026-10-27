import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultRuntimeMetadataPath, profileKey, readRuntimeMetadata } from "../src/camoufox-profile-coordinator.mjs";

test("Camoufox coordinator derives isolated profile keys and verified runtime metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-coordinator-test-"));
  const executable = path.join(root, "Camoufox.app", "Contents", "MacOS", "camoufox");
  const metadataPath = path.join(root, "version.json");
  await writeFile(metadataPath, JSON.stringify({ version: "156.0.1", build: "beta.36", sha256: "a".repeat(64) }));
  assert.equal(defaultRuntimeMetadataPath(executable), metadataPath);
  const metadata = await readRuntimeMetadata(executable);
  assert.equal(metadata.providerVersion, "156.0.1-beta.36");
  assert.equal(metadata.browserSha256, "a".repeat(64));
  assert.match(metadata.metadataReference, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(profileKey("linkedin:account-1"), profileKey("linkedin:account-2"));
  await assert.rejects(() => readRuntimeMetadata(executable, path.join(root, "missing.json")), { code: "CAMOUFOX_RUNTIME_METADATA_UNAVAILABLE" });
});
