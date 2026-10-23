import test from "node:test";
import assert from "node:assert/strict";
import { projectSessionReadiness, sessionProfileFingerprint } from "../src/session-readiness-projection.mjs";

const now = "2026-10-23T00:00:00.000Z";
const account = { platform: "linkedin", accountId: "acct-1", profileRef: "profile-1", sessionHealth: "healthy" };

test("exact healthy observed binding is execution eligible", () => {
  const result = projectSessionReadiness([account], [{ platform: "linkedin", accountId: "acct-1", profileRef: "profile-1", state: "healthy", checkedAt: now, expiresAt: "2026-10-23T01:00:00Z" }], { now });
  assert.equal(result.rows[0].status, "READY"); assert.equal(result.rows[0].executionEligible, true);
  assert.equal(result.rows[0].profileFingerprint, sessionProfileFingerprint("profile-1"));
});

test("missing or mismatched observation fails closed", () => {
  const result = projectSessionReadiness([account, { ...account, accountId: "acct-2", profileRef: "profile-2" }], [{ platform: "linkedin", accountId: "acct-1", profileRef: "other", state: "healthy" }], { now });
  assert.equal(result.rows[0].status, "MISMATCH"); assert.equal(result.rows[0].executionEligible, false);
  assert.equal(result.rows[1].status, "UNKNOWN");
});

test("challenge, expiry and quarantine are projected without mutation", () => {
  const result = projectSessionReadiness([
    account,
    { ...account, accountId: "acct-2", profileRef: "profile-2", sessionHealth: "mfa_required" },
    { ...account, accountId: "acct-3", profileRef: "profile-3", risk: "quarantined" },
    { ...account, accountId: "acct-4", profileRef: "profile-4" }
  ], [
    { platform: "linkedin", accountId: "acct-1", profileRef: "profile-1", state: "healthy", expiresAt: "2026-10-22T00:00:00Z" },
    { platform: "linkedin", accountId: "acct-2", profileRef: "profile-2", state: "mfa_required" },
    { platform: "linkedin", accountId: "acct-3", profileRef: "profile-3", state: "healthy" },
    { platform: "linkedin", accountId: "acct-4", profileRef: "profile-4", state: "healthy", expiresAt: "2026-10-23T01:00:00Z" }
  ], { now });
  assert.deepEqual(result.rows.map((r) => r.status), ["EXPIRED", "CHALLENGE", "QUARANTINED", "READY"]);
  assert.equal(result.readOnly, true);
});

test("missing or invalid readiness expiry fails closed", () => {
  const result = projectSessionReadiness([account, { ...account, accountId: "acct-2", profileRef: "profile-2" }], [
    { platform: "linkedin", accountId: "acct-1", profileRef: "profile-1", state: "healthy" },
    { platform: "linkedin", accountId: "acct-2", profileRef: "profile-2", state: "healthy", expiresAt: "not-a-date" }
  ], { now });
  assert.deepEqual(result.rows.map((row) => [row.status, row.executionEligible, row.reasons]), [
    ["EXPIRED", false, ["readiness_expiry_invalid"]],
    ["EXPIRED", false, ["readiness_expiry_invalid"]]
  ]);
});

test("secret-like metadata is rejected", () => { assert.throws(() => projectSessionReadiness([{ ...account, cookie: "x" }]), /secret-like/); });
