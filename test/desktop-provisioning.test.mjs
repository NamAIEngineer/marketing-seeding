import assert from "node:assert/strict";
import test from "node:test";
import { readDesktopProvisioningStatus } from "../src/desktop-provisioning.mjs";

test("desktop provisioning projection exposes truthful first-run markers without secret content", async () => {
  const files = new Map([
    ["/runtime/9router-provision-status", "ready\n"],
    ["/runtime/camoufox-provision-status", "unavailable:npm_missing\n"]
  ]);
  const result = await readDesktopProvisioningStatus("/runtime", {
    readFileImpl: async (file) => {
      if (!files.has(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files.get(file);
    },
    accessImpl: async (file) => {
      if (!files.has(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
  });
  assert.equal(result.nineRouter.status, "ready");
  assert.equal(result.camoufox.status, "unavailable:npm_missing");
  assert.equal(result.camoufox.identityEvidence, "AUTHENTICATED_BROWSER_SURFACE_REQUIRED");
  assert.equal(JSON.stringify(result).includes("password"), false);
  assert.equal(JSON.stringify(result).includes("api-key"), false);
});

