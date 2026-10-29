import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { profileKey } from "./camoufox-profile-coordinator.mjs";

const text = (value, limit = 500) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const unavailable = (code, reason, details = {}) => ({ state: "UNAVAILABLE", code, reason, ...details });

function runtimeVersion(metadata) {
  const version = text(metadata?.version, 80);
  const build = text(metadata?.build, 80);
  const sha256 = text(metadata?.sha256, 128).toLowerCase();
  if (!version || !build || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  return Object.freeze({ providerVersion: `${version}-${build}`, browserVersion: version, browserBuild: build, browserSha256: sha256 });
}

/** Read-only runtime/profile observation. Never grants identity or authority. */
export async function probeCamoufoxRuntime({ executablePath, metadataPath, profileRoot, profileReference } = {}) {
  const executable = path.resolve(text(executablePath));
  const metadata = path.resolve(text(metadataPath));
  const root = path.resolve(text(profileRoot));
  const reference = text(profileReference, 180);
  if (!text(executablePath)) return unavailable("CAMOUFOX_EXECUTABLE_UNCONFIGURED", "Camoufox executable path is not configured");
  if (!text(metadataPath)) return unavailable("CAMOUFOX_RUNTIME_METADATA_UNCONFIGURED", "Camoufox runtime metadata path is not configured");
  if (!text(profileRoot) || !reference) return unavailable("CAMOUFOX_PROFILE_BINDING_UNCONFIGURED", "Camoufox profile root/reference is not configured");
  let executableStat;
  try { executableStat = await stat(executable); } catch { return unavailable("CAMOUFOX_EXECUTABLE_UNAVAILABLE", "Camoufox executable is unavailable", { executable }); }
  if (!executableStat.isFile()) return unavailable("CAMOUFOX_EXECUTABLE_INVALID", "Camoufox executable is not a file", { executable });
  let parsed;
  try { parsed = JSON.parse(await readFile(metadata, "utf8")); } catch { return unavailable("CAMOUFOX_RUNTIME_METADATA_UNAVAILABLE", "Camoufox runtime metadata is unavailable", { metadata }); }
  const runtime = runtimeVersion(parsed);
  if (!runtime) return unavailable("CAMOUFOX_RUNTIME_METADATA_INVALID", "Camoufox runtime metadata is invalid", { metadata });
  const profilePath = path.join(root, profileKey(reference));
  try { await access(profilePath); } catch { return unavailable("CAMOUFOX_PROFILE_UNAVAILABLE", "Camoufox profile directory is unavailable", { profileReference: reference }); }
  return { state: "UNKNOWN", code: "CAMOUFOX_SESSION_NOT_OBSERVED", reason: "official runtime and isolated profile are present; authenticated identity requires the live protocol observer", observedProviderVersion: runtime.providerVersion, executable, metadata, profileReference: reference, profileBindingRequired: true, sessionObserved: false, authorityObserved: false };
}

export default probeCamoufoxRuntime;
