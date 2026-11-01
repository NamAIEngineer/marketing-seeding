import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const execFileAsync = promisify(execFile);
function securityPrompt(args, input, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn("security", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Keychain operation timed out")); }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(stderr.trim() || `security exited ${code}`)); });
    child.stdin.end(input);
  });
}
const SERVICE = "ai.marketing-seeding.account-credential";
const USER_SERVICE = `${SERVICE}.username`;
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
  const add = async (service, value) => securityPrompt(["add-generic-password", "-U", "-a", account, "-s", service, "-w"], `${value}\n${value}\n`);
  await add(USER_SERVICE, user);
  await add(SERVICE, pass);
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

/** Internal runtime-only read. Never serialize or return this object from an API route. */
export async function readAccountCredentials({ accountId, platform }) {
  const account = accountKey(accountId, platform);
  if (process.platform !== "darwin") throw new Error("macOS Keychain is required for account credential access");
  const read = async (service) => {
    const result = await execFileAsync("security", ["find-generic-password", "-w", "-a", account, "-s", service], { timeout: 5_000, windowsHide: true });
    return secret(String(result.stdout || "").trim(), "stored credential");
  };
  return { username: await read(USER_SERVICE), password: await read(SERVICE) };
}
