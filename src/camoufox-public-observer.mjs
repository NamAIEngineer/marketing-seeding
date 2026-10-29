import net from "node:net";
import { privateAddress, validatePublicUrl } from "./discovery-observer.mjs";

const MAX_TEXT = 8_000;
const MAX_LINKS = 64;
const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);

function safeText(value, limit = MAX_TEXT) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim().slice(0, limit);
}

function publicUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw Object.assign(new Error("Public observer URL is invalid"), { code: "OBSERVER_URL_INVALID" }); }
  if (!(["http:", "https:"].includes(url.protocol))) throw Object.assign(new Error("Public observer URL scheme is not allowed"), { code: "OBSERVER_URL_SCHEME" });
  if (url.username || url.password) throw Object.assign(new Error("Public observer URL must not contain credentials"), { code: "OBSERVER_URL_CREDENTIALS" });
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || (net.isIP(host) && privateAddress(host))) throw Object.assign(new Error("Public observer URL targets a private or reserved host"), { code: "OBSERVER_PRIVATE_DESTINATION" });
  return url.toString();
}

function unavailable(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isolatedTransport(transport) {
  return transport && transport.isolated === true && typeof transport.observePublic === "function";
}

function normalizeLinks(links, baseUrl) {
  if (!Array.isArray(links)) return [];
  const result = [];
  for (const value of links.slice(0, MAX_LINKS)) {
    try {
      const url = publicUrl(new URL(String(value), baseUrl).toString());
      if (!result.includes(url)) result.push(url);
    } catch { /* unsafe links are omitted from public evidence */ }
  }
  return result;
}

/** Observe one public URL through an explicitly isolated Camoufox transport. */
export async function observePublicWithCamoufox(url, { transport, now = new Date().toISOString(), maxText = MAX_TEXT, lookup, timeoutMs } = {}) {
  const observedUrl = (await validatePublicUrl(url, { lookup, timeoutMs })).toString();
  if (!transport) return { state: "UNAVAILABLE", code: "OBSERVER_TRANSPORT_UNAVAILABLE", observedUrl, externalSideEffects: false };
  if (!isolatedTransport(transport)) return { state: "UNAVAILABLE", code: "OBSERVER_ISOLATION_REQUIRED", observedUrl, externalSideEffects: false };
  try {
    const payload = await transport.observePublic(observedUrl);
    if (!payload || typeof payload !== "object") return { state: "UNKNOWN", code: "OBSERVER_EMPTY_RESULT", observedUrl, externalSideEffects: false };
    const resultUrl = (await validatePublicUrl(payload.url || observedUrl, { lookup, timeoutMs })).toString();
    return {
      state: "OBSERVED",
      code: "PUBLIC_OBSERVATION_CAPTURED",
      observedAt: safeText(now, 64),
      observedUrl: resultUrl,
      title: safeText(payload.title, 240),
      text: safeText(payload.text, Math.min(MAX_TEXT, Math.max(1, Number(maxText) || MAX_TEXT))),
      links: normalizeLinks(payload.links, resultUrl),
      runtime: { provider: "camoufox", transport: safeText(transport.transportId || "camoufox", 80), profileReference: safeText(transport.profileReference, 160) },
      publication: { status: "NOT_EVALUATED", postId: null, permalink: null },
      externalSideEffects: false
    };
  } catch (error) {
    return { state: "UNKNOWN", code: safeText(error?.code || "OBSERVER_FAILED", 80), observedUrl, externalSideEffects: false };
  }
}

export async function validatePublicObserverUrl(value, options = {}) {
  return (await validatePublicUrl(value, options)).toString();
}
