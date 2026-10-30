import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/i;

const text = (value, limit = 240) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, limit);

function releaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function defaultInstallerPath({ resourcesDir = process.resourcesPath, env = process.env } = {}) {
  const configured = text(env.SEEDING_UPDATE_INSTALLER_PATH, 1_000);
  if (configured) return configured;
  return resourcesDir ? path.join(resourcesDir, "app", "update-macos.sh") : null;
}

function defaultAppPath({ env = process.env } = {}) {
  const configured = text(env.SEEDING_APP_PATH, 1_000);
  if (configured) return configured;
  if (process.platform !== "darwin") return null;
  // Bundled Node is Contents/Resources/bin/node; three parents reach the .app.
  return path.resolve(path.dirname(process.execPath), "../../..");
}

/**
 * Run the bundled updater only after discovery has verified the signed manifest.
 * The updater receives public release metadata only; credentials stay outside
 * its environment and arguments.
 */
export async function installDiscoveredUpdate(update, {
  installerPath = null,
  appPath = null,
  resourcesDir = process.resourcesPath,
  env = process.env,
  accessImpl = access,
  execFileImpl = execFileAsync,
  platform = process.platform,
  timeoutMs = 15 * 60_000
} = {}) {
  if (!update || update.installEligible !== true || update.automaticUpdates !== true) {
    return { attempted: false, status: "NOT_ELIGIBLE", reason: text(update?.reason || "signed installer gates are not satisfied") };
  }
  if (platform !== "darwin") return { attempted: false, status: "UNSUPPORTED_PLATFORM", reason: "macOS updater is only available on Darwin" };
  const url = releaseUrl(update.manifest?.downloadUrl);
  const sha256 = text(update.manifest?.sha256, 128).toLowerCase();
  if (!url || !SHA256.test(sha256)) return { attempted: false, status: "INVALID_RELEASE_METADATA", reason: "verified update is missing a safe HTTPS URL or SHA-256" };
  const installer = installerPath || defaultInstallerPath({ resourcesDir, env });
  const app = appPath || defaultAppPath({ env });
  if (!installer || !app) return { attempted: false, status: "INSTALLER_NOT_CONFIGURED", reason: "bundled macOS updater path is not configured" };
  try {
    await accessImpl(installer);
    await accessImpl(app);
  } catch {
    return { attempted: false, status: "INSTALLER_UNAVAILABLE", reason: "bundled macOS updater or app path is unavailable" };
  }
  try {
    // The updater needs only public release metadata plus basic process
    // context. Do not pass operator tokens, provider keys, cookies, session
    // material, or account credentials into a child process environment.
    const safeEnv = Object.fromEntries(Object.entries(env || {}).filter(([name]) =>
      !/(TOKEN|PASSWORD|SECRET|API[_-]?KEY|CREDENTIAL|COOKIE|SESSION)/i.test(name)
    ));
    const result = await execFileImpl(installer, [app], {
      timeout: timeoutMs,
      windowsHide: true,
      env: {
        ...safeEnv,
        SEEDING_RELEASE_URL: url,
        SEEDING_RELEASE_SHA256: sha256,
        SEEDING_UPDATE_INSTALLER_ENABLED: "true"
      }
    });
    return {
      attempted: true,
      status: "INSTALLED",
      reason: "signed update installed; relaunch is required to activate the new bundle",
      restartRequired: true,
      output: text(result?.stdout || "", 500)
    };
  } catch (error) {
    return {
      attempted: true,
      status: "FAILED",
      reason: "signed update installer failed; previous bundle remains the recovery target",
      failureCode: text(error?.code || "UPDATE_INSTALL_FAILED", 80),
      output: text(error?.stderr || "", 500)
    };
  }
}

export { defaultAppPath, defaultInstallerPath };
