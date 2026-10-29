import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const execFileAsync = promisify(execFile);
const SERVICE = "ai.marketing-seeding.account-credential";
const SAFE_ID = /^[A-Za-z0-9._:@+-]{1,160}$/;

function accountKey(accountId, platform) {
  const raw = `${String(platform || "").trim().toLowerCase()}:${String(accountId || "").trim()}`;
  if (!SAFE_ID.test(raw)) throw new Error("account identity is invalid");
  return raw;
}

function secret(value, label) {
  const normalized = String(value || "");
  if (!normalized || normalized.length > 4096 || /[\u0000\r\n]/.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

export async function storeAccountCredentials({ accountId, platform, username, password }) {
  const account = accountKey(accountId, platform);
  const user = secret(username, "username");
  const pass = secret(password, "password");
  if (process.platform !== "darwin") throw new Error("macOS Keychain is required for account credential storage");
  await execFileAsync("security", ["add-generic-password", "-U", "-a", account, "-s", SERVICE, "-w", `${user}\u0000${pass}`], { timeout: 10_000, windowsHide: true });
  return { accountId: String(accountId), platform: String(platform), credentialStored: true, storage: "macOS Keychain", reference: createHash("sha256").update(account).digest("hex").slice(0, 24) };
}

export async function accountCredentialStatus({ accountId, platform }) {
  const account = accountKey(accountId, platform);
  if (process.platform !== "darwin") return { accountId: String(accountId), platform: String(platform), credentialStored: false, storage: "macOS Keychain", reason: "macOS Keychain unavailable" };
  try {
    await execFileAsync("security", ["find-generic-password", "-a", account, "-s", SERVICE], { timeout: 5_000, windowsHide: true });
    return { accountId: String(accountId), platform: String(platform), credentialStored: true, storage: "macOS Keychain", reference: createHash("sha256").update(account).digest("hex").slice(0, 24) };
  } catch { return { accountId: String(accountId), platform: String(platform), credentialStored: false, storage: "macOS Keychain", reason: "not_configured" }; }
}

export const ACCOUNT_CREDENTIAL_SERVICE = SERVICE;
