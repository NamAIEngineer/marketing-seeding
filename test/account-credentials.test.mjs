import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accountCredentialStatus, readAccountCredentials, storeAccountCredentials, ACCOUNT_CREDENTIAL_SERVICE } from "../src/account-credentials.mjs";

const account = { platform: "test-platform", accountId: "marketing-seeding-keychain-test" };
const keychainAccount = `${account.platform}:${account.accountId}`;
function cleanup() {
  for (const service of [ACCOUNT_CREDENTIAL_SERVICE, `${ACCOUNT_CREDENTIAL_SERVICE}.username`]) {
    try { execFileSync("security", ["delete-generic-password", "-a", keychainAccount, "-s", service], { stdio: "ignore" }); } catch {}
  }
}

test("macOS Keychain stores, reads, rotates and reports bounded account credentials", async (t) => {
  if (process.platform !== "darwin") return t.skip("macOS Keychain required");
  cleanup();
  t.after(cleanup);
  assert.equal((await accountCredentialStatus(account)).credentialStored, false);
  const first = await storeAccountCredentials({ ...account, username: "first@example.test", password: "first-secret" });
  assert.equal(first.credentialStored, true);
  assert.deepEqual(await readAccountCredentials(account), { username: "first@example.test", password: "first-secret" });
  assert.equal((await accountCredentialStatus(account)).credentialStored, true);
  await storeAccountCredentials({ ...account, username: "rotated@example.test", password: "rotated-secret" });
  assert.deepEqual(await readAccountCredentials(account), { username: "rotated@example.test", password: "rotated-secret" });
  const status = await accountCredentialStatus(account);
  assert.deepEqual(Object.keys(status).sort(), ["accountId", "credentialStored", "platform", "reference", "storage"].sort());
  assert.equal(JSON.stringify(status).includes("secret"), false);
});
