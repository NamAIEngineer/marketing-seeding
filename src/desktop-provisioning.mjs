import { access, readFile } from "node:fs/promises";
import path from "node:path";

const text = (value, limit = 240) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, limit);

async function readStatus(root, name, readFileImpl) {
  try {
    const value = text(await readFileImpl(path.join(root, name), "utf8"), 160);
    return value || "UNKNOWN";
  } catch (error) {
    return error?.code === "ENOENT" ? "NOT_STARTED" : "UNKNOWN";
  }
}

async function fileExists(file, accessImpl) {
  try { await accessImpl(file); return true; } catch { return false; }
}

/**
 * Read only the bounded first-run runtime markers written by the desktop
 * launcher. These files contain status labels and paths, never credentials,
 * API keys, browser cookies, or raw process output.
 */
export async function readDesktopProvisioningStatus(dataRoot, { readFileImpl = readFile, accessImpl = access } = {}) {
  const root = path.resolve(String(dataRoot || process.cwd()));
  const [nineRouterStatus, camoufoxStatus, nineRouterLog, camoufoxConfig] = await Promise.all([
    readStatus(root, "9router-provision-status", readFileImpl),
    readStatus(root, "camoufox-provision-status", readFileImpl),
    fileExists(path.join(root, "9router.log"), accessImpl),
    fileExists(path.join(root, "camoufox-runtime.json"), accessImpl)
  ]);
  return {
    nineRouter: {
      expectedVersion: "0.5.109",
      status: nineRouterStatus,
      runningLogPresent: nineRouterLog,
      connectRequired: true,
      providerLogin: "USER_OWNED_IN_9ROUTER"
    },
    camoufox: {
      expectedVersion: "0.5.8",
      status: camoufoxStatus,
      runtimeConfigPresent: camoufoxConfig,
      accountAgentMode: "AUTO_PROVISIONED_PER_ACCOUNT",
      identityEvidence: "AUTHENTICATED_BROWSER_SURFACE_REQUIRED"
    },
    dataRoot: root,
    durableStateOutsideBundle: true,
    observedAt: new Date().toISOString()
  };
}

