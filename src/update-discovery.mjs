import { createHash } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 4_000;
const text = (value, limit = 240) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, limit);

function currentVersion() {
  return text(process.env.SEEDING_BUILD_VERSION || "0.3.0", 80);
}

function compareVersions(left, right) {
  const a = String(left || "0").split(".").map((value) => Number.parseInt(value, 10) || 0);
  const b = String(right || "0").split(".").map((value) => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function manifestUrl() {
  const value = text(process.env.SEEDING_RELEASE_MANIFEST_URL, 2_000);
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("release manifest must be an HTTPS URL without credentials");
  return parsed.toString();
}

function normalizeManifest(payload, url) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("release manifest must be a JSON object");
  const version = text(payload.version || payload.latestVersion, 80);
  const downloadUrl = text(payload.downloadUrl || payload.url, 2_000);
  const sha256 = text(payload.sha256 || payload.sha256Hex, 128).toLowerCase();
  const signature = text(payload.signature || payload.signatureBase64, 4_000);
  if (!version || !downloadUrl || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("release manifest requires version, HTTPS downloadUrl and SHA-256");
  const parsed = new URL(downloadUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("release download URL must be HTTPS without credentials");
  return { schemaVersion: 1, version, downloadUrl: parsed.toString(), sha256, signature: signature || null, manifestUrl: url, publishedAt: text(payload.publishedAt, 80) || null, notes: text(payload.notes, 500) || null, manifestDigest: createHash("sha256").update(JSON.stringify({ version, downloadUrl: parsed.toString(), sha256, signature: signature || null })).digest("hex") };
}

export async function discoverUpdate({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = manifestUrl();
  const current = currentVersion();
  if (!url) return { status: "NOT_CONFIGURED", currentVersion: current, checkedAt: new Date().toISOString(), manifest: null, updateAvailable: false, automaticUpdates: false, reason: "release manifest URL is not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
    const body = await response.text();
    if (!response.ok) return { status: "UNAVAILABLE", currentVersion: current, checkedAt: new Date().toISOString(), manifest: null, updateAvailable: false, automaticUpdates: true, reason: `release manifest HTTP ${response.status}` };
    const manifest = normalizeManifest(JSON.parse(body), url);
    return { status: "READY", currentVersion: current, checkedAt: new Date().toISOString(), manifest, updateAvailable: compareVersions(manifest.version, current) > 0, automaticUpdates: true, signatureVerified: false, reason: manifest.signature ? "signed manifest received; signature verification delegated to updater" : "manifest checksum received; signed release required before install" };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "TIMEOUT" : "UNAVAILABLE", currentVersion: current, checkedAt: new Date().toISOString(), manifest: null, updateAvailable: false, automaticUpdates: true, reason: text(error?.message || "release manifest unavailable") };
  } finally { clearTimeout(timer); }
}

export { compareVersions };
