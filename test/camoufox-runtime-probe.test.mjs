import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeCamoufoxRuntime } from "../src/camoufox-runtime-probe.mjs";
import { profileKey } from "../src/camoufox-profile-coordinator.mjs";

test("host probe separates installed runtime from authenticated session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-runtime-probe-"));
  const executable = path.join(root, "camoufox"); const metadata = path.join(root, "version.json"); const profileRoot = path.join(root, "profiles"); const profileReference = "linkedin:account-1";
  await mkdir(path.join(profileRoot, profileKey(profileReference)), { recursive: true });
  await writeFile(executable, "#!/bin/sh\nexit 0\n"); await chmod(executable, 0o700);
  await writeFile(metadata, JSON.stringify({ version: "156.0.1", build: "beta.36", sha256: "a".repeat(64) }));
  const result = await probeCamoufoxRuntime({ executablePath: executable, metadataPath: metadata, profileRoot, profileReference });
  assert.equal(result.state, "UNKNOWN"); assert.equal(result.code, "CAMOUFOX_SESSION_NOT_OBSERVED"); assert.equal(result.observedProviderVersion, "156.0.1-beta.36"); assert.equal(result.sessionObserved, false); assert.equal(result.authorityObserved, false);
});

test("host probe fails closed when executable is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-runtime-probe-missing-"));
  const result = await probeCamoufoxRuntime({ executablePath: path.join(root, "missing-camoufox"), metadataPath: path.join(root, "version.json"), profileRoot: path.join(root, "profiles"), profileReference: "linkedin:account-1" });
  assert.equal(result.state, "UNAVAILABLE"); assert.equal(result.code, "CAMOUFOX_EXECUTABLE_UNAVAILABLE");
});
