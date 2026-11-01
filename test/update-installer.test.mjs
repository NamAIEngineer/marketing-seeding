import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installDiscoveredUpdate } from "../src/update-installer.mjs";

const release = {
  installEligible: true,
  automaticUpdates: true,
  manifest: { downloadUrl: "https://updates.example.test/release.zip", sha256: "a".repeat(64) }
};

test("installer refuses unsigned or ineligible discovery without invoking updater", async () => {
  let invoked = false;
  const result = await installDiscoveredUpdate({ ...release, automaticUpdates: false }, {
    platform: "darwin",
    execFileImpl: async () => { invoked = true; }
  });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.equal(invoked, false);
});

test("installer validates release metadata and invokes bundled updater without secrets in argv", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "seeding-update-installer-"));
  const installer = path.join(root, "update-macos.sh");
  const app = path.join(root, "Marketing Seeding OS.app");
  await writeFile(installer, "#!/bin/sh\n");
  await writeFile(app, "fixture");
  let invocation = null;
  const result = await installDiscoveredUpdate(release, {
    platform: "darwin",
    installerPath: installer,
    appPath: app,
    env: { SEEDING_OPERATOR_TOKEN: "must-not-propagate" },
    execFileImpl: async (...args) => { invocation = args; return { stdout: "updated\n" }; }
  });
  assert.equal(result.status, "INSTALLED");
  assert.equal(invocation[0], installer);
  assert.deepEqual(invocation[1], [app]);
  assert.equal(invocation[2].env.SEEDING_RELEASE_URL, release.manifest.downloadUrl);
  assert.equal(invocation[2].env.SEEDING_RELEASE_SHA256, release.manifest.sha256);
  assert.equal(invocation[2].env.SEEDING_OPERATOR_TOKEN, undefined);
  assert.equal(JSON.stringify(invocation).includes("must-not-propagate"), false);
  assert.equal(JSON.stringify(invocation[1]).includes("must-not-propagate"), false);
});

test("installer reports unavailable updater and never claims success", async () => {
  const result = await installDiscoveredUpdate(release, {
    platform: "darwin",
    installerPath: "/does/not/exist/update-macos.sh",
    appPath: "/does/not/exist/Marketing Seeding OS.app",
    accessImpl: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
  });
  assert.equal(result.status, "INSTALLER_UNAVAILABLE");
  assert.equal(result.attempted, false);
});

test("installer fails closed off macOS", async () => {
  const result = await installDiscoveredUpdate(release, { platform: "linux" });
  assert.equal(result.status, "UNSUPPORTED_PLATFORM");
  assert.equal(result.attempted, false);
});
