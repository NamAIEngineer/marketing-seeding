import test from "node:test";
import assert from "node:assert/strict";
import { projectGpmSessionCapability } from "../src/gpm-session-capability-projection.mjs";

const base = {
  provider: "gpm", configured: true,
  runtimeIdentity: { provider: "gpm", transport: "gpm-chrome", providerVersion: "5.1" },
  health: { state: "READY" },
  sessions: [{ profileFingerprint: "fp-a", health: "READY" }]
};

test("unavailable when provider is not configured", () => {
  const result = projectGpmSessionCapability({ ...base, configured: false });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.executionEligible, false);
});

test("unknown health fails closed", () => {
  const result = projectGpmSessionCapability({ ...base, health: { state: "UNKNOWN" } });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.counts.unknown, 0);
});

test("challenge health is surfaced without eligibility", () => {
  const result = projectGpmSessionCapability({ ...base, health: { state: "CHALLENGE" } });
  assert.equal(result.status, "CHALLENGE");
  assert.equal(result.reason, "HUMAN_ACTION_REQUIRED");
  assert.equal(result.executionEligible, false);
});

test("exact configured provider and healthy runtime are available", () => {
  const result = projectGpmSessionCapability({ ...base, sessions: [
    { profileFingerprint: "fp-a", health: "READY" },
    { profileFingerprint: "fp-a", health: "READY" },
    { profileFingerprint: "fp-b", health: "HEALTHY" }
  ] });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.executionEligible, true);
  assert.equal(result.counts.profileFingerprints, 2);
  assert.equal(result.counts.sessions, 3);
  assert.equal(result.authoritySideEffects, false);
});

test("serialization excludes profile IDs and secret-like material", () => {
  const result = projectGpmSessionCapability({ ...base, profileId: "raw-profile", token: "secret-token" });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("raw-profile"), false);
  assert.equal(serialized.includes("secret-token"), false);
  assert.equal(serialized.includes("profileFingerprint"), true);
});
