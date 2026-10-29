import test from "node:test";
import assert from "node:assert/strict";
import { loginAccountWithCamoufox } from "../src/camoufox-account-login.mjs";
import { storeAccountCredentials, ACCOUNT_CREDENTIAL_SERVICE } from "../src/account-credentials.mjs";
import { execFileSync } from "node:child_process";

test("Camoufox login uses Keychain credentials and returns bounded success without secrets", async (t) => {
  if (process.platform !== "darwin") return;
  const cleanup = () => { for (const service of [ACCOUNT_CREDENTIAL_SERVICE, `${ACCOUNT_CREDENTIAL_SERVICE}.username`]) { try { execFileSync("security", ["delete-generic-password", "-a", "linkedin:camoufox-login-test", "-s", service], { stdio: "ignore" }); } catch {} } };
  cleanup();
  t.after(cleanup);
  await storeAccountCredentials({ platform: "linkedin", accountId: "camoufox-login-test", username: "login@example.test", password: "login-secret" });
  const calls = [];
  let submitted = false;
  const protocol = {
    async navigate(page, url) { calls.push(["navigate", page, url]); },
    async snapshot() { return submitted ? "Home Feed Profile Sign out" : "Sign in Password Email"; },
    async resolve(page, query) { const text = String(query); return text.includes("password") ? "pw" : text.includes("sign") ? "submit" : "user"; },
    async fill(page, ref, value) { calls.push(["fill", ref, value]); },
    async click(target) { submitted = true; calls.push(["click", target.ref]); }
  };
  const result = await loginAccountWithCamoufox({ platform: "linkedin", accountId: "camoufox-login-test", protocol, pageId: "page" });
  assert.equal(result.status, "READY");
  assert.equal(JSON.stringify(result).includes("password"), false);
});

test("Camoufox login blocks an unavailable challenge", async (t) => {
  if (process.platform !== "darwin") return;
  const cleanup = () => { for (const service of [ACCOUNT_CREDENTIAL_SERVICE, `${ACCOUNT_CREDENTIAL_SERVICE}.username`]) { try { execFileSync("security", ["delete-generic-password", "-a", "linkedin:any", "-s", service], { stdio: "ignore" }); } catch {} } };
  cleanup();
  t.after(cleanup);
  await storeAccountCredentials({ platform: "linkedin", accountId: "any", username: "login@example.test", password: "login-secret" });
  const protocol = { async navigate() {}, async snapshot() { return "Verify you are human CAPTCHA"; }, async resolve() {}, async fill() {}, async click() {} };
  const result = await loginAccountWithCamoufox({ platform: "linkedin", accountId: "any", protocol }).catch((error) => ({ status: "ERROR", code: error.code }));
  assert.deepEqual(result, { status: "BLOCKED", code: "ACCOUNT_SECURITY_CHALLENGE", reason: "login requires a factor not available from supplied credentials" });
});
