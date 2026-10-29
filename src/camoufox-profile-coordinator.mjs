import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CamoufoxPlaywrightProtocolClient } from "./camoufox-playwright-protocol.mjs";

const SECRET_KEY = /(password|passwd|cookie|token|secret|credential|mfa|passkey|session|authorization|privatekey|accesskey)/i;
const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const fail = (code, message) => Object.assign(new Error(message), { code });

// Camoufox's launcher may initialize a shared fingerprint model. Serializing
// launch calls avoids concurrent initialization deadlocks while keeping each
// profile's own lock as the single-writer boundary.
let launchTail = Promise.resolve();

function withLaunchSlot(operation) {
  const previous = launchTail;
  let release;
  launchTail = new Promise((resolve) => { release = resolve; });
  const result = previous
    .catch(() => undefined)
    .then(operation);
  // Keep the slot until the underlying launcher settles, even when the
  // caller's bounded timeout has already returned. This prevents a late
  // browser creation from overlapping the next profile launch.
  launchTail = result.then(() => undefined, () => undefined).finally(() => release());
  return result;
}

function boundedLaunch(operation, timeoutMs, onLateContext) {
  const limit = Math.max(1_000, Number(timeoutMs) || 45_000);
  let timer;
  let settled = false;
  const launch = Promise.resolve().then(operation).then((context) => {
    if (settled && context && typeof onLateContext === "function") {
      Promise.resolve(onLateContext(context)).catch(() => undefined);
    }
    return context;
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      settled = true;
      reject(fail("CAMOUFOX_LAUNCH_TIMEOUT", `Camoufox launch exceeded ${limit}ms`));
    }, limit);
    timer.unref?.();
  });
  return Promise.race([launch, timeout]).finally(() => {
    clearTimeout(timer);
    settled = true;
  });
}

function rejectSecrets(value, pathName = "options", depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw fail("CAMOUFOX_SECRET_FIELD", `${pathName}.${key} is not accepted`);
    if (typeof child === "string" && /bearer\s+|cookie\s*=|access[_ -]?token|session[_ -]?token/i.test(child)) {
      throw fail("CAMOUFOX_SECRET_VALUE", `${pathName}.${key} is not accepted`);
    }
    if (child && typeof child === "object" && !(child instanceof Function)) rejectSecrets(child, `${pathName}.${key}`, depth + 1);
  }
}

function profileKey(value) {
  const normalized = text(value, 180);
  if (!normalized) throw fail("CAMOUFOX_PROFILE_REFERENCE_REQUIRED", "Camoufox profile reference is required");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

function defaultRuntimeMetadataPath(executablePath) {
  // Official macOS bundles place version.json beside the browser bundle,
  // four parents above Contents/MacOS/<executable>.
  const root = path.dirname(path.dirname(path.dirname(path.dirname(path.resolve(String(executablePath))))));
  return path.join(root, "version.json");
}

async function readRuntimeMetadata(executablePath, configuredPath = null) {
  const metadataPath = configuredPath ? path.resolve(String(configuredPath)) : defaultRuntimeMetadataPath(executablePath);
  let value;
  try {
    value = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {
    throw fail("CAMOUFOX_RUNTIME_METADATA_UNAVAILABLE", "Camoufox runtime version metadata is unavailable");
  }
  const browserVersion = text(value?.version, 80);
  const browserBuild = text(value?.build, 80);
  const sha256 = text(value?.sha256, 128).toLowerCase();
  if (!browserVersion || !browserBuild || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw fail("CAMOUFOX_RUNTIME_METADATA_INVALID", "Camoufox runtime version metadata is incomplete");
  }
  return Object.freeze({
    providerVersion: `${browserVersion}-${browserBuild}`,
    browserVersion,
    browserBuild,
    browserSha256: sha256,
    metadataReference: `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
  });
}

async function createExclusiveLock(lockPath, staleMs) {
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8");
    return handle;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const metadata = JSON.parse(await readFile(lockPath, "utf8"));
      const ownerPid = Number(metadata.pid);
      if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
        try { process.kill(ownerPid, 0); throw fail("CAMOUFOX_PROFILE_BUSY", "Camoufox profile is owned by another process"); } catch (probeError) {
          if (probeError.code === "CAMOUFOX_PROFILE_BUSY") throw probeError;
        }
      }
      const info = await stat(lockPath);
      if (Date.now() - info.mtimeMs < staleMs) throw fail("CAMOUFOX_PROFILE_BUSY", "Camoufox profile lock is active");
      await rm(lockPath, { force: true });
    } catch (readError) {
      if (readError.code === "CAMOUFOX_PROFILE_BUSY") throw readError;
      // A lock with unreadable metadata is not safe to steal until it ages out.
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs < staleMs) throw fail("CAMOUFOX_PROFILE_BUSY", "Camoufox profile lock is active");
        await rm(lockPath, { force: true });
      } catch (statError) {
        if (statError.code === "CAMOUFOX_PROFILE_BUSY") throw statError;
        throw fail("CAMOUFOX_PROFILE_BUSY", "Camoufox profile lock cannot be inspected");
      }
    }
    return createExclusiveLock(lockPath, staleMs);
  }
}

/** Owns one durable Camoufox persistent profile at a time. */
export class CamoufoxProfileCoordinator {
  #config;
  #leases = new Map();

  constructor({ profileRoot, runtimePath, executablePath, runtimeMetadataPath = null, headless = true, launchOptions = {}, staleLockMs = 10 * 60 * 1000, launchTimeoutMs = 45_000, clock = () => new Date() } = {}) {
    rejectSecrets({ profileRoot, runtimePath, executablePath, runtimeMetadataPath, headless, launchOptions, staleLockMs, launchTimeoutMs });
    if (!profileRoot || !runtimePath || !executablePath) throw fail("CAMOUFOX_COORDINATOR_CONFIG_REQUIRED", "profileRoot, runtimePath and executablePath are required");
    this.#config = Object.freeze({
      profileRoot: path.resolve(String(profileRoot)), runtimePath: path.resolve(String(runtimePath)), executablePath: path.resolve(String(executablePath)),
      runtimeMetadataPath: runtimeMetadataPath ? path.resolve(String(runtimeMetadataPath)) : null,
      headless: headless !== false, launchOptions: { ...launchOptions }, staleLockMs: Math.max(1_000, Number(staleLockMs) || 600_000),
      launchTimeoutMs: Math.max(1_000, Number(launchTimeoutMs) || 45_000), clock
    });
  }

  profilePath(profileReference) { return path.join(this.#config.profileRoot, profileKey(profileReference)); }
  profileFingerprint(profileReference) { return `sha256:${createHash("sha256").update(text(profileReference, 180)).digest("hex")}`; }
  metadataPath(profileReference) { return path.join(this.profilePath(profileReference), "profile-runtime.json"); }

  async readMetadata(profileReference) {
    try { return JSON.parse(await readFile(this.metadataPath(profileReference), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async #writeMetadata(profileReference, metadata) {
    await writeFile(this.metadataPath(profileReference), `${JSON.stringify(metadata)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(this.metadataPath(profileReference), 0o600);
  }

  async acquire({ provider = "camoufox", platform, accountId, profileReference, providerProfileId, identityReference, expectedIdentityUrl } = {}) {
    if (String(provider).toLowerCase() !== "camoufox") return { ready: false, status: "NOT_READY", code: "CAMOUFOX_PROVIDER_REQUIRED" };
    const profile = text(profileReference || providerProfileId, 180);
    if (!profile || !text(platform) || !text(accountId)) return { ready: false, status: "NOT_READY", code: "CAMOUFOX_PROFILE_BINDING_REQUIRED" };
    if (providerProfileId && text(providerProfileId, 180) !== profile) return { ready: false, status: "NOT_READY", code: "CAMOUFOX_PROFILE_BINDING_MISMATCH" };
    if (this.#leases.has(profile)) return { ready: false, status: "NOT_READY", code: "CAMOUFOX_PROFILE_BUSY" };
    const profileDir = this.profilePath(profile);
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    const lockPath = path.join(profileDir, ".profile.lock");
    const lock = await createExclusiveLock(lockPath, this.#config.staleLockMs);
    let context;
    try {
      const runtime = await readRuntimeMetadata(this.#config.executablePath, this.#config.runtimeMetadataPath);
      const moduleUrl = pathToFileURL(path.join(this.#config.runtimePath, "node_modules/camoufox/dist/index.js")).href;
      const { Camoufox } = await import(moduleUrl);
      const launch = () => Camoufox({
        ...this.#config.launchOptions,
        headless: this.#config.headless,
        executable_path: this.#config.executablePath,
        user_data_dir: profileDir
      });
      context = await boundedLaunch(() => withLaunchSlot(launch), this.#config.launchTimeoutMs, (lateContext) => lateContext.close?.());
      const lease = {
        profileReference: profile,
        profileDir,
        profileFingerprint: this.profileFingerprint(profile),
        platform: text(platform).toLowerCase(), accountId: text(accountId),
        identityReference: text(identityReference || expectedIdentityUrl, 400) || null,
        context, lock, released: false,
        runtimeIdentity: { provider: "camoufox", transport: "camoufox-execution", ...runtime, profileReference: profile }
      };
      await this.#writeMetadata(profile, {
        schemaVersion: 1,
        provider: "camoufox",
        platform: lease.platform,
        accountId: lease.accountId,
        profileFingerprint: lease.profileFingerprint,
        identityReference: lease.identityReference,
        runtimeIdentity: lease.runtimeIdentity,
        // A lease proves isolated browser ownership only. Authentication and
        // platform identity remain UNKNOWN until protocol observation passes.
        status: "LEASED",
        lastAcquiredAt: this.#config.clock().toISOString(),
        lastReleasedAt: null,
        sessionHealth: "UNKNOWN"
      });
      this.#leases.set(profile, lease);
      return { ready: true, status: "LEASED", handle: Object.freeze({ profileReference: profile, profileFingerprint: lease.profileFingerprint, runtimeIdentity: lease.runtimeIdentity }) };
    } catch (error) {
      if (context) await context.close().catch(() => undefined);
      await lock.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  contextFor(profileReference) {
    const lease = this.#leases.get(text(profileReference, 180));
    if (!lease || lease.released) throw fail("CAMOUFOX_PROFILE_NOT_ACQUIRED", "Camoufox profile is not acquired");
    return lease.context;
  }

  protocolFactory({ mutationExpressionHashes = null } = {}) {
    return async ({ profileReference, expectedIdentity, runtimeIdentity } = {}) => {
      const lease = this.#leases.get(text(profileReference, 180));
      if (!lease || lease.released) throw fail("CAMOUFOX_PROFILE_NOT_ACQUIRED", "Camoufox profile is not acquired");
      return new CamoufoxPlaywrightProtocolClient({
        context: lease.context,
        profileReference: lease.profileReference,
        expectedIdentity: expectedIdentity || { provider: "camoufox", platform: lease.platform, accountId: lease.accountId, identityReference: lease.identityReference },
        runtimeIdentity: runtimeIdentity || lease.runtimeIdentity,
        mutationExpressionHashes
      });
    };
  }

  async release(handle) {
    const profile = text(handle?.profileReference, 180);
    const lease = this.#leases.get(profile);
    if (!lease) return { released: false, status: "FOREIGN_HANDLE" };
    if (lease.released) return { released: true, status: "ALREADY_RELEASED" };
    lease.released = true;
    this.#leases.delete(profile);
    await lease.context?.close().catch(() => undefined);
    const existing = await this.readMetadata(profile).catch(() => null);
    await this.#writeMetadata(profile, {
      ...(existing || {}),
      schemaVersion: 1,
      provider: "camoufox",
      profileFingerprint: lease.profileFingerprint,
      status: "RELEASED",
      lastReleasedAt: this.#config.clock().toISOString()
    });
    await lease.lock?.close().catch(() => undefined);
    await rm(path.join(lease.profileDir, ".profile.lock"), { force: true }).catch(() => undefined);
    return { released: true, status: "RELEASED" };
  }

  async closeAll() {
    for (const lease of [...this.#leases.values()]) await this.release({ profileReference: lease.profileReference });
  }
}

export { profileKey };
export { readRuntimeMetadata, defaultRuntimeMetadataPath };
export default CamoufoxProfileCoordinator;
