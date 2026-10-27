import { createHash } from "node:crypto";

/**
 * Native, bounded adapters for useful Ổi Browser primitives.
 *
 * Source attribution: adapted from `jangtrinh/oi-browser` revision
 * 1e471c44b5d63aa5aadb708623b21090b6f325b2. This module deliberately keeps
 * marketing-seeding's JsonStore, authority, decision plane, and executors as
 * the only product-owned control surfaces.
 */
export const OI_BROWSER_SOURCE_REVISION = "1e471c44b5d63aa5aadb708623b21090b6f325b2";
export const AUTO_GTM_SOURCE_REVISION = "9368098477d78f75d57fdf5db276129948f3a183";
export const OI_BROWSER_INTEGRATION_VERSION = 1;

const MEMORY_KINDS = new Set(["RAW_EVENT", "OBSERVATION", "FACT", "INFERENCE", "LEARNING", "POLICY"]);
const PROVIDER_STATES = new Set(["installed", "authReady", "healthy", "executionSucceeded"]);
const ROUTE_FAILURES = new Set(["timeout", "nonzero", "invalid_result", "unavailable", "privacy_mismatch"]);
const ACTIONS = new Set(["CLICK", "TYPE", "UPLOAD"]);
const SECRET_QUERY_KEY = /(?:password|secret|token|cookie|authorization|api[_-]?key|session|credential)/i;
const COST_RANK = Object.freeze({ free: 0, local: 1, low: 2, medium: 3, high: 4, unknown: 5 });

function text(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function iso(value, fallback = new Date().toISOString()) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function boundedArray(value, max = 32) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => redacted(item, 240)).filter(Boolean))].slice(0, max);
}

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function digest(value, length = 64) {
  return createHash("sha256").update(stable(value)).digest("hex").slice(0, length);
}

function redacted(value, max = 800) {
  return text(value, max)
    .replace(/bearer\s+[a-z0-9._-]+/gi, "bearer [redacted]")
    .replace(/\b(?:sk|gh[pousr])_[a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/(password|secret|token|cookie|authorization|api[_-]?key|session|credential)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function attrs(raw = "") {
  const out = {};
  const re = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(raw))) out[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return out;
}

function normalizeRole(tag, attributes) {
  const explicit = text(attributes.role, 40).toLowerCase();
  if (explicit) return explicit;
  return ({ a: "link", button: "button", input: attributes.type === "submit" ? "button" : "textbox", textarea: "textbox", select: "combobox" })[tag] || "generic";
}

function elementLabel(tag, attributes, inner) {
  return redacted(attributes["aria-label"] || attributes.title || attributes.placeholder || inner || attributes.value, 160);
}

function elementIdentity({ role, label, href, id, name, context }) {
  return `oi-element-${digest({ role, label: label.toLowerCase(), href: href || null, id: id || null, name: name || null, context: text(context, 120).toLowerCase() }, 24)}`;
}

function normalizeHref(href, baseUrl) {
  if (!href) return null;
  try {
    const normalized = new URL(href, baseUrl);
    if (normalized.username || normalized.password) return null;
    normalized.hash = "";
    for (const key of [...normalized.searchParams.keys()]) if (SECRET_QUERY_KEY.test(key)) normalized.searchParams.set(key, "[redacted]");
    return /^https?:$/i.test(normalized.protocol) ? normalized.toString() : null;
  } catch { return null; }
}

/** Parse public/static HTML. This never claims authenticated live DOM state. */
export function createBrowserSnapshot({ url, html = "", capturedAt = new Date().toISOString(), source = "STATIC_HTTP", frame = "top", screenshotReference = null, runtimeEvidence = null } = {}) {
  let normalizedUrl;
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.username || parsed.password) throw new Error("credentials in URL are not allowed");
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) if (SECRET_QUERY_KEY.test(key)) parsed.searchParams.set(key, "[redacted]");
    normalizedUrl = parsed.toString();
  } catch { throw new Error("BrowserSnapshot URL must be an absolute HTTP(S) URL"); }
  if (!/^https?:$/i.test(new URL(normalizedUrl).protocol)) throw new Error("BrowserSnapshot URL must use HTTP(S)");
  if (!new Set(["STATIC_HTTP", "LIVE_DOM"]).has(source)) throw Object.assign(new Error("BrowserSnapshot source is invalid"), { code: "DOM_SNAPSHOT_INVALID" });
  const live = source === "LIVE_DOM";
  if (live && (!runtimeEvidence || runtimeEvidence.verified !== true || !text(runtimeEvidence.provider, 80) || !text(runtimeEvidence.providerVersion, 80))) {
    throw Object.assign(new Error("LIVE_DOM snapshot requires verified runtime evidence"), { code: "LIVE_DOM_EVIDENCE_REQUIRED" });
  }
  const raw = String(html || "").slice(0, 1_000_000);
  const title = redacted(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 180) || new URL(normalizedUrl).hostname;
  const headings = [];
  const headingRe = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let heading;
  while ((heading = headingRe.exec(raw)) && headings.length < 32) {
    const value = redacted(stripTags(heading[2]), 180);
    if (value) headings.push({ level: Number(heading[1]), text: value.slice(0, 180) });
  }
  const elements = [];
  const elementRe = /<(a|button|input|textarea|select)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = elementRe.exec(raw)) && elements.length < 200) {
    const tag = String(match[1] || match[4]).toLowerCase();
    const attributeText = match[2] || match[5] || "";
    const attributes = attrs(attributeText);
    const inner = match[3] || "";
    const role = normalizeRole(tag, attributes);
    const label = elementLabel(tag, attributes, stripTags(inner));
    if (!label && !attributes.id && !attributes.name) continue;
    const href = normalizeHref(attributes.href, normalizedUrl);
    const before = raw.slice(Math.max(0, match.index - 180), match.index);
    const context = redacted(stripTags(before).slice(-120), 120);
    const elementId = elementIdentity({ role, label, href, id: attributes.id, name: attributes.name, context });
    elements.push({
      elementId, role, tag, label, href,
      stableAttributes: { id: text(attributes.id, 100) || null, name: text(attributes.name, 100) || null, type: text(attributes.type, 40) || null },
      frame: text(frame, 80) || "top", visible: attributes.hidden === undefined && attributes["aria-hidden"] !== "true",
      enabled: attributes.disabled === undefined && attributes["aria-disabled"] !== "true", confidence: label ? 0.82 : 0.55,
      context: redacted(context, 120)
    });
  }
  const textContent = redacted(stripTags(raw), 20_000);
  const fingerprint = digest({ url: normalizedUrl, title, headings, elements: elements.map(({ elementId, role, label, href, frame }) => ({ elementId, role, label, href, frame })), text: textContent }, 64);
  return Object.freeze({
    schemaVersion: 1,
    integrationVersion: OI_BROWSER_INTEGRATION_VERSION,
    source: source === "LIVE_DOM" ? "LIVE_DOM" : "STATIC_HTTP",
    url: normalizedUrl,
    title,
    headings: Object.freeze(headings),
    text: textContent,
    forms: Object.freeze(elements.filter((item) => ["textbox", "combobox"].includes(item.role))),
    buttons: Object.freeze(elements.filter((item) => item.role === "button")),
    links: Object.freeze(elements.filter((item) => item.role === "link")),
    elements: Object.freeze(elements),
    frame: text(frame, 80) || "top",
    capturedAt: iso(capturedAt),
    fingerprint,
    screenshotReference: text(screenshotReference, 240) || null,
    runtimeEvidence: live ? { verified: true, provider: text(runtimeEvidence.provider, 80), providerVersion: text(runtimeEvidence.providerVersion, 80), evidenceRef: text(runtimeEvidence.evidenceRef, 180) || null } : null,
    evidenceStatus: live ? "RUNTIME_VERIFIED" : "FIXTURE_VERIFIED"
  });
}

export function resolveBrowserElement(snapshot, query = {}) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.elements)) throw new Error("BrowserSnapshot is invalid");
  const requestedId = text(query.elementId || query.id, 120);
  let matches = requestedId ? snapshot.elements.filter((item) => item.elementId === requestedId) : snapshot.elements.filter((item) => {
    const role = text(query.role, 40).toLowerCase();
    const label = text(query.label || query.accessibleName, 160).toLowerCase();
    return (!role || item.role === role) && (!label || item.label.toLowerCase() === label);
  });
  matches = matches.filter((item) => item.visible !== false && item.enabled !== false);
  if (matches.length !== 1) {
    const error = new Error(matches.length ? "Browser element target is ambiguous" : "Browser element target is missing");
    error.code = matches.length ? "DOM_TARGET_AMBIGUOUS" : "DOM_TARGET_MISSING";
    throw error;
  }
  return matches[0];
}

export function createBrowserExecutionIntent(snapshot, { action, elementId, value = null, snapshotFingerprint = snapshot?.fingerprint, now = new Date().toISOString(), includeTransientValue = false } = {}) {
  const normalizedAction = text(action, 20).toUpperCase();
  if (!ACTIONS.has(normalizedAction)) throw new Error("Unsupported browser action");
  if (snapshotFingerprint !== snapshot?.fingerprint) throw Object.assign(new Error("Browser snapshot is stale"), { code: "DOM_SNAPSHOT_STALE" });
  const element = resolveBrowserElement(snapshot, { elementId });
  if (normalizedAction === "CLICK" && element.role !== "button" && element.role !== "link") throw new Error("CLICK requires a button or link element");
  if (normalizedAction === "TYPE" && !["textbox", "combobox"].includes(element.role)) throw new Error("TYPE requires a text input element");
  if (normalizedAction === "UPLOAD" && element.role !== "textbox") throw new Error("UPLOAD requires a file input seam");
  if ((normalizedAction === "TYPE" || normalizedAction === "UPLOAD") && (value === null || value === undefined || String(value) === "")) throw new Error(`${normalizedAction} requires a transient value`);
  const transientValue = normalizedAction === "TYPE" ? text(value, 2_000) : normalizedAction === "UPLOAD" ? text(value, 500) : null;
  const valueDigest = transientValue === null ? null : digest({ value: transientValue }, 24);
  return Object.freeze({ schemaVersion: 1, intentId: `intent-${digest({ action: normalizedAction, elementId, snapshotFingerprint, valueDigest }, 24)}`, action: normalizedAction, elementId: element.elementId, targetIdentity: digest(element, 32), snapshotFingerprint, frame: element.frame, ...(includeTransientValue && transientValue !== null ? { value: transientValue } : {}), valueDigest, valueTransient: transientValue !== null, createdAt: iso(now), executionAllowed: false, authorityRequired: true });
}

function normalizedSnapshotUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { throw Object.assign(new Error("BrowserSnapshot URL must be an absolute HTTP(S) URL"), { code: "DOM_SNAPSHOT_INVALID" }); }
  if (!/^https?:$/i.test(parsed.protocol) || parsed.username || parsed.password) throw Object.assign(new Error("BrowserSnapshot URL must use credential-free HTTP(S)"), { code: "DOM_SNAPSHOT_INVALID" });
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) if (SECRET_QUERY_KEY.test(key)) parsed.searchParams.set(key, "[redacted]");
  return parsed.toString();
}

/** Validate and redact a live or externally supplied snapshot before persistence. */
export function normalizeBrowserSnapshot(input = {}) {
  if (!input || typeof input !== "object" || input.schemaVersion !== 1) throw Object.assign(new Error("BrowserSnapshot schemaVersion 1 is required"), { code: "DOM_SNAPSHOT_INVALID" });
  const source = input.source === "LIVE_DOM" ? "LIVE_DOM" : input.source === "STATIC_HTTP" ? "STATIC_HTTP" : null;
  if (!source) throw Object.assign(new Error("BrowserSnapshot source is invalid"), { code: "DOM_SNAPSHOT_INVALID" });
  if (source === "LIVE_DOM" && (!input.runtimeEvidence?.verified || !text(input.runtimeEvidence.provider, 80) || !text(input.runtimeEvidence.providerVersion, 80))) {
    throw Object.assign(new Error("LIVE_DOM snapshot requires verified runtime evidence"), { code: "LIVE_DOM_EVIDENCE_REQUIRED" });
  }
  const elements = Array.isArray(input.elements) ? input.elements.slice(0, 200).map((item) => ({
    elementId: text(item?.elementId, 120), role: text(item?.role, 40).toLowerCase(), tag: text(item?.tag, 30).toLowerCase(),
    label: redacted(item?.label, 160), href: item?.href ? normalizeHref(item.href, normalizedSnapshotUrl(input.url)) : null,
    stableAttributes: { id: text(item?.stableAttributes?.id, 100) || null, name: text(item?.stableAttributes?.name, 100) || null, type: text(item?.stableAttributes?.type, 40) || null },
    frame: text(item?.frame, 80) || "top", visible: item?.visible !== false, enabled: item?.enabled !== false,
    confidence: Math.min(1, Math.max(0, Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0)), context: redacted(item?.context, 120)
  })) : [];
  if (elements.some((item) => !item.elementId) || new Set(elements.map((item) => item.elementId)).size !== elements.length) throw Object.assign(new Error("BrowserSnapshot element identities must be unique"), { code: "DOM_SNAPSHOT_INVALID" });
  if (elements.some((item) => item.elementId !== elementIdentity({ role: item.role, label: item.label, href: item.href, id: item.stableAttributes.id, name: item.stableAttributes.name, context: item.context }))) {
    throw Object.assign(new Error("BrowserSnapshot element identity does not match semantic fields"), { code: "DOM_SNAPSHOT_IDENTITY_MISMATCH" });
  }
  const headings = (Array.isArray(input.headings) ? input.headings : []).slice(0, 32).map((item) => ({ level: Number(item?.level) || 1, text: redacted(item?.text, 180) })).filter((item) => item.text);
  const normalizedUrl = normalizedSnapshotUrl(input.url);
  const normalizedTitle = redacted(input.title, 180) || new URL(normalizedUrl).hostname;
  const normalizedText = redacted(input.text, 20_000);
  const fingerprint = digest({ url: normalizedUrl, title: normalizedTitle, headings, elements: elements.map(({ elementId, role, label, href, frame }) => ({ elementId, role, label, href, frame })), text: normalizedText }, 64);
  if (input.fingerprint && String(input.fingerprint).toLowerCase() !== fingerprint) throw Object.assign(new Error("BrowserSnapshot fingerprint does not match normalized content"), { code: "DOM_SNAPSHOT_FINGERPRINT_MISMATCH" });
  return Object.freeze({
    schemaVersion: 1, integrationVersion: OI_BROWSER_INTEGRATION_VERSION, source, url: normalizedUrl,
    title: normalizedTitle, headings, text: normalizedText,
    forms: Object.freeze(elements.filter((item) => ["textbox", "combobox"].includes(item.role))),
    buttons: Object.freeze(elements.filter((item) => item.role === "button")), links: Object.freeze(elements.filter((item) => item.role === "link")),
    elements: Object.freeze(elements), frame: text(input.frame, 80) || "top", capturedAt: iso(input.capturedAt), fingerprint,
    screenshotReference: redacted(input.screenshotReference, 240) || null,
    runtimeEvidence: source === "LIVE_DOM" ? { verified: true, provider: text(input.runtimeEvidence.provider, 80), providerVersion: text(input.runtimeEvidence.providerVersion, 80), evidenceRef: redacted(input.runtimeEvidence.evidenceRef, 180) || null } : null,
    evidenceStatus: source === "LIVE_DOM" ? "RUNTIME_VERIFIED" : "FIXTURE_VERIFIED"
  });
}

function transportIdentity(transport) {
  const identity = typeof transport?.runtimeIdentity === "function" ? transport.runtimeIdentity() : {};
  return {
    transport: text(identity.transport || transport?.id, 100) || "browser-interaction",
    provider: text(identity.provider || transport?.provider, 100) || "unknown",
    providerVersion: text(identity.providerVersion || transport?.providerVersion, 100) || null
  };
}

function assertIntentBinding(snapshot, intent) {
  if (!snapshot || snapshot.schemaVersion !== 1) throw Object.assign(new Error("Browser snapshot is invalid"), { code: "DOM_SNAPSHOT_INVALID" });
  if (!intent || intent.schemaVersion !== 1) throw Object.assign(new Error("Browser intent is invalid"), { code: "BROWSER_INTENT_INVALID" });
  if (intent.snapshotFingerprint !== snapshot.fingerprint) throw Object.assign(new Error("Browser snapshot is stale"), { code: "DOM_SNAPSHOT_STALE" });
  const element = resolveBrowserElement(snapshot, { elementId: intent.elementId });
  const targetIdentity = digest(element, 32);
  if (intent.targetIdentity !== targetIdentity) throw Object.assign(new Error("Browser intent target identity changed"), { code: "DOM_TARGET_IDENTITY_CHANGED" });
  return element;
}

function assertIntentAuthority(intent, snapshot, element, authority) {
  if (!authority || authority.allowed !== true) throw Object.assign(new Error("Browser intent requires explicit authority"), { code: "BROWSER_AUTHORITY_REQUIRED" });
  if (authority.action && String(authority.action).toUpperCase() !== intent.action) throw Object.assign(new Error("Browser intent action is outside authority"), { code: "BROWSER_AUTHORITY_SCOPE_MISMATCH" });
  if (authority.snapshotFingerprint && authority.snapshotFingerprint !== snapshot.fingerprint) throw Object.assign(new Error("Browser authority is bound to a different snapshot"), { code: "BROWSER_AUTHORITY_SCOPE_MISMATCH" });
  if (authority.targetIdentity && authority.targetIdentity !== digest(element, 32)) throw Object.assign(new Error("Browser authority is bound to a different target"), { code: "BROWSER_AUTHORITY_SCOPE_MISMATCH" });
  if (authority.externalSideEffects !== false) throw Object.assign(new Error("oi-browser intent executor requires externalSideEffects=false"), { code: "BROWSER_EXTERNAL_SIDE_EFFECT_BLOCKED" });
  if (snapshot.source === "STATIC_HTTP") {
    let host = "";
    try { host = new URL(snapshot.url).hostname.toLowerCase(); } catch {}
    const safeFixtureHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".test") || host === "fixture.local";
    if (authority.allowStaticFixture !== true || !safeFixtureHost) throw Object.assign(new Error("Static BrowserSnapshot requires an explicit safe fixture authority"), { code: "STATIC_SNAPSHOT_EXECUTION_BLOCKED" });
    if (authority.fixtureHost && String(authority.fixtureHost).toLowerCase() !== host) throw Object.assign(new Error("Browser fixture authority host mismatch"), { code: "BROWSER_AUTHORITY_SCOPE_MISMATCH" });
  }
}

function assertTransientValueBinding(intent) {
  if (!['TYPE', 'UPLOAD'].includes(intent.action)) return;
  const max = intent.action === 'TYPE' ? 2_000 : 500;
  const value = text(intent.value, max);
  if (!value || !intent.valueDigest || digest({ value }, 24) !== String(intent.valueDigest)) {
    throw Object.assign(new Error('Browser intent transient value does not match its durable binding'), { code: 'BROWSER_TRANSIENT_VALUE_MISMATCH' });
  }
}

export function validateBrowserIntentTransientValue(intent) {
  assertTransientValueBinding(intent);
  return true;
}

/**
 * Execute one bounded intent through an already-owned browser transport.
 * This is a reversible/fixture seam. It does not publish, create authority,
 * or replace the LinkedIn/Camoufox execution worker.
 */
export async function executeBrowserIntent(snapshot, intent, {
  transport,
  authority,
  pageId = null,
  validate,
  resolveTarget,
  observe,
  verify
} = {}) {
  const element = assertIntentBinding(snapshot, intent);
  assertIntentAuthority(intent, snapshot, element, authority);
  if (["TYPE", "UPLOAD"].includes(intent.action) && !intent.value) {
    throw Object.assign(new Error("Browser intent requires a transient value at execution time"), { code: "BROWSER_TRANSIENT_VALUE_REQUIRED" });
  }
  assertTransientValueBinding(intent);
  if (!transport || typeof transport !== "object") throw Object.assign(new Error("Browser intent transport is unavailable"), { code: "TRANSPORT_UNAVAILABLE" });
  const target = typeof resolveTarget === "function"
    ? await resolveTarget({ snapshot, intent, element, pageId })
    : typeof transport.resolveTarget === "function"
      ? await transport.resolveTarget({ snapshot, intent, element, pageId })
      : { targetRef: element.elementId, targetIdentity: intent.targetIdentity };
  const targetRef = text(target?.targetRef || target?.elementId || element.elementId, 200);
  if (!targetRef) throw Object.assign(new Error("Browser intent target is incomplete"), { code: "TRANSPORT_TARGET_INVALID" });
  const targetIdentity = text(target?.targetIdentity || intent.targetIdentity, 100);
  if (targetIdentity !== intent.targetIdentity) throw Object.assign(new Error("Browser intent target identity changed"), { code: "DOM_TARGET_IDENTITY_CHANGED" });
  const observeFn = typeof observe === "function" ? observe : typeof transport.observe === "function" ? transport.observe.bind(transport) : null;
  const validateFn = typeof validate === "function" ? validate : typeof transport.validate === "function" ? transport.validate.bind(transport) : null;
  const verifyFn = typeof verify === "function" ? verify : typeof transport.verify === "function" ? transport.verify.bind(transport) : null;
  if (!verifyFn) throw Object.assign(new Error("Browser intent requires verification"), { code: "BROWSER_VERIFICATION_REQUIRED" });
  const before = observeFn ? await observeFn({ snapshot, intent, element, target, phase: "before" }) : null;
  let providerCallStarted = false;
  const preflight = async () => {
    if (!validateFn) throw Object.assign(new Error("Browser intent requires immediate pre-provider validation"), { code: "TRANSPORT_VALIDATION_REQUIRED" });
    return validateFn({ snapshot, intent, element, target });
  };
  const startedAt = new Date().toISOString();
  try {
    let providerResult;
    if (intent.action === "CLICK") {
      if (typeof transport.click !== "function") throw Object.assign(new Error("Browser click transport is unavailable"), { code: "TRANSPORT_UNAVAILABLE" });
      if (typeof transport.assertPreClickValidation !== "function" || transport.transportContractVersion !== 1 || transport.requiresPreClickValidation !== true) {
        throw Object.assign(new Error("Browser interaction transport is not certified for validated final input"), { code: "TRANSPORT_NOT_CERTIFIED" });
      }
      transport.assertPreClickValidation({ validate: preflight });
      providerResult = await transport.click({ pageId, targetRef, targetIdentity, frame: intent.frame }, {
        validate: async () => preflight(),
        onProviderCallStarted: () => { providerCallStarted = true; },
        diagnostics: { intentId: intent.intentId, source: "oi-browser" }
      });
    } else {
      await preflight();
      if (intent.action === "TYPE") {
        const type = transport.type || transport.fill;
        if (typeof type !== "function") throw Object.assign(new Error("Browser type transport is unavailable"), { code: "TRANSPORT_UNAVAILABLE" });
        providerCallStarted = true;
        providerResult = await type.call(transport, pageId, targetRef, intent.value);
      } else {
        if (typeof transport.upload !== "function") throw Object.assign(new Error("Browser upload transport is unavailable"), { code: "TRANSPORT_UNAVAILABLE" });
        providerCallStarted = true;
        providerResult = await transport.upload(pageId, targetRef, intent.value);
      }
    }
    const after = observeFn ? await observeFn({ snapshot, intent, element, target, phase: "after" }) : null;
    if (!verifyFn) throw Object.assign(new Error("Browser intent requires verification"), { code: "BROWSER_VERIFICATION_REQUIRED" });
    if (!providerResult || typeof providerResult !== "object") throw Object.assign(new Error("Browser provider returned an invalid result"), { code: "BROWSER_PROVIDER_INVALID_RESULT" });
    const verification = await verifyFn({ snapshot, intent, element, target, before, after, providerResult });
    if (!verification || typeof verification !== "object" || !text(verification.status, 80)) throw Object.assign(new Error("Browser verification returned an invalid result"), { code: "BROWSER_VERIFICATION_INVALID_RESULT" });
    const commandStatus = text(providerResult.commandStatus || providerResult.status, 80);
    if (!commandStatus) throw Object.assign(new Error("Browser provider returned no command status"), { code: "BROWSER_PROVIDER_INVALID_RESULT" });
    return {
      schemaVersion: 1, intentId: intent.intentId, action: intent.action, elementId: intent.elementId,
    targetIdentity, transport: transportIdentity(transport), commandStatus,
      executionStatus: commandStatus === "COMMAND_COMPLETED" ? "COMMAND_COMPLETED" : "OUTCOME_UNKNOWN", providerCallStarted: true, startedAt, completedAt: new Date().toISOString(),
      verification: verification && typeof verification === "object" ? { ...verification } : null,
      evidenceStatus: snapshot.source === "LIVE_DOM" ? "RUNTIME_VERIFIED" : "FIXTURE_VERIFIED", externalSideEffects: false
    };
  } catch (error) {
    error.executionStatus = providerCallStarted ? "OUTCOME_UNKNOWN" : "FAILED";
    error.providerCallStarted = providerCallStarted;
    error.intentId = intent.intentId;
    throw error;
  }
}

export function sanitizeBrowserExecutionResult(result = {}) {
  const verification = result.verification && typeof result.verification === "object" ? result.verification : null;
  const transport = result.transport && typeof result.transport === "object" ? {
    transport: text(result.transport.transport, 100), provider: text(result.transport.provider, 100), providerVersion: text(result.transport.providerVersion, 100) || null
  } : null;
  return {
    schemaVersion: 1,
    intentId: text(result.intentId, 120), action: text(result.action, 20).toUpperCase(), elementId: text(result.elementId, 160),
    targetIdentity: text(result.targetIdentity, 100), transport,
    commandStatus: text(result.commandStatus, 80) || "OUTCOME_UNKNOWN", executionStatus: text(result.executionStatus, 80) || "UNKNOWN",
    providerCallStarted: result.providerCallStarted === true,
    startedAt: iso(result.startedAt), completedAt: result.completedAt ? iso(result.completedAt) : null,
    verification: verification ? {
      status: text(verification.status, 80) || "UNKNOWN", observedAt: verification.observedAt ? iso(verification.observedAt) : null,
      signals: boundedArray(verification.signals || verification.observedTransitions, 24), evidenceRefs: boundedArray(verification.evidenceRefs, 32), reasonCode: text(verification.reasonCode, 100) || null
    } : null,
    failureCode: text(result.failureCode, 100) || null,
    evidenceStatus: text(result.evidenceStatus, 40).toUpperCase() || "IMPLEMENTED", externalSideEffects: result.externalSideEffects === true
  };
}

function normalizeScope(scope = {}) {
  return Object.fromEntries(["campaignId", "accountId", "communityId", "platform", "channel"].map((key) => [key, redacted(scope[key], 120) || null]));
}

export function normalizeMemoryItem(input = {}, { now = new Date().toISOString() } = {}) {
  const kind = text(input.kind, 24).toUpperCase();
  if (!MEMORY_KINDS.has(kind)) throw new Error("memory kind is invalid");
  const scope = normalizeScope(input.scope || input.bindings || {});
  const entityRef = text(input.entityRef || input.entityId, 180) || null;
  const source = text(input.source || input.provenance?.source, 180);
  if (!source) throw new Error("memory source is required");
  const observedAt = iso(input.observedAt || input.createdAt, iso(now));
  const expiresAt = input.expiresAt ? iso(input.expiresAt, "") : null;
  const evidenceRefs = boundedArray(input.evidenceRefs || input.evidence, 64);
  const publicationSample = input.postId || input.publicationId ? [`publication:${input.publicationId || input.postId}`] : [];
  const sampleIds = boundedArray(publicationSample.length ? publicationSample : [
    ...(Array.isArray(input.sampleIds) ? input.sampleIds : []), ...(input.sampleId ? [input.sampleId] : []),
    ...((!input.sampleIds && !input.sampleId) ? evidenceRefs.map((ref) => /^(?:post|publication|execution):/.test(ref) ? ref.replace(/^execution:/, "publication:") : ref) : [])
  ], 64);
  const content = redacted(input.content || input.summary || input.text, 2_000);
  if (!content) throw new Error("memory content is required");
  const fingerprint = text(input.fingerprint, 64) || digest({ kind, scope, entityRef, content, source }, 64);
  const confidence = Math.min(1, Math.max(0, Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0.5));
  return {
    schemaVersion: 1, id: text(input.id, 120) || `memory-${fingerprint.slice(0, 24)}`, kind, entityRef, scope, content, fingerprint,
    source, provenance: { source, revision: text(input.sourceRevision, 80) || OI_BROWSER_SOURCE_REVISION, evidenceRefs }, evidenceRefs,
    observedAt, createdAt: iso(input.createdAt, iso(now)), updatedAt: iso(input.updatedAt, iso(now)), confidence,
    freshness: text(input.freshness, 40) || "bounded", expiresAt, sampleIds, supportCount: Math.max(1, sampleIds.length || 1),
    retractedAt: input.retractedAt ? iso(input.retractedAt, "") : null,
    campaignId: scope.campaignId, accountId: scope.accountId, communityId: scope.communityId, platform: scope.platform, channel: scope.channel,
    evidenceStatus: text(input.evidenceStatus, 40).toUpperCase() || "OBSERVED", decisionHint: text(input.decisionHint, 80) || null
  };
}

export function memoryItemIsFresh(item, now = new Date()) {
  if (!item || item.retractedAt) return false;
  const current = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const expiry = Date.parse(String(item.expiresAt || ""));
  return !Number.isFinite(expiry) || expiry > current;
}

export function recordMemoryObservation(state, input, { now = new Date().toISOString() } = {}) {
  const item = normalizeMemoryItem({ ...input, kind: input.kind || "OBSERVATION" }, { now });
  state.memoryItems ||= [];
  const existing = state.memoryItems.find((candidate) => candidate.fingerprint === item.fingerprint && candidate.kind === item.kind && stable(candidate.scope) === stable(item.scope));
  if (existing) {
    existing.sampleIds = boundedArray([...(existing.sampleIds || []), ...(item.sampleIds || [])], 64);
    existing.supportCount = Math.max(1, existing.sampleIds.length);
    existing.updatedAt = item.updatedAt;
    existing.observedAt = item.observedAt > existing.observedAt ? item.observedAt : existing.observedAt;
    existing.evidenceRefs = boundedArray([...(existing.evidenceRefs || []), ...(item.evidenceRefs || [])], 64);
    existing.provenance = { ...existing.provenance, evidenceRefs: existing.evidenceRefs };
    if (existing.evidenceStatus !== item.evidenceStatus) existing.evidenceStatus = "MIXED";
    return { item: existing, deduplicated: true };
  }
  state.memoryItems.push(item);
  return { item, deduplicated: false };
}

function scopeMatches(item, scope = {}) {
  return ["campaignId", "accountId", "communityId", "platform", "channel"].every((key) => !scope[key] || item.scope?.[key] === scope[key] || item[key] === scope[key]);
}

export function retrieveBoundedMemory(state, { scope = {}, entityRef = null, limit = 24, now = new Date() } = {}) {
  const max = Math.max(1, Math.min(100, Number(limit) || 24));
  return (state?.memoryItems || []).filter((item) => memoryItemIsFresh(item, now) && scopeMatches(item, scope) && (!entityRef || item.entityRef === entityRef))
    .sort((a, b) => Number(b.confidence) - Number(a.confidence) || Number(b.supportCount) - Number(a.supportCount) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, max);
}

export function consolidateMemory(state, { scope = {}, now = new Date() } = {}) {
  const observations = retrieveBoundedMemory(state, { scope, now, limit: 100 }).filter((item) => ["OBSERVATION", "FACT", "INFERENCE"].includes(item.kind));
  const groups = new Map();
  for (const item of observations) {
    const key = `${item.fingerprint}\u0000${stable(item.scope)}`;
    const group = groups.get(key) || { items: [], evidence: new Set() };
    group.items.push(item); for (const ref of item.evidenceRefs || []) group.evidence.add(ref); groups.set(key, group);
  }
  const learnings = [];
  for (const group of groups.values()) {
    const sampleIds = new Set(group.items.flatMap((item) => item.sampleIds || []));
    const sampleSupport = sampleIds.size || 1;
    const verifiedCount = group.items.reduce((total, item) => {
      const samples = Math.max(1, Array.isArray(item.sampleIds) ? item.sampleIds.length : 0);
      return total + (["VERIFIED", "MEASURED", "RUNTIME_VERIFIED"].includes(item.evidenceStatus) ? samples : 0);
    }, 0);
    if (sampleSupport < 2) continue;
    if (verifiedCount < sampleSupport) continue;
    const first = group.items[0];
    const learning = normalizeMemoryItem({
      kind: "LEARNING", scope: first.scope, entityRef: first.entityRef, content: first.content, source: "oi-browser-consolidation",
      sourceRevision: OI_BROWSER_SOURCE_REVISION, evidenceRefs: [...group.evidence], confidence: Math.min(0.98, Number(first.confidence || 0.5) + Math.min(0.35, sampleSupport / 100)),
      sampleIds: [...sampleIds], supportCount: sampleSupport, observedAt: first.observedAt, evidenceStatus: "VERIFIED", decisionHint: first.decisionHint,
      id: `learning-${digest({ fingerprint: first.fingerprint, scope: first.scope, evidence: [...group.evidence].sort() }, 24)}`
    }, { now: iso(now) });
    learnings.push({ ...learning, support: { sampleSupport, evidenceCount: group.evidence.size, verifiedCount }, supersedes: first.id });
  }
  return learnings;
}

export function applyMemoryConsolidation(state, { scope = {}, now = new Date() } = {}) {
  state.memoryItems ||= [];
  const learnings = consolidateMemory(state, { scope, now });
  const existing = new Map(state.memoryItems.filter((item) => item.kind === "LEARNING").map((item) => [item.id, item]));
  for (const learning of learnings) {
    const prior = existing.get(learning.id);
    if (prior) Object.assign(prior, learning, { updatedAt: iso(now) });
    else state.memoryItems.push(learning);
  }
  return learnings;
}

export function retractMemoryEvidence(state, evidenceRef, { now = new Date() } = {}) {
  const ref = text(evidenceRef, 240);
  if (!ref) throw new Error("evidence reference is required");
  let retracted = 0;
  for (const item of state.memoryItems || []) {
    if ((item.evidenceRefs || []).includes(ref)) { item.retractedAt = iso(now); item.updatedAt = iso(now); retracted += 1; }
  }
  return { evidenceRef: ref, retracted };
}

export function normalizeProviderRecord(input = {}) {
  const id = text(input.id || input.providerId, 80);
  if (!id) throw new Error("provider id is required");
  const capabilities = boundedArray(input.capabilities, 32);
  const costClass = text(input.costClass, 40).toLowerCase() || "unknown";
  const successRate = Number.isFinite(Number(input.successRate)) ? Math.min(1, Math.max(0, Number(input.successRate))) : null;
  return { id, capabilities, tools: boundedArray(input.tools, 32), reasoningClasses: boundedArray(input.reasoningClasses || (input.reasoningClass ? [input.reasoningClass] : []), 8), installed: input.installed === true, authReady: input.authReady === true, healthy: input.healthy === true, privacyClasses: boundedArray(input.privacyClasses || ["local"], 8), contextSize: Math.max(0, Number(input.contextSize) || 0), costClass, latencyMs: Number.isFinite(Number(input.latencyMs)) ? Math.max(0, Number(input.latencyMs)) : null, successRate, adapter: input.adapter || null };
}

export function providerAvailability(record) {
  const provider = normalizeProviderRecord(record);
  return { id: provider.id, installed: provider.installed, authReady: provider.authReady, healthy: provider.healthy, executionSucceeded: false, available: provider.installed && provider.authReady && provider.healthy, capabilities: provider.capabilities, tools: provider.tools, reasoningClasses: provider.reasoningClasses, successRate: provider.successRate };
}

export async function routeAgentTask(task = {}, { providers = [], now = new Date(), timeoutMs = 20_000 } = {}) {
  const capability = text(task.capability, 100);
  const privacy = text(task.privacyClass || "local", 40);
  const taskTools = boundedArray(task.tools, 16);
  const normalizedProviders = providers.map(normalizeProviderRecord);
  const availability = normalizedProviders.map(providerAvailability);
  const reasoningClass = text(task.reasoningClass, 40);
  const candidates = normalizedProviders.filter((provider) => provider.capabilities.includes(capability) && provider.installed && provider.authReady && provider.healthy && provider.privacyClasses.includes(privacy) && (!task.contextSize || provider.contextSize >= task.contextSize) && (!reasoningClass || provider.reasoningClasses.includes(reasoningClass)) && taskTools.every((tool) => provider.tools.includes(tool))).sort((a, b) => ((COST_RANK[a.costClass] ?? COST_RANK.unknown) - (COST_RANK[b.costClass] ?? COST_RANK.unknown) || (b.successRate ?? 0) - (a.successRate ?? 0) || (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9) || a.id.localeCompare(b.id)));
  const attempted = [];
  for (const provider of candidates) {
    const startedAt = iso(now);
    if (!provider.adapter || typeof provider.adapter.infer !== "function") { attempted.push({ providerId: provider.id, status: "unavailable", reason: "adapter_missing" }); continue; }
    const controller = new AbortController();
    const boundedTimeoutMs = Math.max(1, Math.min(120_000, Number(timeoutMs) || 20_000));
    const timer = setTimeout(() => controller.abort(), boundedTimeoutMs);
    let raceTimer;
    try {
      const result = await Promise.race([
        provider.adapter.infer({ task: { capability, privacyClass: privacy, tools: taskTools, reasoningClass: reasoningClass || null, contextSize: task.contextSize || null }, signal: controller.signal }),
        new Promise((_, reject) => { raceTimer = setTimeout(() => reject(Object.assign(new Error("provider timeout"), { name: "AbortError" })), boundedTimeoutMs); })
      ]);
      clearTimeout(timer);
      clearTimeout(raceTimer);
      if (!result || typeof result !== "object") { attempted.push({ providerId: provider.id, status: "invalid_result", reason: "empty_or_invalid" }); continue; }
      if (result.ok !== true) {
        const nonzero = Number.isFinite(Number(result.exitCode)) && Number(result.exitCode) !== 0;
        attempted.push({ providerId: provider.id, status: nonzero ? "nonzero" : "invalid_result", reason: nonzero ? `exit_code_${Number(result.exitCode)}` : "empty_or_invalid" });
        continue;
      }
      if (!text(result.output, 2_000)) { attempted.push({ providerId: provider.id, status: "invalid_result", reason: "empty_or_invalid" }); continue; }
      return { schemaVersion: 1, decisionId: `provider-decision-${digest({ capability, privacy, reasoningClass, taskTools, provider: provider.id, startedAt }, 24)}`, providerId: provider.id, status: "SUCCEEDED", startedAt, completedAt: new Date().toISOString(), attempted: [...attempted, { providerId: provider.id, status: "executionSucceeded" }], availability: availability.map((item) => item.id === provider.id ? { ...item, executionSucceeded: true } : item), output: text(result.output, 2_000), telemetry: { capability, privacyClass: privacy, reasoningClass: reasoningClass || null, tools: taskTools, providerId: provider.id, successRate: provider.successRate } };
    } catch (error) {
      clearTimeout(timer);
      clearTimeout(raceTimer);
      const reason = error?.name === "AbortError" ? "timeout" : "nonzero";
      attempted.push({ providerId: provider.id, status: reason, reason: redacted(error?.message || reason, 160) });
    }
  }
  const capabilityMatches = normalizedProviders.filter((item) => item.capabilities.includes(capability));
  const privacyMismatch = capabilityMatches.some((item) => item.installed && item.authReady && item.healthy && !item.privacyClasses.includes(privacy));
  const failure = attempted.at(-1)?.status || (privacyMismatch ? "privacy_mismatch" : "unavailable");
  return { schemaVersion: 1, decisionId: `provider-decision-${digest({ capability, privacy, reasoningClass, taskTools, attempted }, 24)}`, providerId: null, status: "FAILED", failure: ROUTE_FAILURES.has(failure) ? failure : "unavailable", attempted, availability, telemetry: { capability, privacyClass: privacy, reasoningClass: reasoningClass || null, tools: taskTools } };
}

export function projectOiBrowserIntegration(state, { now = new Date() } = {}) {
  const items = retrieveBoundedMemory(state, { limit: 12, now });
  const snapshots = (state?.browserSnapshots || []).slice(-12).map((item) => ({ ...item, html: undefined }));
  return {
    integrationVersion: OI_BROWSER_INTEGRATION_VERSION,
    sourceRevision: OI_BROWSER_SOURCE_REVISION,
    memory: { total: (state?.memoryItems || []).length, fresh: items.length, learnings: (state?.memoryItems || []).filter((item) => item.kind === "LEARNING" && memoryItemIsFresh(item, now)).length, recent: items },
    browser: { totalSnapshots: (state?.browserSnapshots || []).length, recent: snapshots, liveVerified: snapshots.filter((item) => item.source === "LIVE_DOM").length, staticOnly: snapshots.filter((item) => item.source !== "LIVE_DOM").length },
    executions: { total: (state?.browserExecutions || []).length, recent: (state?.browserExecutions || []).slice(-12) },
    providers: { recentDecisions: (state?.providerDecisions || []).slice(-12), healthy: (state?.providerDecisions || []).filter((item) => item.status === "SUCCEEDED").length },
    autoGtm: { sourceRevision: AUTO_GTM_SOURCE_REVISION, capability: "lead-feed", generation: "not_claimed" },
    evidenceStatus: "IMPLEMENTED"
  };
}

export { MEMORY_KINDS, PROVIDER_STATES };
