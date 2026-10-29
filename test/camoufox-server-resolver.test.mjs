import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createExecutionSessionResolver } from "../src/camoufox-server-resolver.mjs";

test("server Camoufox resolver rejects missing authority and incomplete runtime configuration", async () => {
  await assert.rejects(() => createExecutionSessionResolver({ provider: "orca" }), { code: "CAMOUFOX_PROVIDER_REQUIRED" });
  await assert.rejects(() => createExecutionSessionResolver({ provider: "camoufox", profileReference: "p", hostAttestation: {} }), { code: "CAMOUFOX_SESSION_AUTHORITY_REQUIRED" });
});

test("server Camoufox resolver composes sanitized metadata without launching a browser", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-server-resolver-"));
  const registry = path.join(root, "accounts.json");
  await writeFile(registry, JSON.stringify({ accounts: [{
    platform: "linkedin", accountId: "account-1", provider: "camoufox",
    profileRef: "profile-1", providerProfileId: "profile-1",
    identityReference: "https://www.linkedin.com/in/member", sessionHealth: "unknown"
  }] }));
  const names = [
    "SEEDING_CAMOUFOX_ACCOUNT_REGISTRY_FILE", "SEEDING_CAMOUFOX_PROFILE_ROOT",
    "SEEDING_CAMOUFOX_RUNTIME_PATH", "SEEDING_CAMOUFOX_EXECUTABLE_PATH"
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.SEEDING_CAMOUFOX_ACCOUNT_REGISTRY_FILE = registry;
    process.env.SEEDING_CAMOUFOX_PROFILE_ROOT = path.join(root, "profiles");
    process.env.SEEDING_CAMOUFOX_RUNTIME_PATH = root;
    process.env.SEEDING_CAMOUFOX_EXECUTABLE_PATH = path.join(root, "camoufox");
    const resolver = await createExecutionSessionResolver({
      provider: "camoufox", profileReference: "profile-1", sessionAuthority: "authority-ref",
      hostAttestation: { host: "test", runtime: "camoufox", version: "156.0.1-beta.36", evidence: "smoke", expiresAt: "2999-01-01T00:00:00Z" }
    });
    assert.equal(resolver.provider, "camoufox");
    assert.equal(resolver.sessionAuthorityReference, "authority-ref");
    assert.equal(typeof resolver.resolve, "function");
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
