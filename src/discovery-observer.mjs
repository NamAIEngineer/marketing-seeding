import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

const DEFAULTS = Object.freeze({ maxUrls: 20, maxBytes: 256_000, maxText: 12_000, maxRedirects: 3, timeoutMs: 8_000 });
const PUBLIC_TYPES = new Set(["text/html", "text/plain", "application/xhtml+xml"]);
const FEED_TYPES = new Set(["application/rss+xml", "application/atom+xml", "application/xml", "text/xml"]);

function privateAddress(address) {
  const normalized = String(address).toLowerCase();
  const family = net.isIP(normalized);
  if (family === 4 || family === 6 && normalized.startsWith("::ffff:")) {
    const ipv4 = family === 4 ? normalized : normalized.slice("::ffff:".length);
    if (net.isIP(ipv4) !== 4) return true;
    const parts = ipv4.split(".").map(Number);
    const value = (BigInt(parts[0]) << 24n) | (BigInt(parts[1]) << 16n) | (BigInt(parts[2]) << 8n) | BigInt(parts[3]);
    const inRange = (network, prefix) => {
      const [a, b, c, d] = network.split(".").map(Number);
      const base = (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d);
      return (value >> BigInt(32 - prefix)) === (base >> BigInt(32 - prefix));
    };
    // IANA special-purpose, private, link-local, documentation, benchmark,
    // multicast and reserved-for-future-use IPv4 ranges.
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
      ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
    ].some(([network, prefix]) => inRange(network, prefix));
  }
  if (family !== 6 || normalized.includes("%")) return true;
  const words = normalized.split("::");
  if (words.length > 2) return true;
  const left = words[0] ? words[0].split(":") : [];
  const right = words.length === 2 && words[1] ? words[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (words.length === 1 && missing !== 0 || words.length === 2 && missing < 1) return true;
  const full = [...left, ...Array(missing).fill("0"), ...right];
  if (full.length !== 8 || full.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return true;
  const value = full.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
  const inRange = (network, prefix) => {
    const base = network.split(":").reduce((result, part) => (result << 16n) | BigInt(`0x${part || "0"}`), 0n);
    return (value >> BigInt(128 - prefix)) === (base >> BigInt(128 - prefix));
  };
  // Only global-unicast space is eligible. Exclude documentation, benchmarking,
  // 6to4 transition and reserved-for-example ranges.
  return !inRange("2000:0:0:0:0:0:0:0", 3) || inRange("2001:db8:0:0:0:0:0:0", 32) ||
    inRange("2001:2:0:0:0:0:0:0", 48) || inRange("2002:0:0:0:0:0:0:0", 16) ||
    inRange("3fff:0:0:0:0:0:0:0", 20);
}

function normalizedHostname(url) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

async function resolveWithTimeout(lookup, hostname, timeoutMs) {
  let timer;
  const lookupPromise = Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true }));
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS lookup timeout")), timeoutMs);
  });
  try {
    return await Promise.race([lookupPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePublicUrl(raw, { lookup = dns.lookup, timeoutMs = DEFAULTS.timeoutMs } = {}) {
  let url;
  try { url = new URL(String(raw)); } catch { throw new Error("invalid URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported URL scheme");
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  const hostname = normalizedHostname(url);
  if (!hostname) throw new Error("URL hostname is required");
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULTS.timeoutMs;
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await resolveWithTimeout(lookup, hostname, boundedTimeout);
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("private or reserved destination is not allowed");
  return { url, address: addresses[0] };
}

export async function validatePublicUrl(raw, options = {}) {
  return (await resolvePublicUrl(raw, options)).url;
}

function pinnedFetch(url, address, { signal, timeoutMs = DEFAULTS.timeoutMs } = {}) {
  const requester = url.protocol === "https:" ? https : http;
  const hostname = normalizedHostname(url);
  return new Promise((resolve, reject) => {
    const request = requester.request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      agent: false,
      headers: { accept: "text/html, text/plain, application/xhtml+xml;q=0.9", "user-agent": "marketing-seeding-discovery/1.0" },
      lookup: (_hostname, options, callback) => {
        if (typeof options === "function") callback = options;
        const family = address.family || net.isIP(address.address);
        if (options?.all) callback(null, [{ address: address.address, family }]);
        else callback(null, address.address, family);
      },
      signal
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name, String(item));
      }
      const status = response.statusCode || 0;
      resolve({ status, ok: status >= 200 && status < 300, headers, body: Readable.toWeb(response) });
    });
    request.once("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("request timeout")));
    request.end();
  });
}

function redact(value) {
  return String(value || "").replace(/(bearer\s+|password|secret|token|cookie|authorization|api[_-]?key|session)\s*[=:]?\s*[^\s]+/gi, "$1credential/session material exists");
}

function htmlText(body) {
  const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, "");
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return { title, text };
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isFinite(number) ? String.fromCodePoint(Math.min(number, 0x10ffff)) : "";
    })
    .replace(/&#(\d+);/g, (_match, code) => {
      const number = Number.parseInt(code, 10);
      return Number.isFinite(number) ? String.fromCodePoint(Math.min(number, 0x10ffff)) : "";
    })
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function xmlText(value) {
  return decodeXml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function tagValue(block, names) {
  for (const name of names) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(block).match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    if (match) return xmlText(match[1]).replace(/\s+/g, " ").trim();
  }
  return "";
}

function atomLink(block) {
  const match = String(block).match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i);
  return match ? decodeXml(match[1]).trim() : tagValue(block, ["link"]);
}

function safeFeedItemUrl(raw, feedUrl) {
  try {
    const feed = new URL(String(feedUrl));
    const candidate = new URL(String(raw || ""), feed);
    if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) return feed.toString();
    const host = normalizedHostname(candidate);
    // Item links are observations, not fetch permissions. Keep links on the
    // already validated feed host so an untrusted feed cannot inject an
    // unvalidated private or credential-bearing destination into state.
    if (host !== normalizedHostname(feed) || candidate.origin !== feed.origin) return feed.toString();
    candidate.hash = "";
    return candidate.toString();
  } catch {
    return String(feedUrl);
  }
}

function feedBlocks(body) {
  const source = String(body || "");
  const rss = [...source.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => ({ kind: "rss", block: match[1] }));
  const atom = [...source.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => ({ kind: "atom", block: match[1] }));
  return rss.length ? rss : atom;
}

/** Extract bounded RSS/Atom item observations. The caller still applies the
 * existing URL policy, normalization, dedupe and fit evaluation. */
export function extractFeedObservations(body, contentType, { feedUrl, maxItems = 32, maxText = DEFAULTS.maxText } = {}) {
  const blocks = feedBlocks(body).slice(0, Math.min(64, Math.max(0, Number(maxItems) || 32)));
  if (!blocks.length) return [];
  return blocks.map(({ kind, block }) => {
    const id = tagValue(block, kind === "rss" ? ["guid", "id"] : ["id", "guid"]);
    const title = tagValue(block, ["title"]);
    const text = tagValue(block, kind === "rss" ? ["content:encoded", "description", "summary", "content"] : ["content", "summary", "description"]);
    const author = tagValue(block, ["author", "dc:creator", "creator", "name"]);
    const published = tagValue(block, kind === "rss" ? ["pubDate", "dc:date", "published", "updated"] : ["published", "updated", "pubDate"]);
    const parsed = Date.parse(published);
    return {
      url: safeFeedItemUrl(kind === "atom" ? atomLink(block) : tagValue(block, ["link"]), feedUrl),
      title: redact(title).slice(0, maxText), text: redact(text).slice(0, maxText), author: redact(author).slice(0, 240),
      source: "public-feed-observer", observedAt: new Date().toISOString(),
      ...(Number.isFinite(parsed) ? { publishedAt: new Date(parsed).toISOString() } : {}),
      ...(id ? { sourceId: redact(id).slice(0, 240) } : {}),
      fetch: { contentType, feed: true, itemCount: blocks.length }
    };
  });
}

export function extractObservation(body, contentType, { maxText = DEFAULTS.maxText } = {}) {
  const source = String(body || "");
  const extracted = contentType.includes("html") ? htmlText(source) : { title: "", text: source };
  const clip = (value) => redact(value).replace(/\s+/g, " ").trim().slice(0, maxText);
  return { title: clip(extracted.title), text: clip(extracted.text) };
}

function abortError() {
  const error = new Error("timeout");
  error.name = "AbortError";
  return error;
}

async function readChunk(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) {
    await reader.cancel();
    throw abortError();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortError());
      reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then((result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    }, (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

async function readBounded(response, maxBytes, signal) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("response exceeds byte bound");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await readChunk(reader, signal);
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error("response exceeds byte bound"); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((item) => Buffer.from(item))));
}

export async function observePublicUrls(urls, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const requested = Array.isArray(urls) ? urls.slice(0, config.maxUrls) : [];
  const results = [];
  for (const raw of requested) {
    let current = String(raw); let redirects = 0; let finalUrl = null;
    try {
      while (true) {
        const resolved = await resolvePublicUrl(current, config);
        const { url } = resolved;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        try {
          const response = config.fetchImpl
            ? await config.fetchImpl(url, { redirect: "manual", signal: controller.signal })
            : await pinnedFetch(url, resolved.address, { signal: controller.signal, timeoutMs: config.timeoutMs });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (redirects >= config.maxRedirects) throw new Error("redirect limit exceeded");
            const location = response.headers.get("location");
            if (!location) throw new Error("redirect location missing");
            await response.body?.cancel().catch(() => undefined);
            current = new URL(location, url).toString(); redirects += 1; continue;
          }
          finalUrl = url.toString();
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw new Error(`HTTP_${response.status}`);
          }
          const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
          // Read once under the existing byte bound before inspecting an
          // octet-stream body. This avoids trusting a response header and
          // keeps malformed/oversized payloads fail-closed.
          const body = await readBounded(response, config.maxBytes, controller.signal);
          const feedPayload = FEED_TYPES.has(contentType) || (contentType === "application/octet-stream" && /<(?:item|entry)\b/i.test(body));
          if (!PUBLIC_TYPES.has(contentType) && !feedPayload) {
            throw new Error("unsupported content type");
          }
          if (feedPayload) {
            const feedItems = extractFeedObservations(body, contentType, { feedUrl: finalUrl, maxItems: config.maxItems || 32, maxText: config.maxText });
            if (!feedItems.length) throw new Error("feed contains no bounded items");
            for (const item of feedItems) results.push({ ...item, fetch: { ...item.fetch, status: response.status, redirects } });
          } else {
            const extracted = extractObservation(body, contentType, config);
            results.push({ url: finalUrl, title: extracted.title, text: extracted.text, source: "public-http-observer", observedAt: new Date().toISOString(), fetch: { status: response.status, contentType, redirects } });
          }
          break;
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (error) {
      results.push({ url: finalUrl || String(raw), title: "", text: "", source: "public-http-observer", observedAt: new Date().toISOString(), fetch: { status: "UNKNOWN", reason: redact(error?.name === "AbortError" ? "timeout" : error?.message || "unavailable"), redirects }, observationStatus: "UNKNOWN" });
    }
  }
  return { requested: requested.length, truncated: Array.isArray(urls) && urls.length > requested.length, observations: results };
}

export { privateAddress, resolvePublicUrl, pinnedFetch };
