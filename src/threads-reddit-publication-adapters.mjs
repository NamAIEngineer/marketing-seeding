import { createHash } from "node:crypto";
import { createReadStream as fileStream } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { contentSha256, isPreSubmitMediaIntegrityProven, validateExecutionRequestV1 } from "./execution-contracts.mjs";
import { PLATFORM_ADAPTER_CONTRACT_VERSION, PLATFORM_CAPABILITIES } from "./platform-registries.mjs";
import { defaultPlatformPolicies } from "./platform-policies.mjs";
import { canonicalIdentityUrl } from "./execution-binding.mjs";
import { readinessBinding } from "./readiness.mjs";

/*
 * Standalone Camoufox publication seam for Threads and Reddit.
 *
 * Credentials never enter this module. The caller injects a browser surface
 * and final-submit transport, and owns authority/receipt persistence.
 * A click is command evidence only; publication requires independent proof.
 */

const SHA256 = /^[a-f0-9]{64}$/i;
const SECRET_KEY = /(password|passwd|cookie|bearer|token|credential|mfa|passkey|sessionstorage|localstorage|secret|authorizationheader)/i;
const CHALLENGE_TEXT = /(?:captcha|recaptcha|security\s*check|checkpoint|two[-\s]?factor|multi[-\s]?factor|one[-\s]?time\s+(?:code|password)|verify\s+(?:your|it(?:'s|\s+you))|suspicious\s+(?:login|activity)|account\s+(?:locked|suspended|restricted)|access\s+(?:blocked|denied)|rate\s*limit|too\s+many\s+requests)/i;
const caps = Object.freeze({
  supportsText: true,
  supportsImage: true,
  supportsVideo: true,
  // Audience/community selection is target-bound and separately gated; these
  // adapters do not expose an arbitrary audience selector.
  supportsAudienceSelection: false,
  supportsDirectFileAttach: true,
  supportsPublicationVerification: true,
  supportsPermalinkDiscovery: true,
  supportsReconciliation: true
});
const text = (value, limit = 320) => typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) : "";
const hash = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const nowIso = () => new Date().toISOString();
const failure = (code, message) => Object.assign(new Error(message), { code });
const safeCode = (value, fallback = "ADAPTER_FAILED") => {
  const candidate = String(value || "").toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 100);
  return /^[A-Z][A-Z0-9_]{2,99}$/.test(candidate) ? candidate : fallback;
};

function rejectSecrets(value, location = "value", depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw failure("SECRET_FIELD_REJECTED", location + "." + key + " is not accepted");
    if (typeof child === "string" && /bearer\s+|cookie\s*=|access[_ -]?token|session[_ -]?token/i.test(child)) throw failure("SECRET_VALUE_REJECTED", location + "." + key + " is not accepted");
    if (child && typeof child === "object") rejectSecrets(child, location + "." + key, depth + 1);
  }
}

function httpsUrl(value, hosts = null) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:") return null;
    url.hostname = url.hostname.toLowerCase();
    if (hosts && !hosts.includes(url.hostname.replace(/^www\./, ""))) return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    return url;
  } catch {
    return null;
  }
}

function identityUrl(platform, value) {
  const rule = DESCRIPTORS[String(platform || "").toLowerCase()];
  const parsed = rule ? httpsUrl(value, rule.hosts) : null;
  if (!parsed || !rule?.identityPath.test(parsed.pathname)) return null;
  return canonicalIdentityUrl(parsed.toString());
}

function targetUrl(platform, value) {
  if (!defaultPlatformPolicies.allowsTargetUrl(platform, value)) return null;
  const policy = defaultPlatformPolicies.resolve(platform);
  return httpsUrl(value, policy?.allowedTargetHosts || [])?.toString() || null;
}

function profileOf(tab) {
  return typeof tab?.profile === "string" ? tab.profile : tab?.profile?.id || tab?.profile?.profileId || tab?.profileId || "";
}
function pageOf(tab) { return tab?.browserPageId || tab?.pageId || tab?.id || null; }
function stableId(value) {
  try { return new URL(String(value)).pathname.split("/").filter(Boolean).pop()?.replace(/^@/, "").toLowerCase() || null; } catch { return null; }
}
function safeTimestamp(value) { return Number.isFinite(Date.parse(value || "")) ? new Date(value).toISOString() : null; }
function challengeObserved(value) {
  const state = String(value?.state || value?.status || value?.authState || "").toUpperCase();
  return value?.challengeDetected === true || value?.securityChallenge === true || value?.blocked === true ||
    ["CHALLENGE", "CHALLENGED", "CAPTCHA", "MFA", "SECURITY_CHALLENGE", "LOGIN_REQUIRED", "AUTH_REQUIRED", "RATE_LIMITED", "BLOCKED"].includes(state);
}
function challengeSnapshot(value) { return typeof value === "string" && CHALLENGE_TEXT.test(value); }

const DESCRIPTORS = Object.freeze({
  threads: Object.freeze({
    platform: "threads", hosts: Object.freeze(["threads.net", "threads.com"]),
    identitySource: "threads-owner-profile-surface", rightsSource: "threads-composer",
    identityPath: /^\/@[a-z0-9][a-z0-9._-]{0,49}$/i,
    targetPath: (pathname) => /^\/@[a-z0-9][a-z0-9._-]{0,49}(?:\/.*)?$/i.test(pathname) || /^\/post\/[a-z0-9_-]+$/i.test(pathname),
    publicationPath: /\/@[^/]+\/post\//i, submitLabel: /^(?:post|share|publish|send)$/i
  }),
  reddit: Object.freeze({
    platform: "reddit", hosts: Object.freeze(["reddit.com"]),
    identitySource: "reddit-owner-profile-surface", rightsSource: "reddit-community-composer",
    identityPath: /^\/user\/[a-z0-9_-]{3,50}$/i,
    targetPath: (pathname) => /^\/r\/[a-z0-9_+-]{2,80}(?:\/.*)?$/i.test(pathname) || /^\/user\/[a-z0-9_-]{3,50}(?:\/.*)?$/i.test(pathname),
    publicationPath: /\/comments\/|\/post\//i, submitLabel: /^(?:post|submit|publish|comment|send)$/i
  })
});

function descriptor(platform) {
  const rule = DESCRIPTORS[String(platform || "").toLowerCase()];
  if (!rule) throw failure("PLATFORM_UNSUPPORTED", "only Threads and Reddit are supported");
  return rule;
}

function expressionFor(rule, kind, target = "", content = "") {
  const hosts = JSON.stringify(rule.hosts);
  const targetLiteral = JSON.stringify(target);
  const contentLiteral = JSON.stringify(String(content || ""));
  if (kind === "identity") return [
    "/* ", rule.platform, "_owner_identity */ (() => {",
    "const hosts=", hosts, "; const visible=n=>Boolean(n&&n.getClientRects&&n.getClientRects().length);",
    "const parse=v=>{try{const u=new URL(v,location.href);const h=u.hostname.toLowerCase().replace(/^www\\./,'');const p=(u.pathname.replace(/\\/{2,}/g,'/').replace(/\\/$/,'')||'/').toLowerCase();if(!hosts.includes(h))return null;",
    "const m=h==='reddit.com'?p.match(/^\\/user\\/([a-z0-9_-]{3,50})$/i):p.match(/^\\/@([a-z0-9][a-z0-9._-]{0,49})$/i);",
    "return m?{reference:(h==='reddit.com'?'https://reddit.com/user/':'https://threads.net/@')+m[1].toLowerCase(),stableId:m[1].toLowerCase()}:null}catch{return null}};",
    "const candidates=[...document.querySelectorAll('a[href]')].filter(visible).map(n=>{const i=parse(n.href);return i&&n.closest('nav,header,[role=\"navigation\"],[data-testid*=\"profile\"],[data-testid*=\"account\"]')?i:null}).filter(Boolean);",
    "const unique=candidates.filter((x,i,a)=>a.findIndex(y=>y.reference===x.reference)===i);const one=unique.length===1?unique[0]:null;",
    "const challenge=/(?:checkpoint|challenge|captcha|security[-_]check|login)/i.test(location.pathname);",
    "return{authenticated:Boolean(one),authenticatedSurface:Boolean(one),ownerSurface:Boolean(one),identityReference:one?.reference||null,stableId:one?.stableId||null,source:one?\"", rule.identitySource, "\":null,candidateCount:unique.length,ambiguous:unique.length>1,challengeDetected:challenge};})()"
  ].join("");
  if (kind === "target") return [
    "/* ", rule.platform, "_posting_rights */ (() => {",
    "const expected=new URL(", targetLiteral, ",location.href);const actual=new URL(location.href);const norm=u=>u.origin.toLowerCase()+(u.pathname.replace(/\\/$/,'')||'/')+u.search;",
    "const targetMatched=norm(actual)===norm(expected)||actual.pathname.toLowerCase().startsWith(expected.pathname.toLowerCase().replace(/\\/$/,'')+'/');",
    "const explicit=document.querySelector('[data-can-post],[data-posting-rights],[data-membership-status],[data-posting-status]');",
    "const editors=[...document.querySelectorAll('textarea,[contenteditable=\"true\"],[role=\"textbox\"]')].filter(n=>n.getClientRects().length);",
    "const controls=[...document.querySelectorAll('button,[role=\"button\"]')].filter(n=>n.getClientRects().length);const label=n=>(n.getAttribute('aria-label')||n.innerText||n.textContent||'').trim();",
    "const submit=controls.find(n=>", rule.submitLabel.toString(), ".test(label(n)));const can=explicit?.getAttribute('data-can-post');",
    "const membership=(explicit?.getAttribute('data-membership-status')||'').toLowerCase();const posting=(explicit?.getAttribute('data-posting-status')||'').toLowerCase();",
    "const challenge=Boolean(document.querySelector('[data-auth-state=\"challenge\"],[data-security-challenge],[data-rate-limited]'));",
    "return{targetMatched,canPost:can==='true'||(editors.length===1&&Boolean(submit)&&submit.disabled!==true&&submit.getAttribute('aria-disabled')!=='true'),authenticatedSurface:Boolean(explicit||editors.length||submit),rightsDeclared:can==='true'||can==='false'||Boolean(membership||posting),membershipRequired:membership==='required'||membership==='not_member'||posting==='blocked',membershipStatus:membership||null,postingStatus:posting||null,source:\"", rule.rightsSource, "\",composerVisible:editors.length===1,submitControlVisible:Boolean(submit),submitControlEnabled:Boolean(submit&&submit.disabled!==true&&submit.getAttribute('aria-disabled')!=='true'),challengeDetected:challenge};})()"
  ].join("");
  if (kind === "composer") return [
    "/* ", rule.platform, "_composer_state */ (() => {const visible=n=>Boolean(n&&n.getClientRects&&n.getClientRects().length);",
    "const roots=[...document.querySelectorAll('dialog,[role=\"dialog\"],main')].filter(visible);const editors=[...new Set(roots.flatMap(r=>[...r.querySelectorAll('[contenteditable=\"true\"],textarea,[role=\"textbox\"]')].filter(visible)))];",
    "const buttons=[...new Set(roots.flatMap(r=>[...r.querySelectorAll('button,[role=\"button\"]')].filter(visible)))];const label=n=>(n.getAttribute('aria-label')||n.innerText||n.textContent||'').trim();",
    "const submit=buttons.filter(n=>", rule.submitLabel.toString(), ".test(label(n)));const editor=editors.length===1?editors[0]:null;",
    "return{composerCount:roots.length,editorCount:editors.length,editorText:editor?(editor.innerText||editor.value||editor.textContent||''):null,submitCount:submit.length,submitControls:submit.map(n=>({enabled:n.disabled!==true&&n.getAttribute('aria-disabled')!=='true',name:label(n)})),fileInputCount:document.querySelectorAll('input[type=file]').length,mediaPreviewReady:Boolean(document.querySelector('[data-media-preview=\"ready\"],[data-testid*=\"media-preview\"]')),challengeDetected:Boolean(document.querySelector('[data-auth-state=\"challenge\"],[data-security-challenge],[data-rate-limited]'))};})()"
  ].join("");
  return [
    "/* ", rule.platform, "_publication_candidates */ (() => {const expected=", contentLiteral, ";const cards=[...document.querySelectorAll('article,[data-post-id],[data-testid*=\"post\"],[data-testid*=\"comment\"]')];",
    "return cards.map(card=>{const cardText=String(card.innerText||card.textContent||'');const links=[...card.querySelectorAll('a[href]')].map(a=>{try{return new URL(a.href,location.href)}catch{return null}}).filter(Boolean);",
    "const permalink=links.find(u=>u.hostname.toLowerCase().replace(/^www\\./,'')==='reddit.com'&&/\\/comments\\/|\\/post\\//i.test(u.pathname))||links.find(u=>u.hostname.toLowerCase().replace(/^www\\./,'')==='threads.net'&&/\\/@[^/]+\\/post\\//i.test(u.pathname));",
    "const author=links.find(u=>u.pathname.replace(/\\/$/,'').toLowerCase()===new URL(", targetLiteral, ",location.href).pathname.replace(/\\/$/,'').toLowerCase());const time=card.querySelector('time[datetime],[data-timestamp]');",
    "return{contentMatched:cardText.includes(expected),authorMatched:Boolean(author),authorPath:author?.pathname.replace(/\\/$/,'').toLowerCase()||null,targetMatched:Boolean(permalink),permalink:permalink?.toString()||null,postId:card.getAttribute('data-post-id')||card.getAttribute('data-id')||null,timestamp:time?.getAttribute('datetime')||time?.getAttribute('data-timestamp')||null,mediaPresent:Boolean(card.querySelector('video,img[src]')),mediaType:card.querySelector('video')?'video':card.querySelector('img[src]')?'image':null};}).filter(x=>x.permalink||x.postId);})()"
  ].join("");
}

async function hashFile(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of fileStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

async function validMediaType(filePath, declaredType) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    const read = await handle.read(buffer, 0, 16, 0);
    const head = buffer.subarray(0, read.bytesRead);
    if (declaredType === "image/png") return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (declaredType === "image/jpeg") return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (declaredType === "video/mp4") return head.length >= 8 && head.toString("ascii", 4, 8) === "ftyp";
    return false;
  } finally {
    await handle.close();
  }
}

function candidateOf(value) {
  if (!value || typeof value !== "object") return null;
  const permalink = httpsUrl(value.permalink || value.publicationUrl || value.url);
  return {
    postId: text(value.postId || value.activityId || value.id, 160) || null,
    permalink: permalink?.toString() || null,
    authorMatched: value.authorMatched === true || value.accountMatched === true,
    authorPath: text(value.authorPath || value.observedAuthorPath || value.authorIdentity?.observedPath, 240).toLowerCase() || null,
    targetMatched: value.targetMatched === true,
    contentMatched: value.contentMatched === true,
    timestamp: safeTimestamp(value.timestamp || value.candidateTimestamp),
    timestampMatched: value.timestampMatched === true,
    mediaPresent: value.mediaPresent === true,
    mediaType: text(value.mediaType, 40).toLowerCase() || null,
    mediaHashStatus: text(value.mediaHashStatus || value.hashStatus || "NOT_VERIFIABLE", 40).toUpperCase(),
    mediaSha256: SHA256.test(String(value.mediaSha256 || value.sha256 || "")) ? String(value.mediaSha256 || value.sha256).toLowerCase() : null,
    surface: text(value.surface || "read_only_activity", 80)
  };
}

/**
 * Independent evidence verifier. Missing or ambiguous proof always remains
 * UNKNOWN. It never invents a URL, publication reference, metric or approval.
 */
export function verifyThreadsRedditPublicationEvidence(expected = {}, observed = {}) {
  const platform = String(expected.platform || "").toLowerCase();
  const rule = descriptor(platform);
  const candidate = candidateOf(observed.candidate || observed);
  const identity = identityUrl(platform, expected.identityReference || expected.expectedIdentityUrl);
  const target = targetUrl(platform, expected.targetUrl || expected.target?.url);
  const submittedAt = Date.parse(expected.submittedAt || "");
  const observedAt = Date.parse(observed.observedAt || "");
  const candidateAt = Date.parse(candidate?.timestamp || "");
  const timeMatched = Number.isFinite(submittedAt) && Number.isFinite(observedAt) && Number.isFinite(candidateAt) && candidateAt >= submittedAt && candidateAt <= observedAt;
  const permalink = candidate?.permalink ? httpsUrl(candidate.permalink, rule.hosts) : null;
  const permalinkMatched = Boolean(permalink && rule.publicationPath.test(permalink.pathname));
  const identityMatched = Boolean(identity && candidate?.authorMatched === true && candidate.authorPath === new URL(identity).pathname.replace(/\/$/, "").toLowerCase());
  const targetMatched = candidate?.targetMatched === true || Boolean(permalink && target && permalink.pathname.toLowerCase().startsWith(new URL(target).pathname.toLowerCase()));
  const contentMatched = candidate?.contentMatched === true && String(observed.contentHash || expected.contentHash || "") === String(expected.contentHash || "");
  const media = expected.media || null;
  const mediaStatus = candidate?.mediaHashStatus || "NOT_VERIFIABLE";
  const mediaMatched = !media || (candidate?.mediaPresent === true && ((mediaStatus === "MATCHED" && candidate.mediaSha256 === media.sha256) || (mediaStatus === "NOT_VERIFIABLE" && isPreSubmitMediaIntegrityPro(expected.preSubmitMediaIntegrity, media))));
  const strong = Boolean(candidate?.postId && permalink && permalinkMatched && identityMatched && targetMatched && contentMatched && (candidate.timestampMatched === true || timeMatched) && mediaMatched);
  const evidence = candidate ? {
    verifiedAt: observed.observedAt || null, accountMatched: identityMatched, targetMatched: Boolean(targetMatched), contentHashMatched: contentMatched,
    mediaHashMatched: !media || mediaStatus === "MATCHED" && candidate.mediaSha256 === media.sha256 || mediaStatus === "NOT_VERIFIABLE" && isPreSubmitMediaIntegrityPro(expected.preSubmitMediaIntegrity, media),
    accountId: expected.accountId || "unknown", profileId: expected.profileId || "unknown", targetId: expected.targetId || "unknown",
    contentHash: expected.contentHash || "", mediaHash: mediaStatus === "MATCHED" ? candidate.mediaSha256 : null,
    verificationMethod: platform + "_read_only_activity_dom", evidenceReference: candidate.permalink || candidate.postId || null,
    preSubmitMediaIntegrity: expected.preSubmitMediaIntegrity || null,
    verificationDetails: {
      executionId: expected.executionId || null, submittedAt: expected.submittedAt || null, observedAt: observed.observedAt || null,
      authorIdentity: { expectedPath: identity ? new URL(identity).pathname.toLowerCase() : "", observedPath: identityMatched && identity ? new URL(identity).pathname.toLowerCase() : null, matched: identityMatched },
      contentMatch: { expectedSha256: expected.contentHash || "", matched: contentMatched },
      candidate: { surface: candidate.surface, postId: candidate.postId, permalink: candidate.permalink, timestamp: candidate.timestamp, timestampMatched: candidate.timestampMatched === true || timeMatched },
      media: media ? { present: candidate.mediaPresent === true, type: candidate.mediaType || null, hashStatus: mediaStatus } : null,
      confirmationSignals: ["account_identity", "target_identity", "content_hash", "timestamp", "stable_permalink"]
    }
  } : null;
  if (strong) return { state: "CONFIRMED", publicationReference: candidate.postId, publicationUrl: candidate.permalink, verifiedAt: observed.observedAt, reasonCode: null, verificationEvidence: evidence, publicationEvidence: evidence };
  return { state: "UNKNOWN", publicationReference: candidate?.postId || null, publicationUrl: candidate?.permalink || null, verifiedAt: null, reasonCode: candidate ? "PUBLICATION_VERIFICATION_INCOMPLETE" : "PUBLICATION_NOT_OBSERVED", verificationEvidence: evidence, publicationEvidence: evidence };
}

function outcome(state, reasonCode, startedAt, extra = {}) {
  const submitState = ["NOT_STARTED", "SUBMIT_SENT", "CONFIRMED", "UNKNOWN", "FAILED"].includes(state) ? state : "FAILED";
  return { status: submitState === "FAILED" && /CHALLENGE|BLOCKED/.test(String(reasonCode || "")) ? "BLOCKED" : submitState, submitState, reasonCode: reasonCode ? safeCode(reasonCode) : null, startedAt, finishedAt: nowIso(), durationMs: Math.max(0, Date.now() - Date.parse(startedAt)), browserCommands: 0, computerUseCalls: 0, retries: 0, ...extra };
}

export class ThreadsRedditPublicationAdapter {
  constructor(platform, { browser = null, transport = null, verifier = null, now = () => new Date(), timeoutMs = 15_000 } = {}) {
    this.rule = descriptor(platform);
    this.platform = this.rule.platform;
    this.contractVersion = PLATFORM_ADAPTER_CONTRACT_VERSION;
    this.capabilities = caps;
    this.browser = browser;
    this.transport = transport;
    this.verifier = verifier;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this._attempts = new Map();
    this.identityExpression = expressionFor(this.rule, "identity");
    this.composerExpression = expressionFor(this.rule, "composer");
    this.targetExpression = (value) => expressionFor(this.rule, "target", value);
    this.verificationExpression = (target, content) => expressionFor(this.rule, "verify", target, content);
  }

  async _surface(options) {
    const browser = options.browserSurface || options.executionSession?.browserSurface || this.browser;
    if (!browser) throw failure("CAMOUFOX_SURFACE_UNAVAILABLE", "Camoufox browser surface is required");
    const required = ["listTabs", "showTab", "navigate", "evaluate", "snapshot", "resolve", "fill"];
    const missing = required.filter((name) => typeof browser[name] !== "function");
    if (missing.length) throw Object.assign(failure("CAMOUFOX_SURFACE_UNSUPPORTED", "Camoufox surface lacks required capabilities"), { missingCapabilities: missing });
    return browser;
  }

  async _page(request, browser) {
    const tabs = await browser.listTabs();
    const owned = tabs.filter((tab) => profileOf(tab) === request.profileId || profileOf(tab) === request.providerProfileId);
    if (owned.length !== 1) throw failure(owned.length ? "IDENTITY_AMBIGUOUS" : "PROFILE_NOT_FOUND", "exact provider profile must own one browser tab");
    const tab = await browser.showTab(pageOf(owned[0]));
    if (profileOf(tab) && profileOf(tab) !== request.profileId && profileOf(tab) !== request.providerProfileId) throw failure("ACCOUNT_PROFILE_MISMATCH", "browser profile changed during execution");
    return { pageId: pageOf(tab), tab };
  }

  async _identity(request, account, browser, pageId) {
    const expected = identityUrl(this.platform, request.identityReference || account?.identityReference || account?.expectedIdentityUrl);
    if (!expected) throw failure("IDENTITY_MISMATCH", "exact platform identity reference is required");
    const observed = await browser.evaluate(pageId, this.identityExpression);
    if (challengeObserved(observed)) throw failure("SECURITY_CHALLENGE", "identity surface reports a challenge or blocked state");
    const seen = identityUrl(this.platform, observed?.identityReference);
    const proven = observed?.authenticated === true && observed?.authenticatedSurface === true && observed?.ownerSurface === true && observed?.ambiguous !== true && Number(observed?.candidateCount ?? 1) === 1 && observed?.source === this.rule.identitySource && seen === expected && stableId(seen) === stableId(expected);
    if (!proven) throw failure(seen && seen !== expected ? "IDENTITY_MISMATCH" : "IDENTITY_PROOF_INSUFFICIENT", "exact owner identity was not independently proven");
    return { expected, observed };
  }

  async _target(request, browser, pageId) {
    const target = targetUrl(this.platform, request.target?.url);
    const parsed = httpsUrl(target, this.rule.hosts);
    if (!target || !parsed || !this.rule.targetPath(parsed.pathname)) throw failure("TARGET_MISMATCH", "target URL is not an exact allowlisted platform destination");
    const observed = await browser.evaluate(pageId, this.targetExpression(target));
    if (challengeObserved(observed)) throw failure("SECURITY_CHALLENGE", "target surface reports a challenge or blocked state");
    if (observed?.targetMatched !== true) throw failure("TARGET_MISMATCH", "browser target differs from approved target");
    if (observed?.canPost !== true || observed?.authenticatedSurface !== true || observed?.submitControlEnabled !== true) throw failure(observed?.membershipRequired || observed?.postingStatus === "blocked" ? "TARGET_POSTING_BLOCKED" : "TARGET_POSTING_RIGHTS_UNVERIFIED", "target posting rights were not explicitly proven");
    return { target, observed };
  }

  async _composer(browser, pageId) {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const observed = await browser.evaluate(pageId, this.composerExpression);
      if (challengeObserved(observed)) throw failure("SECURITY_CHALLENGE", "composer reports a challenge or blocked state");
      if (observed?.composerCount === 1 && observed?.editorCount === 1 && observed?.submitCount === 1 && observed?.submitControls?.[0]?.enabled === true) return observed;
      await sleep(50);
    }
    throw failure("UNKNOWN_COMPOSER", "composer/editor/submit control was not uniquely identified");
  }

  async _fill(request, browser, pageId, composer) {
    const ref = await browser.resolve(pageId, /textbox|post|body|content|title/i);
    if (!ref) throw failure("CONTENT_MISMATCH", "composer editor reference unavailable");
    await browser.fill(pageId, ref, request.content.payload);
    const observed = await browser.evaluate(pageId, this.composerExpression);
    const actual = String(observed?.editorText ?? request.content.payload);
    if (actual !== request.content.payload || hash(actual) !== request.content.sha256) throw failure("CONTENT_MISMATCH", "rendered composer content does not match approved hash");
    return { ...composer, editorRef: ref, contentMatched: true };
  }

  async _media(request, browser, pageId) {
    if (!request.media.length) return { mediaHashMatched: true, mediaPreviewConfirmed: true, preSubmitMediaIntegrity: null };
    if (request.media.length !== 1) throw failure("MEDIA_MISMATCH", "exactly one approved media artifact is supported");
    const media = request.media[0];
    if (!path.isAbsolute(media.reference) || !SHA256.test(media.sha256)) throw failure("MEDIA_MISMATCH", "media reference must be absolute and hash-bound");
    const localHash = await hashFile(media.reference).catch(() => null);
    if (!localHash || localHash !== media.sha256 || !(await validMediaType(media.reference, media.type).catch(() => false))) throw failure("MEDIA_MISMATCH", "local media does not match approved hash and MIME type");
    const ref = await browser.resolve(pageId, /file|media|upload|attach/i);
    if (!ref || typeof browser.upload !== "function") throw failure("MEDIA_MISMATCH", "Camoufox media upload capability is unavailable");
    await browser.upload(pageId, ref, media.reference);
    const observed = await browser.evaluate(pageId, this.composerExpression);
    if (observed?.mediaPreviewReady !== true) throw failure("MEDIA_MISMATCH", "media preview readiness was not independently observed");
    return { mediaHashMatched: true, mediaPreviewConfirmed: true, preSubmitMediaIntegrity: { artifactId: media.artifactId, expectedSha256: media.sha256, localFileSha256: localHash, mediaType: media.type, attached: true, previewReady: true } };
  }

  _gates(request, account, identity, target, composer, media, dryRun) {
    const checkedAt = Date.parse(request.readiness?.checkedAt || "");
    const expiresAt = Date.parse(request.readiness?.expiresAt || "");
    const expectedReadinessBinding = readinessBinding({
      platform: request.platform,
      accountId: request.accountId,
      profileId: request.profileId,
      targetId: request.target.targetId,
      provider: request.provider,
      providerProfileId: request.providerProfileId,
      identityReference: request.identityReference,
      targetUrl: request.target.url
    });
    const gates = {
      platformMatch: request.platform === this.platform,
      accountMatch: Boolean(account && account.status === "enabled" && account.health === "healthy" && account.accountId === request.accountId),
      profileMatch: Boolean(account && account.profileId === request.profileId),
      identityMatch: Boolean(identity),
      targetMatch: target.observed.targetMatched === true,
      postingRights: target.observed.canPost === true && target.observed.submitControlEnabled === true,
      authorizationValid: Boolean(request.authorization?.authorizationId && request.authorization?.binding),
      liveGrantValid: dryRun || Boolean(request.liveGrant?.grantId),
      readinessFresh: request.readiness?.state === "READY" && Number.isFinite(checkedAt) && Number.isFinite(expiresAt) && checkedAt <= this.now().getTime() && expiresAt > this.now().getTime(),
      readinessBindingMatch: request.readiness?.binding === expectedReadinessBinding,
      contentHashMatch: composer.contentMatched === true && request.content.sha256 === contentSha256(request.content.payload),
      mediaHashMatch: media.mediaHashMatched === true,
      mediaPreviewConfirmed: media.mediaPreviewConfirmed === true,
      composerConfirmed: true,
      noDuplicateReceipt: !this._attempts.has(request.idempotencyKey)
    };
    if (!Object.values(gates).every(Boolean)) {
      const failedGate = Object.entries(gates).find(([, value]) => value !== true)?.[0] || "submit";
      const reasonCodes = { platformMatch: "PLATFORM_MISMATCH", accountMatch: "ACCOUNT_PROFILE_MISMATCH", profileMatch: "ACCOUNT_PROFILE_MISMATCH", identityMatch: "IDENTITY_MISMATCH", targetMatch: "TARGET_MISMATCH", postingRights: "TARGET_POSTING_RIGHTS_UNVERIFIED", authorizationValid: "STANDING_AUTHORITY_MISSING", liveGrantValid: "LIVE_GRANT_MISSING", readinessFresh: "READINESS_NOT_FRESH", readinessBindingMatch: "READINESS_BINDING_MISMATCH", contentHashMatch: "CONTENT_MISMATCH", mediaHashMatch: "MEDIA_MISMATCH", mediaPreviewConfirmed: "MEDIA_MISMATCH", composerConfirmed: "COMPOSER_UNVERIFIED", noDuplicateReceipt: "IDEMPOTENCY_ALREADY_ATTEMPTED" };
      const reasonCode = reasonCodes[failedGate] || "PRE_SUBMIT_GATE_FAILED";
      throw Object.assign(failure(reasonCode, "pre-submit gate failed: " + failedGate), { gates, verificationGates: gates, preSubmitFailure: { reasonCode, stage: "adapter_pre_submit", gate: failedGate, gateStatus: false } });
    }
    return gates;
  }

  async _click(request, browser, pageId, submitRef, gates, media, options) {
    if (typeof options.beforeSubmitIntent !== "function" || typeof options.onSubmitSent !== "function") throw failure("LIVE_AUTHORITY_CALLBACK_REQUIRED", "durable submit callbacks are required before click");
    const boundary = { platform: this.platform, targetId: request.target.targetId, idempotencyKey: request.idempotencyKey, transportIdentity: options.transportIdentity || null, preSubmitMediaIntegrity: media.preSubmitMediaIntegrity || null };
    await options.beforeSubmitIntent(gates, boundary);
    const transport = options.transport || options.executionSession?.transport || this.transport || browser;
    if (!transport || typeof transport.click !== "function") { const error = failure("CAMOUFOX_SUBMIT_UNSUPPORTED", "Camoufox click transport is unavailable"); error.intentPersisted = true; throw error; }
    let click;
    try {
      if (typeof options.beforeProviderSend === "function") await options.beforeProviderSend();
      click = await transport.click({ pageId, targetRef: submitRef, targetIdentity: this.platform + ":" + request.target.targetId + ":" + submitRef }, { validate: async () => boundary, onProviderCallStarted: () => undefined });
    } catch (error) {
      error.intentPersisted = true;
      throw error;
    }
    const at = nowIso();
    const acceptance = { clickStatus: "CLICK_EMITTED", clickEmittedAt: at, observedAt: at, clickCommandEvidence: { status: click?.status === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "COMMAND_COMPLETED", observedAt: at, transport: options.transportIdentity?.transport || transport.runtimeIdentity?.().transport || "camoufox", targetIdentity: this.platform + ":" + request.target.targetId + ":" + submitRef }, platformAcceptance: "UNKNOWN" };
    try {
      await options.onSubmitSent(acceptance);
    } catch (error) {
      error.intentPersisted = true;
      error.clickEmitted = true;
      throw error;
    }
    return { submittedAt: at, acceptance };
  }

  async _verify(request, browser, pageId, submittedAt, media) {
    const expected = { platform: this.platform, executionId: request.executionId, accountId: request.accountId, profileId: request.profileId, targetId: request.target.targetId, targetUrl: request.target.url, identityReference: request.identityReference, contentHash: request.content.sha256, submittedAt, preSubmitMediaIntegrity: media.preSubmitMediaIntegrity || null, media: request.media[0] || null };
    let observed;
    if (this.verifier && typeof this.verifier.verify === "function") observed = await this.verifier.verify(request, pageId, { expected, submittedAt, preSubmitMediaIntegrity: media.preSubmitMediaIntegrity || null });
    else {
      const raw = await browser.evaluate(pageId, this.verificationExpression(request.target.url, request.content.payload));
      observed = Array.isArray(raw) ? { candidate: raw.find((item) => item?.contentMatched) || raw[0] || null, observedAt: nowIso(), contentHash: request.content.sha256 } : { ...(raw || {}), observedAt: raw?.observedAt || nowIso(), contentHash: request.content.sha256 };
    }
    const candidate = observed?.candidate || observed?.verificationEvidence?.verificationDetails?.candidate || observed?.publicationEvidence?.verificationDetails?.candidate || observed;
    return verifyThreadsRedditPublicationEvidence(expected, { ...(observed || {}), candidate });
  }

  async execute(input, options = {}) {
    const startedAt = this.now().toISOString();
    let request;
    try { rejectSecrets(input, "request"); request = validateExecutionRequestV1(input); } catch (error) { return outcome("FAILED", safeCode(error?.code, "EXECUTION_REQUEST_INVALID"), startedAt, { gates: { requestValid: false } }); }
    if (request.platform !== this.platform) return outcome("FAILED", "PLATFORM_MISMATCH", startedAt, { gates: { platformMatch: false } });
    const previous = this._attempts.get(request.idempotencyKey);
    if (previous) return { ...previous, duplicate: true, reasonCode: previous.submitState === "CONFIRMED" ? "IDEMPOTENCY_ALREADY_CONFIRMED" : "IDEMPOTENCY_ALREADY_ATTEMPTED" };
    const dryRun = options.dryRun === true;
    if (!dryRun && options.liveEnabled !== true) return outcome("FAILED", "LIVE_EXECUTION_NOT_AUTHORIZED", startedAt, { gates: { liveEnabled: false } });
    let submitted = false;
    let gates = {};
    let media = { mediaHashMatched: false, mediaPreviewConfirmed: false, preSubmitMediaIntegrity: null };
    try {
      const browser = await this._surface(options);
      const page = await this._page(request, browser);
      const account = options.account;
      if (!account || account.accountId !== request.accountId || account.profileId !== request.profileId || (account.identityReference && identityUrl(this.platform, account.identityReference) !== identityUrl(this.platform, request.identityReference))) throw failure("ACCOUNT_PROFILE_MISMATCH", "caller account/profile binding differs from request");
      await browser.navigate(page.pageId, targetUrl(this.platform, request.target.url) || request.target.url);
      const identity = await this._identity(request, account, browser, page.pageId);
      const target = await this._target(request, browser, page.pageId);
      const composer = await this._composer(browser, page.pageId);
      const filled = await this._fill(request, browser, page.pageId, composer);
      media = await this._media(request, browser, page.pageId);
      gates = this._gates(request, account, identity, target, filled, media, dryRun);
      const submitRef = await browser.resolve(page.pageId, this.rule.submitLabel);
      if (!submitRef) throw failure("SUBMIT_CONTROL_UNVERIFIED", "submit control was not uniquely resolved");
      if (dryRun) return outcome("NOT_STARTED", null, startedAt, { gates, adapterEvidence: { mode: "camoufox_dry_run", platform: this.platform, submitIntent: false, clickEmitted: false, publicationCreated: false, contentSha256: request.content.sha256, media: media.preSubmitMediaIntegrity ? [{ artifactId: media.preSubmitMediaIntegrity.artifactId, sha256: media.preSubmitMediaIntegrity.expectedSha256, type: media.preSubmitMediaIntegrity.mediaType }] : [] } });
      const click = await this._click(request, browser, page.pageId, submitRef, gates, media, options);
      submitted = true;
      const verification = await this._verify(request, browser, page.pageId, click.submittedAt, media);
      const common = { gates, submitAcceptanceEvidence: click.acceptance, publicationVerification: verification, publicationEvidence: verification.verificationEvidence || verification.publicationEvidence || null, publicationReference: verification.publicationReference || null, publicationUrl: verification.publicationUrl || null, adapterEvidence: { mode: "camoufox", platform: this.platform, submitIntent: true, clickEmitted: true, publicationCreated: verification.state === "CONFIRMED" } };
      const final = outcome(verification.state === "CONFIRMED" ? "CONFIRMED" : "UNKNOWN", verification.reasonCode, startedAt, common);
      this._attempts.set(request.idempotencyKey, final);
      return final;
    } catch (error) {
      const uncertain = submitted || error?.intentPersisted === true || error?.clickEmitted === true;
      const state = uncertain ? "UNKNOWN" : dryRun ? "NOT_STARTED" : "FAILED";
      const final = outcome(state, safeCode(error?.code, uncertain ? "SUBMIT_OUTCOME_UNKNOWN" : "ADAPTER_FAILED"), startedAt, { gates: error?.gates || gates, preSubmitFailure: error?.preSubmitFailure || (!uncertain && !dryRun ? { reasonCode: safeCode(error?.code), stage: "adapter_execution", gate: null, gateStatus: false } : undefined), adapterEvidence: { mode: "camoufox", platform: this.platform, submitIntent: uncertain, clickEmitted: submitted, publicationCreated: false } });
      if (uncertain) this._attempts.set(request.idempotencyKey, final);
      return final;
    }
  }

  async reconcile(input, options = {}) {
    const startedAt = this.now().toISOString();
    let request;
    try { request = validateExecutionRequestV1(input); } catch { return outcome("UNKNOWN", "EXECUTION_REQUEST_INVALID", startedAt); }
    if (request.platform !== this.platform) return outcome("UNKNOWN", "PLATFORM_MISMATCH", startedAt);
    try {
      const browser = await this._surface(options);
      const page = await this._page(request, browser);
      const account = options.account;
      const identity = await this._identity(request, account, browser, page.pageId);
      const target = await this._target(request, browser, page.pageId);
      const verification = await this._verify(request, browser, page.pageId, options.submittedAt || null, { preSubmitMediaIntegrity: options.preSubmitMediaIntegrity || null });
      return outcome(verification.state === "CONFIRMED" ? "CONFIRMED" : "UNKNOWN", verification.reasonCode, startedAt, { gates: { accountMatch: Boolean(identity), targetMatch: target.observed.targetMatched === true, independentVerification: verification.state === "CONFIRMED" }, publicationVerification: verification, publicationEvidence: verification.verificationEvidence || verification.publicationEvidence || null, publicationReference: verification.publicationReference || null, publicationUrl: verification.publicationUrl || null });
    } catch (error) {
      return outcome("UNKNOWN", safeCode(error?.code, "RECONCILIATION_UNKNOWN"), startedAt, { gates: { independentVerification: false } });
    }
  }
}

export class ThreadsPublicationAdapter extends ThreadsRedditPublicationAdapter {
  constructor(options = {}) { super("threads", options); }
}
export class RedditPublicationAdapter extends ThreadsRedditPublicationAdapter {
  constructor(options = {}) { super("reddit", options); }
}
export const THREADS_ADAPTER = new ThreadsPublicationAdapter();
export const REDDIT_ADAPTER = new RedditPublicationAdapter();
export const THREADS_REDDIT_ADAPTERS = Object.freeze({ threads: THREADS_ADAPTER, reddit: REDDIT_ADAPTER });
export function getThreadsRedditAdapter(platform) { return THREADS_REDDIT_ADAPTERS[String(platform || "").toLowerCase()] || null; }
export function createThreadsRedditAdapter(platform, options = {}) { return String(platform || "").toLowerCase() === "threads" ? new ThreadsPublicationAdapter(options) : new RedditPublicationAdapter(options); }
export const THREADS_REDDIT_EXPRESSIONS = Object.freeze({ threads: Object.freeze({ identity: THREADS_ADAPTER.identityExpression, composer: THREADS_ADAPTER.composerExpression }), reddit: Object.freeze({ identity: REDDIT_ADAPTER.identityExpression, composer: REDDIT_ADAPTER.composerExpression }) });
export const THREADS_REDDIT_PLATFORM_DESCRIPTORS = Object.freeze({
  threads: Object.freeze({ platform: "threads", hosts: [...descriptor("threads").hosts], identitySource: descriptor("threads").identitySource, rightsSource: descriptor("threads").rightsSource }),
  reddit: Object.freeze({ platform: "reddit", hosts: [...descriptor("reddit").hosts], identitySource: descriptor("reddit").identitySource, rightsSource: descriptor("reddit").rightsSource })
});
