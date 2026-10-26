import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { LINKEDIN_FEED_URL_FOR_READINESS } from "./orca-browser-client.mjs";
import { linkedInReadinessExpressions, openLinkedInComposer } from "./linkedin-readiness.mjs";
import { attachLinkedInMedia, cleanupLinkedInComposer } from "./linkedin-media.mjs";
import { isPreSubmitMediaIntegrityProven, PUBLICATION_CANDIDATE_MAX_AGE_MS, validateSubmitAcceptanceEvidence } from "./execution-contracts.mjs";
import { publicationVisibilityMatchesLabels, normalizePublicationVisibility } from "./publication-visibility.mjs";
import { assertClickPreflight, clickCommandEvidence, controlActivationEvidence as buildControlActivationEvidence } from "./click-transport.mjs";
import { OrcaAccessibilityTransport, OrcaPointerTransport, assertTransportCannotChangeAfterIntent, assertValidatedTransport, selectCertifiedTransport, selectedTransportCertification } from "./browser-interaction-transport.mjs";


function refOf(line) {
  return line.match(/\bref=([^\],\s]+)/)?.[1] || null;
}

function findRef(snapshot, pattern) {
  const matches = String(snapshot || "").split(/\r?\n/).filter((line) => pattern.test(line) && refOf(line));
  return matches.length === 1 ? refOf(matches[0]) : null;
}

function submitControlRefs(snapshot) {
  const pattern = /^\s*-\s+button\s+["'](?:post|đăng(?: bài)?|share)["']\s+\[[^\]]*\bref=([^\],\s]+)[^\]]*\]\s*$/i;
  return [...String(snapshot || "").matchAll(new RegExp(pattern.source, "gim"))].map((match) => match[1]);
}

const SUBMIT_CONTROL_EXPRESSION = `(() => {
  // LinkedIn currently animates the dialog container with opacity: 0 while its
  // editor and controls are already visible and actionable. Container opacity
  // is therefore not an ownership signal. Descendant layout, visibility and
  // hit testing remain required for every actionable element.
  const containerPresent = (node) => Boolean(node && node.isConnected && node.getClientRects().length &&
    getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden' &&
    node.getAttribute('aria-hidden') !== 'true');
  const visible = (node) => {
    if (!containerPresent(node)) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const nameOf = (node) => (node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
  const postLike = /^(post|share|đăng(?: bài)?)$/i;
  const boxOf = (node) => { const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; };
  const controlEvidence = (node, composerId, belongsToComposer) => {
    const box = node && visible(node) ? boxOf(node) : null;
    const hitTarget = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
    const hitTargetMatched = Boolean(hitTarget && (hitTarget === node || node.contains(hitTarget)));
    const enabled = !node.disabled && node.getAttribute('aria-disabled') !== 'true';
    const active = document.activeElement;
    return {
      role: node.getAttribute('role') || 'button', accessibleName: nameOf(node),
      visible: visible(node), connected: node.isConnected === true, enabled,
      busy: node.getAttribute('aria-busy') === 'true',
      ariaExpanded: node.getAttribute('aria-expanded'),
      ariaPressed: node.getAttribute('aria-pressed'),
      controlId: node.id || node.getAttribute('componentkey') || '', composerId: composerId || '',
      tagName: node.tagName.toLowerCase(), ariaLabel: node.getAttribute('aria-label') || '',
      boundingBox: box, hitTargetMatched,
      hitTargetRole: hitTarget?.getAttribute?.('role') || hitTarget?.tagName?.toLowerCase() || null,
      activeElement: active ? {
        tagName: active.tagName?.toLowerCase() || null,
        role: active.getAttribute?.('role') || null,
        id: active.id || null,
        accessibleName: nameOf(active) || null,
        isTargetControl: active === node || node.contains(active)
      } : null,
      scrollPosition: { x: Math.round(window.scrollX || 0), y: Math.round(window.scrollY || 0) },
      belongsToComposer: belongsToComposer === true,
      actionable: visible(node) && enabled && node.getAttribute('aria-busy') !== 'true' && hitTargetMatched
    };
  };
  const dialogNodes = Array.from(document.querySelectorAll('dialog,[role="dialog"]'));
  const records = dialogNodes.map((dialog, dialogIndex) => {
    if (!containerPresent(dialog)) return null;
    const editors = Array.from(dialog.querySelectorAll('[contenteditable="true"],[role="textbox"]')).filter(visible);
    if (editors.length !== 1) return { dialogIndex, dialogVisible: false, editorCount: editors.length, controls: [], labels: [] };
    const editor = editors[0];
    const dialogKey = dialog.getAttribute('data-testid') || dialog.id || 'dialog';
    const editorKey = editor.getAttribute('componentkey') || editor.id || editor.getAttribute('aria-label') || 'editor';
    const composerId = dialogKey + ':' + editorKey + ':' + dialogIndex;
    const labels = Array.from(dialog.querySelectorAll('button,[role="button"],[role="combobox"]')).filter(visible)
      .map((node) => nameOf(node)).filter(Boolean);
    const controls = Array.from(dialog.querySelectorAll('button,[role="button"]')).filter((node) => postLike.test(nameOf(node)))
      .map((node) => controlEvidence(node, composerId, true));
    return {
      dialogIndex, dialogVisible: true, composerId, editorCount: 1,
      editorText: String(editor.innerText || editor.textContent || ''),
      editorComponentKey: editorKey, labels, controls,
      visibilityBoundToComposer: labels.length > 0
    };
  }).filter(Boolean);
  const composers = records.filter((record) => record.editorCount === 1 && record.dialogVisible === true);
  const globalControls = Array.from(document.querySelectorAll('button,[role="button"]')).filter((node) => postLike.test(nameOf(node)))
    .map((node) => {
      const owner = node.closest('dialog,[role="dialog"]');
      const record = records.find((item) => item.dialogIndex === dialogNodes.indexOf(owner));
      return controlEvidence(node, record?.composerId || '', Boolean(record));
    });
  return {
    url: location.href,
    composerCount: composers.length,
    composerState: composers.length ? 'OPEN' : 'UNKNOWN',
    composers,
    globalControlCount: globalControls.length,
    globalControls,
    // Legacy top-level fields are retained for fixture compatibility and
    // sanitized evidence consumers; the adapter uses composers above.
    buttonCount: composers.length === 1 ? composers[0].controls.length : 0,
    control: composers.length === 1 && composers[0].controls.length === 1 ? composers[0].controls[0] : null
  };
})()`;

function submitControlFailure(code, message, gate, evidence) {
  return Object.assign(new Error(message), {
    code,
    preSubmitFailure: { reasonCode: code, stage: "adapter_pre_submit", gate, gateStatus: false, evidence },
    verificationGates: { submitControlSafe: false }
  });
}

function controlIdentity(control, ref) {
  return createHash("sha256").update(JSON.stringify({
    role: control.role, accessibleName: control.accessibleName,
    controlId: control.controlId || "", composerId: control.composerId || "",
    tagName: control.tagName || "", ariaLabel: control.ariaLabel || "",
    boundingBox: control.boundingBox || null, ref: String(ref || "")
  })).digest("hex");
}

function contentDigest(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

async function withinDeadline(operation, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw Object.assign(new Error("LinkedIn verification deadline elapsed"), { code: "VERIFICATION_DEADLINE" });
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("LinkedIn verification deadline elapsed"), { code: "VERIFICATION_DEADLINE" })), remaining); })
    ]);
  } finally { clearTimeout(timer); }
}

function profileId(tab) {
  return typeof tab?.profile === "string" ? tab.profile : tab?.profile?.id || tab?.profile?.profileId || tab?.profileId || "";
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyMediaType(filePath, declaredType) {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (declaredType === "video/mp4") return bytes.length >= 8 && bytes.toString("ascii", 4, 8) === "ftyp";
    if (declaredType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (declaredType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    return false;
  } finally {
    await handle.close();
  }
}

async function waitFor(browser, pageId, expression, predicate, timeoutMs = 15_000, intervalMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await browser.evaluate(pageId, expression);
    if (predicate(value)) return value;
    await sleep(intervalMs);
  }
  throw Object.assign(new Error("LinkedIn state wait timed out"), { code: "PAGE_LOAD_TIMEOUT" });
}

async function waitForLinkedInIdentity(browser, pageId, identityPath, timeoutMs = 10_000) {
  const expression = linkedInReadinessExpressions().context(identityPath);
  let identity = await browser.evaluate(pageId, expression);
  if (identity.securityChallenge) throw Object.assign(new Error("LinkedIn security challenge requires human action"), { code: "SECURITY_CHALLENGE" });
  if (identity.loginRequired) throw Object.assign(new Error("LinkedIn login form or auth route is visible"), { code: "AUTH_REQUIRED" });
  if (identity.sessionAuthenticated && identity.identityVerified) return identity;

  // URL navigation can complete before LinkedIn hydrates its authenticated shell.
  // Wait for positive session evidence instead of treating an intermediate page as
  // an authentication failure. Explicit login/challenge evidence still fails fast.
  if (typeof browser.waitForExpression === "function") {
    const readyExpression = `(() => { const state = (${expression}); return state.securityChallenge || state.loginRequired || (state.sessionAuthenticated && state.identityVerified); })()`;
    await browser.waitForExpression(pageId, readyExpression, timeoutMs).catch(() => undefined);
    identity = await browser.evaluate(pageId, expression);
  } else {
    identity = await waitFor(browser, pageId, expression,
      (state) => state?.securityChallenge || state?.loginRequired || (state?.sessionAuthenticated && state?.identityVerified), timeoutMs);
  }

  if (identity.securityChallenge) throw Object.assign(new Error("LinkedIn security challenge requires human action"), { code: "SECURITY_CHALLENGE" });
  if (identity.loginRequired) throw Object.assign(new Error("LinkedIn login form or auth route is visible"), { code: "AUTH_REQUIRED" });
  if (!identity.sessionAuthenticated) throw Object.assign(new Error("LinkedIn authenticated page did not finish loading"), { code: "PAGE_LOAD_TIMEOUT" });
  if (!identity.identityVerified) throw Object.assign(new Error("LinkedIn account identity is ambiguous or mismatched"), { code: "ACCOUNT_MISMATCH" });
  return identity;
}

const TARGET_EXPRESSION = (url) => `(() => {
  const expected = new URL(${JSON.stringify(url)});
  const actual = new URL(location.href);
  const canonical = (value) => value.pathname.replace(/\\/$/, '').toLowerCase() || '/';
  return { domain: actual.hostname.toLowerCase().replace(/^www\\./, '') === 'linkedin.com', targetMatched: actual.hostname.toLowerCase().replace(/^www\\./, '') === expected.hostname.toLowerCase().replace(/^www\\./, '') && canonical(actual) === canonical(expected) };
})()`;

const EDITOR_EXPRESSION = `(() => {
  const visible = (node) => Boolean(node && node.getClientRects().length);
  const dialogs = Array.from(document.querySelectorAll('dialog,[role="dialog"]')).filter(visible);
  const editors = dialogs.flatMap((dialog) => Array.from(dialog.querySelectorAll('[contenteditable="true"],[role="textbox"]')).filter(visible));
  const editor = editors.length === 1 ? editors[0] : null;
  return { dialogCount: dialogs.length, editorCount: editors.length, text: editor ? (editor.innerText || editor.textContent || '') : '' };
})()`;

const VISIBILITY_EXPRESSION = (visibility) => `(() => {
  const dialogs = Array.from(document.querySelectorAll('dialog,[role="dialog"]')).filter((node) => node.getClientRects().length);
  const dialog = dialogs.length === 1 ? dialogs[0] : null;
  const labels = dialog ? Array.from(dialog.querySelectorAll('button,[role="button"],[role="combobox"]')).filter((node) => node.getClientRects().length).map((node) => [node.getAttribute('aria-label') || '', node.innerText || ''].join(' ')) : [];
  const expected = ${JSON.stringify(String(visibility).toLowerCase())};
  const normalizedExpected = expected.toUpperCase();
  const visibilityMatch = normalizedExpected === 'PUBLIC' ? labels.some((label) => /anyone|public|everyone|mọi người|moi nguoi|tất cả mọi người|tat ca moi nguoi/i.test(label)) : false;
  return { dialogCount: dialogs.length, visibilityMatch, audienceMatch: visibilityMatch };
})()`;

export const LINKEDIN_VERIFICATION_EXPRESSION = (content, expectedIdentityUrl) => `(() => {
  const expected = ${JSON.stringify(content)}.trim();
  const expectedIdentityPath = new URL(${JSON.stringify(expectedIdentityUrl)}).pathname.replace(/\\/$/, '').toLowerCase();
  const articles = Array.from(new Set(document.querySelectorAll('article,[data-urn]')));
  return articles.map((article) => {
    const text = article.innerText || article.textContent || '';
    if (!text.includes(expected)) return null;
    const links = Array.from(article.querySelectorAll('a[href]')).map((node) => { try { return new URL(node.href, location.href); } catch { return null; } }).filter(Boolean);
    const author = links.find((url) => url.hostname.toLowerCase().replace(/^www\\./, '') === 'linkedin.com' && url.pathname.replace(/\\/$/, '').toLowerCase() === expectedIdentityPath);
    const permalinkUrl = links.find((url) => url.hostname.toLowerCase().replace(/^www\\./, '') === 'linkedin.com' && /\\/(?:feed\\/update|posts)\\//i.test(url.pathname));
    const urnNode = article.matches('[data-urn]') ? article : article.querySelector('[data-urn]');
    const activityUrn = urnNode?.getAttribute('data-urn') || text.match(/urn:li:(?:activity|share):[\\w-]+/)?.[0] || null;
    const activityId = activityUrn?.match(/urn:li:(?:activity|share):([\\w-]+)/)?.[1] || permalinkUrl?.pathname.match(/\\/(?:feed\\/update|posts)\\/([^/]+)/i)?.[1] || null;
    const publicationUrl = permalinkUrl?.toString() || (activityUrn ? 'https://www.linkedin.com/feed/update/' + activityUrn + '/' : null);
    const timeNode = article.querySelector('time[datetime],[data-timestamp]');
    const rawTimestamp = timeNode?.getAttribute('datetime') || timeNode?.getAttribute('data-timestamp') || null;
    const candidateTimestamp = rawTimestamp && Number.isFinite(Date.parse(rawTimestamp)) ? new Date(rawTimestamp).toISOString() : null;
    const video = article.querySelector('video');
    const image = article.querySelector('img[src]');
    return { found: true, contentMatched: true, authorMatched: Boolean(author), authorPath: author?.pathname.replace(/\\/$/, '').toLowerCase() || null,
      activityUrn, activityId, publicationUrl, candidateTimestamp, mediaPresent: Boolean(video || image), mediaType: video ? 'video' : image ? 'image' : null };
  }).filter(Boolean);
})()`;

const LINKEDIN_POST_CONFIRMATION_EXPRESSION = `(() => {
  const visible = (node) => Boolean(node && node.getClientRects().length);
  return Array.from(document.querySelectorAll('[role="alert"],[role="status"],.share-creation-state__success-container'))
    .filter(visible).map((node) => (node.innerText || node.textContent || '').trim())
    .filter((text) => /post(?:ed| is live)|shared|published|đã đăng|đã chia sẻ/i.test(text))
    .slice(0, 5).map((text) => text.slice(0, 200));
})()`;

const LINKEDIN_POST_CLICK_UI_EXPRESSION = `(() => {
  const visible = (node) => Boolean(node && node.getClientRects().length);
  const dialogs = Array.from(document.querySelectorAll('dialog,[role="dialog"]')).filter(visible);
  const composers = dialogs.filter((dialog) => Array.from(dialog.querySelectorAll('[contenteditable="true"],[role="textbox"]')).some(visible));
  const composer = composers.length === 1 ? composers[0] : null;
  const composerOpen = Boolean(composer);
  const postButtons = composer ? Array.from(composer.querySelectorAll('button,[role="button"]')).filter(visible).filter((node) => /^(post|share|đăng(?: bài)?)$/i.test((node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim())) : [];
  const buttonText = postButtons.map((node) => (node.innerText || node.getAttribute('aria-label') || '').trim()).join(' ');
  const postButtonState = !postButtons.length ? 'DISAPPEARED'
    : postButtons.some((node) => node.getAttribute('aria-busy') === 'true' || /posting|sharing|publishing|đang đăng/i.test(buttonText)) ? 'SUBMITTING'
      : postButtons.every((node) => node.disabled || node.getAttribute('aria-disabled') === 'true') ? 'DISABLED' : 'ENABLED';
  const postButton = postButtons.length === 1 ? postButtons[0] : null;
  const messages = Array.from(document.querySelectorAll('[role="alert"],[role="status"],.artdeco-toast-item,.share-creation-state__error-container,.share-creation-state__success-container')).filter(visible)
    .map((node) => (node.innerText || node.textContent || '').trim()).filter(Boolean).slice(0, 8).map((text) => text.slice(0, 240));
  const successMessages = messages.filter((text) => /post(?:ed| is live)|shared|published|đã đăng|đã chia sẻ/i.test(text));
  const errorMessages = messages.filter((text) => /error|failed|try again|cannot|couldn.?t|unable|too many|restricted|invalid|lỗi|không thể|thử lại/i.test(text));
  const confirmationState = successMessages.length && errorMessages.length ? 'UNKNOWN'
    : successMessages.length ? 'SUCCESS' : errorMessages.length ? 'ERROR' : 'NONE';
  const active = document.activeElement;
  return { url: location.href, composerState: composerOpen ? 'OPEN' : 'CLOSED', postButtonState, confirmationState, successMessages, errorMessages,
    activeElement: active ? { tagName: active.tagName?.toLowerCase() || null, role: active.getAttribute?.('role') || null, id: active.id || null,
      accessibleName: (active.getAttribute?.('aria-label') || active.innerText || active.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || null,
      isTargetControl: postButtons.some((node) => node === active || node.contains(active)) } : null,
    ariaExpanded: postButton?.getAttribute('aria-expanded') ?? null,
    relatedComponentVisible: Boolean(composer || successMessages.length || errorMessages.length),
    scrollPosition: { x: Math.round(window.scrollX || 0), y: Math.round(window.scrollY || 0) } };
})()`;

const LINKEDIN_POST_CLICK_WAIT_EXPRESSION = (content, expectedIdentityUrl) => `(() => {
  const ui = (${LINKEDIN_POST_CLICK_UI_EXPRESSION});
  const candidates = (${LINKEDIN_VERIFICATION_EXPRESSION(content, expectedIdentityUrl)});
  return ui.confirmationState === 'SUCCESS' || ui.confirmationState === 'ERROR' || candidates.some((candidate) => candidate.activityId && candidate.publicationUrl && candidate.authorMatched && candidate.contentMatched && candidate.candidateTimestamp);
})()`;

function safePlatformErrorText(value) {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
  if (!text || /(password|passkey|verification code|one[- ]time code|cookie|bearer|token|credential|session|mfa)/i.test(text)) return null;
  return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted]").replace(/https?:\/\/\S+/gi, "[link]");
}

function platformErrorReason(text) {
  if (/rate limit|too many|try again later/i.test(text)) return "linkedin_rate_limited";
  if (/restricted|account restriction/i.test(text)) return "linkedin_account_restricted";
  if (/video|media|upload|processing/i.test(text)) return "linkedin_media_processing_error";
  if (/invalid|required|cannot be empty|fix the errors/i.test(text)) return "linkedin_validation_error";
  return "linkedin_platform_error";
}

function candidateEvidence(candidate) {
  if (!candidate) return {};
  return {
    activityUrn: candidate.activityUrn || null,
    postId: candidate.activityId || candidate.postId || null,
    permalink: candidate.publicationUrl || candidate.permalink || null,
    authorMatched: candidate.authorMatched === true,
    contentMatched: candidate.contentMatched === true,
    timestamp: candidate.candidateTimestamp || candidate.timestamp || null,
    timestampMatched: candidate.timestampMatched === true
  };
}

function validateMediaDescriptor(request) {
  if (!Array.isArray(request.media) || request.media.length > 1) throw new Error("LinkedIn adapter supports one approved media artifact per request");
  if (request.media.length === 0) return null;
  const media = request.media[0];
  const filePath = path.resolve(media.reference);
  if (!path.isAbsolute(media.reference)) throw new Error("Media path must be absolute");
  return { ...media, path: filePath };
}

export class LinkedInPublicationVerifier {
  constructor(browser, { timeoutMs = 9_000, maxCandidateAgeMs = PUBLICATION_CANDIDATE_MAX_AGE_MS } = {}) {
    this.browser = browser;
    this.timeoutMs = timeoutMs;
    this.maxCandidateAgeMs = maxCandidateAgeMs;
  }

  async verify(request, pageId, { expectedIdentityUrl, submittedAt, preSubmitMediaIntegrity } = {}) {
    if (!expectedIdentityUrl) return { state: "UNKNOWN", reasonCode: "expected_identity_missing" };
    const submittedMs = Date.parse(submittedAt || "");
    if (!Number.isFinite(submittedMs)) return { state: "UNKNOWN", reasonCode: "submit_timestamp_missing" };
    const expression = LINKEDIN_VERIFICATION_EXPRESSION(request.content.payload, expectedIdentityUrl);
    const identity = new URL(expectedIdentityUrl);
    const profileRoot = `${identity.origin}${identity.pathname.replace(/\/$/, "")}`;
    const surfaces = [
      { name: "post_submit_confirmation", url: null },
      { name: "feed", url: LINKEDIN_FEED_URL_FOR_READINESS },
      { name: "recent_activity", url: `${profileRoot}/recent-activity/all/` },
      { name: "videos", url: `${profileRoot}/recent-activity/videos/` }
    ];
    const deadline = Date.now() + this.timeoutMs;
    const observations = [];
    let confirmationSignals = [];
    for (const [index, surface] of surfaces.entries()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        if (surface.url && index > 0) {
          await withinDeadline(this.browser.navigate(pageId, surface.url), deadline);
          const navigationBudget = deadline - Date.now();
          if (navigationBudget <= 0) break;
          const urlWaitMs = Math.min(1_000, Math.max(1, Math.floor(navigationBudget / (surfaces.length - index + 1))));
          await withinDeadline(this.browser.waitForUrl(pageId, surface.url, urlWaitMs), deadline);
        } else if (index === 0) {
          const signals = await withinDeadline(this.browser.evaluate(pageId, LINKEDIN_POST_CONFIRMATION_EXPRESSION), deadline);
          if (Array.isArray(signals)) confirmationSignals = signals;
          const found = await withinDeadline(this.browser.evaluate(pageId, expression), deadline);
          if (Array.isArray(found)) observations.push(...found.map((candidate) => ({ ...candidate, surface: surface.name })));
          continue;
        }
        const waitBudget = deadline - Date.now();
        if (waitBudget <= 0) break;
        const waitMs = Math.max(1, Math.floor(waitBudget / (surfaces.length - index)));
        if (typeof this.browser.waitForExpression === "function") await withinDeadline(this.browser.waitForExpression(pageId, `(${expression}).some((candidate) => candidate.contentMatched)`, waitMs), deadline).catch(() => undefined);
        const found = await withinDeadline(this.browser.evaluate(pageId, expression), deadline);
        if (Array.isArray(found)) observations.push(...found.map((candidate) => ({ ...candidate, surface: surface.name })));
      } catch {
        // A secondary surface may be unavailable; preserve any evidence collected elsewhere.
      }
    }
    const observedAt = new Date().toISOString();
    const candidates = observations.map((candidate) => {
      const url = candidate.publicationUrl ? new URL(candidate.publicationUrl) : null;
      const stableId = candidate.activityId || null;
      const timestamp = Date.parse(candidate.candidateTimestamp || "");
      const timestampMatched = Number.isFinite(timestamp) && timestamp >= submittedMs && timestamp <= submittedMs + this.maxCandidateAgeMs;
      const permalinkMatched = Boolean(url && /(^|\.)linkedin\.com$/i.test(url.hostname) && url.pathname !== "/" && stableId);
      const expectedMediaType = request.media?.[0]?.type?.startsWith("video/") ? "video" : request.media?.[0]?.type?.startsWith("image/") ? "image" : null;
      const mediaVerification = !expectedMediaType ? candidate.mediaPresent ? "MISMATCHED" : "MATCHED" : !candidate.mediaPresent || candidate.mediaType !== expectedMediaType ? "MISMATCHED" : "NOT_VERIFIABLE";
      return { ...candidate, permalinkMatched, stableId, timestampMatched, mediaVerification, permalink: url?.toString() || null };
    }).sort((left, right) => (Number(right.authorMatched) + Number(right.contentMatched) + Number(right.timestampMatched) + Number(right.permalinkMatched)) - (Number(left.authorMatched) + Number(left.contentMatched) + Number(left.timestampMatched) + Number(left.permalinkMatched)));
    const candidate = candidates[0] || null;
    const candidateConfirmed = Boolean(candidate?.authorMatched && candidate.contentMatched && candidate.timestampMatched && candidate.permalinkMatched);
    const expectedMedia = request.media?.[0] || null;
    const preSubmitIntegrityMatched = expectedMedia && isPreSubmitMediaIntegrityProven(preSubmitMediaIntegrity, expectedMedia);
    const mediaHashMatched = candidateConfirmed && candidate?.mediaVerification === "MATCHED";
    const mediaObservationAccepted = !expectedMedia || mediaHashMatched || (candidate?.mediaVerification === "NOT_VERIFIABLE" && preSubmitIntegrityMatched);
    const evidenceReference = candidate?.permalink || candidate?.activityUrn || `linkedin-search:${request.executionId}`;
    const verificationEvidence = {
      verifiedAt: observedAt, accountMatched: candidate?.authorMatched === true, targetMatched: Boolean(candidate?.permalinkMatched),
      contentHashMatched: candidate?.contentMatched === true, mediaHashMatched,
      accountId: request.accountId, profileId: request.profileId, targetId: request.target.targetId,
      contentHash: request.content.sha256, mediaHash: mediaHashMatched ? request.media?.[0]?.sha256 || null : null,
      verificationMethod: "linkedin_read_only_activity_dom", evidenceReference,
      preSubmitMediaIntegrity: preSubmitMediaIntegrity || null,
      verificationDetails: {
        executionId: request.executionId, submittedAt: new Date(submittedMs).toISOString(), observedAt,
        authorIdentity: { expectedPath: identity.pathname.replace(/\/$/, "").toLowerCase(), observedPath: candidate?.authorPath || null, matched: candidate?.authorMatched === true },
        contentMatch: { expectedSha256: request.content.sha256, matched: candidate?.contentMatched === true },
        candidate: { surface: candidate?.surface || null, activityUrn: candidate?.activityUrn || null, postId: candidate?.stableId || null, permalink: candidate?.permalink || null, timestamp: candidate?.candidateTimestamp || null, timestampMatched: candidate?.timestampMatched === true },
        media: { present: candidate?.mediaPresent === true, type: candidate?.mediaType || null, hashStatus: candidate?.mediaVerification || "NOT_VERIFIABLE" },
        confirmationSignals
      }
    };
    if (!candidateConfirmed) return { state: "UNKNOWN", reasonCode: candidate ? "publication_candidate_evidence_incomplete" : "publication_not_observed", publicationUrl: candidate?.permalink || undefined, publicationReference: evidenceReference, verificationEvidence, publicationEvidence: verificationEvidence };
    if (!mediaObservationAccepted) return { state: "UNKNOWN", reasonCode: candidate.mediaVerification === "MISMATCHED" ? "publication_media_type_mismatch" : "pre_submit_media_integrity_missing", publicationUrl: candidate.permalink, publicationReference: evidenceReference, verificationEvidence, publicationEvidence: verificationEvidence };
    return { state: "CONFIRMED", publicationUrl: candidate.permalink, publicationReference: evidenceReference, verifiedAt: observedAt, verificationEvidence, publicationEvidence: verificationEvidence };
  }
}

export class LinkedInAdapter {
  platform = "linkedin";
  contractVersion = 1;
  capabilities = Object.freeze({
    supportsText: true,
    supportsImage: true,
    supportsVideo: true,
    supportsAudienceSelection: true,
    supportsDirectFileAttach: true,
    supportsPublicationVerification: true,
    supportsPermalinkDiscovery: true,
    supportsReconciliation: true
  });

  constructor(browser, {
    verifier = null, mediaTimeoutMs = 60_000,
    postClickEvidenceTimeoutMs = 5_000, transport = null, transportCandidates = null,
    transportCertifications = [], transportRuntime = null, requireCertifiedTransport = false,
    session = null, browserSurface = null
  } = {}) {
    // A worker may inject a composed session `{ transport, browserSurface }`.
    // Once injected, this adapter never creates or silently replaces it with ORCA.
    const injectedTransport = session?.transport || transport;
    const injectedSurface = browserSurface || session?.browserSurface || injectedTransport?.browserSurface || injectedTransport?.browser;
    this.browser = injectedSurface || browser;
    this.verifier = verifier || new LinkedInPublicationVerifier(this.browser);
    this.mediaTimeoutMs = mediaTimeoutMs;
    this.postClickEvidenceTimeoutMs = postClickEvidenceTimeoutMs;
    this.injectedTransport = Boolean(injectedTransport);
    this.transport = injectedTransport || new OrcaAccessibilityTransport(browser);
    this.transportCandidates = this.injectedTransport
      ? [this.transport]
      : (Array.isArray(transportCandidates) && transportCandidates.length ? transportCandidates.slice() : [this.transport]);
    this.transportCertifications = Array.isArray(transportCertifications) ? transportCertifications.slice() : [];
    this.transportRuntime = transportRuntime || injectedTransport?.runtimeIdentity?.() || browser?.runtimeIdentity?.() || { providerVersion: browser?.runtimeVersion || null };
    this.requireCertifiedTransport = requireCertifiedTransport === true;
    this.requiresCertifiedTransport = this.requireCertifiedTransport;
    this.selectedTransport = this.transport.runtimeIdentity?.().transport || "browser-interaction";
    this.selectedTransportIdentity = this.transport.runtimeIdentity?.() || { transport: this.selectedTransport };
    this.selectedTransportCertification = null;
  }

  #selectSubmitTransport(executionBinding = null) {
    // Session/worker selection is authoritative. Re-selection here could
    // switch transports after the worker has bound an execution.
    if (this.injectedTransport && !this.requireCertifiedTransport) return this.transport;
    if (!this.requireCertifiedTransport) return this.transport;
    const selected = selectCertifiedTransport({
      transports: this.transportCandidates,
      certifications: this.transportCertifications,
      platform: this.platform,
      runtime: this.transportRuntime,
      requireIrreversibleSubmit: true,
      executionBinding
    });
    this.transport = selected;
    this.selectedTransportIdentity = selected.runtimeIdentity?.() || { transport: this.selectedTransport };
    this.selectedTransport = this.selectedTransportIdentity.transport || "browser-interaction";
    this.selectedTransportCertification = selectedTransportCertification({ transport: selected, certifications: this.transportCertifications, platform: this.platform, runtime: this.transportRuntime, requireIrreversibleSubmit: true, executionBinding });
    return selected;
  }

  async #getPage(request) {
    const tabs = await this.browser.listTabs();
    const owned = tabs.filter((tab) => profileId(tab) === request.profileId);
    if (owned.length === 0) throw Object.assign(new Error("Expected browser profile has no open tab"), { code: "PROFILE_NOT_FOUND" });
    const current = owned.filter((tab) => /(^|\.)linkedin\.com$/i.test(new URL(tab.url || "about:blank").hostname));
    if (current.length > 1) throw Object.assign(new Error("Multiple LinkedIn tabs exist in the expected profile"), { code: "IDENTITY_AMBIGUOUS" });
    const selected = current[0] || (owned.length === 1 ? owned[0] : null);
    if (!selected) throw Object.assign(new Error("Expected profile has ambiguous active tab"), { code: "IDENTITY_AMBIGUOUS" });
    const pageId = selected.browserPageId || selected.pageId || selected.id;
    if (!pageId) throw Object.assign(new Error("Browser page identity is missing"), { code: "ORCA_PROTOCOL_ERROR" });
    const tab = await this.browser.showTab(pageId);
    if (tab.profileId !== request.profileId) throw Object.assign(new Error("Browser runtime returned a different profile"), { code: "ACCOUNT_MISMATCH" });
    return { pageId, tab };
  }

  async #verifyIdentity(request, pageId, expectedIdentityUrl) {
    const expected = new URL(request.target.url);
    if (!/(^|\.)linkedin\.com$/i.test(expected.hostname)) throw Object.assign(new Error("Target is outside LinkedIn"), { code: "TARGET_MISMATCH" });
    if (expected.pathname.replace(/\/$/, "").toLowerCase() !== "/feed") throw Object.assign(new Error("This LinkedIn adapter currently supports the authenticated member feed target only"), { code: "TARGET_MISMATCH" });
    if (!expectedIdentityUrl) throw Object.assign(new Error("Expected LinkedIn account identity is not configured"), { code: "ACCOUNT_MISMATCH" });
    const identityPath = new URL(expectedIdentityUrl).pathname;
    // The stored LinkedIn target may carry shareActive=true for the legacy UI
    // route. Navigating to it opens the composer before the deterministic
    // adapter state machine starts and can strand the URL wait. Acquire the
    // authenticated feed first; openComposer owns the separate compose step.
    await this.browser.navigate(pageId, LINKEDIN_FEED_URL_FOR_READINESS);
    await this.browser.waitForUrl(pageId, LINKEDIN_FEED_URL_FOR_READINESS, 15_000);
    const actual = await this.browser.showTab(pageId);
    if (actual.profileId !== request.profileId) throw Object.assign(new Error("Browser profile changed during navigation"), { code: "ACCOUNT_MISMATCH" });
    await waitForLinkedInIdentity(this.browser, pageId, identityPath);
  }

  async prepareExecution(request, { account } = {}) {
    const page = await this.#getPage(request);
    return {
      request,
      account,
      pageId: page.pageId,
      expectedIdentityUrl: account?.identityReference || account?.expectedIdentityUrl || null
    };
  }

  async navigate(context) {
    await this.#verifyIdentity(context.request, context.pageId, context.expectedIdentityUrl);
    return context;
  }

  async verifyTarget(context) {
    const result = await this.browser.evaluate(context.pageId, TARGET_EXPRESSION(context.request.target.url));
    if (!result.domain || !result.targetMatched) throw Object.assign(new Error("LinkedIn destination does not match the approved target"), { code: "TARGET_MISMATCH" });
    return { ...context, targetVerified: true };
  }

  async openComposer(context) {
    const opened = await this.#openComposer(context.request, context.pageId, context.expectedIdentityUrl);
    return { ...context, snapshot: opened.snapshot, domClickFallbackUsed: opened.domFallbackUsed };
  }

  async fillContent(context) {
    const snapshot = await this.#fillContent(context.request, context.pageId, context.snapshot);
    return { ...context, snapshot };
  }

  async attachMedia(context) {
    const media = await this.#attachMedia(context.request, context.pageId);
    return { ...context, media };
  }

  async #captureSubmitControl(context) {
    if (typeof this.browser.evaluate !== "function") {
      throw submitControlFailure("SUBMIT_CONTROL_EVIDENCE_UNAVAILABLE", "LinkedIn submit control cannot be inspected safely", "finalSubmitControl", null);
    }
    const snapshot = await this.browser.snapshot(context.pageId);
    const refs = submitControlRefs(snapshot);
    const observed = await this.browser.evaluate(context.pageId, SUBMIT_CONTROL_EXPRESSION);
    const control = observed?.control;
    const requestedVisibility = normalizePublicationVisibility(context.request?.publicationVisibility || "PUBLIC");
    const expectedPayload = String(context.request?.content?.payload || "");
    const expectedPayloadHash = String(context.request?.content?.sha256 || contentDigest(expectedPayload));
    const composerRecords = Array.isArray(observed?.composers) ? observed.composers : null;
    const activeComposer = composerRecords?.length === 1 ? composerRecords[0] : null;
    const editorText = activeComposer?.editorText;
    const payloadHash = editorText === undefined ? null : contentDigest(editorText);
    const payloadMatched = editorText === undefined ? true : payloadHash === expectedPayloadHash && editorText === expectedPayload;
    const visibilityLabels = activeComposer?.labels || [];
    const visibilityMatched = composerRecords
      ? activeComposer?.visibilityBoundToComposer === true && publicationVisibilityMatchesLabels(requestedVisibility, visibilityLabels)
      : true;
    const ownedControls = activeComposer?.controls || (control ? [control] : []);
    const ownedControlCount = ownedControls.length;
    const controlComposerMatched = !control || !activeComposer || control.composerId === activeComposer.composerId;
    const ownershipProof = {
      composerId: activeComposer?.composerId || control?.composerId || null,
      composerCount: Number(observed?.composerCount) || 0,
      editorCount: Number(activeComposer?.editorCount ?? (activeComposer ? 1 : 0)),
      editorPayloadHash: payloadHash,
      expectedPayloadHash,
      payloadMatched,
      visibility: requestedVisibility,
      visibilityLabels: visibilityLabels.slice(0, 12),
      visibilityMatched,
      ownedControlCount,
      globalControlCount: Number(observed?.globalControlCount) || 0,
      controlBelongsToComposer: control?.belongsToComposer !== false && controlComposerMatched,
      structuralEvidenceVersion: Array.isArray(observed?.composers) ? 1 : 0
    };
    const safeObservation = {
      role: control?.role || null, accessibleName: control?.accessibleName || null,
      visible: control?.visible === true, connected: control?.connected === true,
      enabled: control?.enabled === true, busy: control?.busy === true, composerState: observed?.composerState || "UNKNOWN",
      composerCount: Number(observed?.composerCount) || 0, buttonCount: Number(observed?.buttonCount) || 0,
      composerMatched: Number(observed?.composerCount) === 1 && observed?.composerState === "OPEN" && ownedControlCount === 1 && payloadMatched && visibilityMatched,
      hitTargetMatched: control?.hitTargetMatched === true, hitTargetRole: control?.hitTargetRole || null,
      boundingBox: control?.boundingBox || null,
      actionable: control?.actionable === true || Boolean(control && control.visible === true && control.connected === true && control.enabled === true && control.busy !== true && control.hitTargetMatched === true),
      activeElement: control?.activeElement || null,
      ariaExpanded: control?.ariaExpanded ?? null,
      ariaPressed: control?.ariaPressed ?? null,
      scrollPosition: control?.scrollPosition || null,
      ownershipProof
    };
    safeObservation.controlRef = refs.length === 1 ? refs[0] : null;
    safeObservation.controlIdentity = control && refs.length === 1 ? controlIdentity(control, refs[0]) : null;
    let code = null;
    let message = "LinkedIn submit control is not uniquely actionable in the active composer";
    if (safeObservation.composerCount !== 1 || safeObservation.composerState !== "OPEN") code = "SUBMIT_CONTROL_WRONG_COMPOSER";
    else if (!controlComposerMatched || control?.belongsToComposer === false) code = "SUBMIT_CONTROL_WRONG_COMPOSER";
    else if (!payloadMatched) code = "CONTENT_MISMATCH";
    else if (!visibilityMatched) code = "TARGET_MISMATCH";
    else if (refs.length !== 1 || ownedControlCount !== 1 || safeObservation.buttonCount !== 1) code = "SUBMIT_CONTROL_AMBIGUOUS";
    else if (!control || !safeObservation.connected || !safeObservation.visible || !safeObservation.enabled || safeObservation.busy || !safeObservation.hitTargetMatched ||
      !safeObservation.boundingBox || safeObservation.boundingBox.width <= 0 || safeObservation.boundingBox.height <= 0) code = "SUBMIT_CONTROL_NOT_ACTIONABLE";
    else if (!/^(post|share|đăng(?: bài)?)$/i.test(safeObservation.accessibleName || "")) code = "SUBMIT_CONTROL_IDENTITY_MISMATCH";
    if (code) {
      const failureMessage = code === "CONTENT_MISMATCH" ? "LinkedIn active composer payload does not match the authorized content" :
        code === "TARGET_MISMATCH" ? "LinkedIn publication visibility is not bound to the active composer" : message;
      throw submitControlFailure(code, failureMessage, "finalSubmitControl", safeObservation);
    }
    const ref = refs[0];
    return {
      submitRef: ref,
      preClickControlEvidence: {
        ...safeObservation,
        controlRef: ref,
        controlIdentity: controlIdentity(control, ref),
        url: observed.url || null,
        capturedAt: new Date().toISOString()
      }
    };
  }

  async #captureSubmitControlStable(context, { attempts = 4, delayMs = 150 } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.#captureSubmitControl(context);
      } catch (error) {
        lastError = error;
        // LinkedIn briefly exposes a detached/secondary React composer while
        // the dialog settles. Re-observe only this structural state before
        // provider input; no click or other browser input is retried here.
        const transient = ["SUBMIT_CONTROL_WRONG_COMPOSER", "SUBMIT_CONTROL_AMBIGUOUS"].includes(error?.code);
        if (!transient || attempt + 1 >= attempts) throw error;
        await sleep(delayMs);
      }
    }
    throw lastError || new Error("LinkedIn submit control could not be stabilized");
  }

  async verifyPreSubmit(context) {
    const media = context.media || { mediaHashMatched: true, mediaPreviewConfirmed: true };
    const gates = {
      authorizationValid: true, readinessFresh: true, accountMatch: true, profileMatch: true, targetMatch: context.targetVerified === true,
      contentHashMatch: true, mediaHashMatch: media.mediaHashMatched, audienceMatch: media.audienceMatch === true,
      composerConfirmed: true, mediaPreviewConfirmed: media.mediaPreviewConfirmed,
      noDuplicateReceipt: true, noExistingConfirmedPublication: true
    };
    const failedGate = Object.entries(gates).find(([, passed]) => passed !== true)?.[0] || null;
    if (failedGate) {
      const reasonCode = failedGate === "mediaHashMatch" ? "ARTIFACT_INTEGRITY_FAILED"
        : failedGate === "mediaPreviewConfirmed" ? "MEDIA_PREVIEW_FAILED"
          : failedGate === "audienceMatch" ? "AUDIENCE_MISMATCH"
            : ["accountMatch", "profileMatch", "targetMatch"].includes(failedGate) ? "IDENTITY_MISMATCH"
              : failedGate === "authorizationValid" ? "AUTHORIZATION_INVALID"
                : failedGate === "readinessFresh" ? "READINESS_NOT_READY"
                  : "OTHER_PLATFORM_PRE_SUBMIT_ERROR";
      const error = Object.assign(new Error("LinkedIn pre-submit checks did not pass"), {
        code: reasonCode,
        preSubmitFailure: { reasonCode, stage: "adapter_pre_submit", gate: failedGate, gateStatus: false },
        verificationGates: gates
      });
      throw error;
    }
    const submitControl = await this.#captureSubmitControl(context);
    gates.submitControlSafe = true;
    const tab = typeof this.browser.showTab === "function" ? await this.browser.showTab(context.pageId) : null;
    return { ...context, gates, ...submitControl, urlBeforeSubmit: tab?.url || submitControl.preClickControlEvidence.url || null };
  }

  async #collectPostClickEvidence(context) {
    const startedAt = Date.now();
    const deadline = startedAt + this.postClickEvidenceTimeoutMs;
    const expression = LINKEDIN_VERIFICATION_EXPRESSION(context.request.content.payload, context.expectedIdentityUrl);
    let ui = null;
    let candidates = [];
    const collect = async () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      try {
        ui = await withinDeadline(this.browser.evaluate(context.pageId, LINKEDIN_POST_CLICK_UI_EXPRESSION), deadline);
        const found = await withinDeadline(this.browser.evaluate(context.pageId, expression), deadline);
        if (Array.isArray(found)) candidates = found;
      } catch {
        // Preserve the already-durable click evidence if the page cannot be inspected.
      }
    };
    await collect();
    const hasTerminalSignal = ui?.confirmationState === "SUCCESS" || ui?.confirmationState === "ERROR" || candidates.some((item) => item.activityId && item.publicationUrl && item.authorMatched && item.contentMatched && item.candidateTimestamp);
    if (!hasTerminalSignal && typeof this.browser.waitForExpression === "function" && Date.now() < deadline) {
      try {
        await withinDeadline(this.browser.waitForExpression(context.pageId, LINKEDIN_POST_CLICK_WAIT_EXPRESSION(context.request.content.payload, context.expectedIdentityUrl), Math.max(1, deadline - Date.now())), deadline);
      } catch {
        // A timeout is lack of acceptance evidence, not permission to click again.
      }
      await collect();
    }
    const candidate = candidates[0] || null;
    const strongCandidate = Boolean(candidate?.authorMatched && candidate.contentMatched && candidate.activityId && candidate.publicationUrl && candidate.candidateTimestamp &&
      Date.parse(candidate.candidateTimestamp) >= Date.parse(context.clickEmittedAt) && Date.parse(candidate.candidateTimestamp) <= Date.parse(context.clickEmittedAt) + PUBLICATION_CANDIDATE_MAX_AGE_MS);
    const successConfirmation = ui?.confirmationState === "SUCCESS";
    const visibleError = ui?.errorMessages?.[0] || null;
    const safeError = safePlatformErrorText(visibleError);
    const platformAcceptance = successConfirmation || strongCandidate ? "ACCEPTED" : ui?.confirmationState === "ERROR" ? "REJECTED" : "UNKNOWN";
    const acceptanceSource = successConfirmation ? "SUCCESS_CONFIRMATION" : strongCandidate ? "STABLE_PUBLICATION_IDENTITY" : ui?.confirmationState === "ERROR" ? "VISIBLE_PLATFORM_ERROR" : "NONE";
    const observedAt = new Date().toISOString();
    const evidence = {
      ...context.submitAcceptanceEvidence,
      platformAcceptance,
      acceptanceSource,
      observedAt,
      postClickObservedAt: observedAt,
      controlActivationEvidence: buildControlActivationEvidence({
        before: {
        composerState: context.preClickControlEvidence?.composerState || "OPEN",
        postButtonState: context.preClickControlEvidence?.enabled ? "ENABLED" : "DISABLED",
        url: context.preClickControlEvidence?.url || context.urlBeforeSubmit || null,
        activeElement: context.preClickControlEvidence?.activeElement || null,
        ariaExpanded: context.preClickControlEvidence?.ariaExpanded ?? null,
        relatedComponentVisible: context.preClickControlEvidence?.composerState === "OPEN",
        scrollPosition: context.preClickControlEvidence?.scrollPosition || null
        },
        after: ui,
        controlIdentity: context.preClickControlEvidence?.controlIdentity,
        strongCandidate,
        observedAt
      }),
      composerState: ui?.composerState || "UNKNOWN",
      postButtonState: ui?.postButtonState || "UNKNOWN",
      confirmationState: ui?.confirmationState || "UNKNOWN",
      confirmationText: safePlatformErrorText(ui?.successMessages?.[0]),
      errorReasonCode: visibleError ? platformErrorReason(visibleError) : null,
      errorText: safeError,
      urlAfter: ui?.url || null,
      candidate: candidateEvidence({ ...candidate, timestampMatched: strongCandidate })
    };
    return validateSubmitAcceptanceEvidence(evidence);
  }

  async submit(context, { beforeSubmitIntent, beforeProviderSend, onSubmitSent } = {}) {
    if (typeof beforeSubmitIntent !== "function" || typeof onSubmitSent !== "function") throw new Error("Live submit requires durable intent and submit-state callbacks");
    const currentControl = await this.#captureSubmitControlStable(context);
    if (context.preClickControlEvidence?.controlIdentity && currentControl.preClickControlEvidence.controlIdentity !== context.preClickControlEvidence.controlIdentity) {
      throw submitControlFailure("SUBMIT_CONTROL_IDENTITY_CHANGED", "LinkedIn submit control changed after pre-submit validation", "finalSubmitControl", currentControl.preClickControlEvidence);
    }
    // This is the last pre-submit gate. It runs before the durable intent is
    // persisted, so a moved, detached, covered, or disabled target emits no
    // browser input and does not become a post-submit UNKNOWN.
    const clickPreflight = assertClickPreflight(currentControl.preClickControlEvidence);
    context.submitRef = currentControl.submitRef;
    context.preClickControlEvidence = currentControl.preClickControlEvidence;
    context.urlBeforeSubmit = context.urlBeforeSubmit || currentControl.preClickControlEvidence.url;
    try {
      const request = context.request || {};
      const executionBinding = {
        platform: this.platform,
        executionId: request.executionId,
        campaignId: request.campaignId,
        jobId: request.jobId,
        accountId: request.accountId,
        provider: request.provider,
        providerProfileId: request.providerProfileId || request.profileId,
        profileId: request.profileId,
        identityReference: request.identityReference || request.target?.identityReference,
        targetId: request.target?.targetId,
        targetUrl: request.target?.url,
        authorizationId: request.authorization?.authorizationId,
        authorizationBinding: request.authorization?.binding,
        contentSha256: request.content?.sha256,
        mediaSha256: (request.media || []).map((item) => item.sha256),
        visibility: request.publicationVisibility || "PUBLIC"
      };
      this.#selectSubmitTransport(executionBinding);
      assertValidatedTransport(this.transport);
    } catch (error) {
      throw Object.assign(error, { preSubmitFailure: { reasonCode: "TRANSPORT_NOT_CERTIFIED", stage: "submit_boundary", gate: "browserTransport", gateStatus: false } });
    }
    context.selectedTransport = this.selectedTransport;
    if (!this.transport || typeof this.transport.click !== "function") {
      throw Object.assign(new Error("LinkedIn browser interaction transport is unavailable"), { code: "TRANSPORT_UNAVAILABLE", preSubmitFailure: { reasonCode: "TRANSPORT_UNAVAILABLE", stage: "submit_boundary", gate: "browserTransport", gateStatus: false } });
    }
    try {
      await this.transport.assertReadyForFinalSubmit?.();
    } catch (error) {
      throw Object.assign(error, { preSubmitFailure: {
        reasonCode: String(error.code || "TRANSPORT_RUNTIME_UNREADY"),
        stage: "submit_boundary",
        gate: "browserTransportRuntime",
        gateStatus: false
      } });
    }
    const persistedIntent = await beforeSubmitIntent(context.gates, {
      transportIdentity: { ...this.selectedTransportIdentity },
      transportCertification: this.selectedTransportCertification ? {
        certificationScope: this.selectedTransportCertification.certificationScope,
        evidenceReference: this.selectedTransportCertification.evidenceReference,
        expiresAt: this.selectedTransportCertification.expiresAt,
        executionBinding: this.selectedTransportCertification.executionBinding
      } : null,
      preSubmitControlEvidence: { ...context.preClickControlEvidence }
    });
    context.intentPersisted = true;
    const persistedTransport = persistedIntent?.submitTransport || persistedIntent?.request?.submitTransport || null;
    assertTransportCannotChangeAfterIntent({
      selectedTransport: this.selectedTransportIdentity,
      requestedTransport: persistedTransport || this.selectedTransportIdentity,
      intentPersisted: true
    });
    context.submitAcceptanceEvidence = {
      clickStatus: "UNKNOWN", platformAcceptance: "UNKNOWN", acceptanceSource: "NONE",
      composerState: "UNKNOWN", postButtonState: "UNKNOWN", confirmationState: "UNKNOWN",
      urlBefore: context.urlBeforeSubmit || null, urlAfter: null, candidate: {},
      preClickControlEvidence: context.preClickControlEvidence
    };
    let commandResult;
    let providerCallStartedAt = null;
    const preflight = clickPreflight;
    try {
      assertTransportCannotChangeAfterIntent({ selectedTransport: this.selectedTransportIdentity, requestedTransport: this.selectedTransportIdentity, intentPersisted: context.intentPersisted === true });
      commandResult = await this.transport.click({ pageId: context.pageId, targetRef: context.submitRef, targetIdentity: context.preClickControlEvidence.controlIdentity, boundingBox: context.preClickControlEvidence.boundingBox }, {
        validate: async () => {
          const latest = await this.#captureSubmitControlStable(context);
          if (latest.preClickControlEvidence.controlIdentity !== context.preClickControlEvidence.controlIdentity) {
            throw submitControlFailure("SUBMIT_CONTROL_IDENTITY_CHANGED", "LinkedIn submit control changed immediately before browser input", "finalSubmitControl", latest.preClickControlEvidence);
          }
          const safe = assertClickPreflight(latest.preClickControlEvidence);
          await beforeProviderSend?.();
          return safe;
        },
        onProviderCallStarted: (at) => { if (!providerCallStartedAt) providerCallStartedAt = at || new Date().toISOString(); }
      });
    } catch (error) {
      const observedAt = new Date().toISOString();
      context.submitAcceptanceEvidence = validateSubmitAcceptanceEvidence({
        ...context.submitAcceptanceEvidence, observedAt,
        clickCommandEvidence: {
          status: "OUTCOME_UNKNOWN", observedAt, transport: this.selectedTransport, elementRef: context.submitRef, preflight,
          providerCallStarted: providerCallStartedAt ? true : false,
          providerCallStartedAt
        },
        controlActivationEvidence: { status: "CONTROL_ACTIVATION_UNKNOWN", observedAt, signals: [] },
        errorReasonCode: String(error?.code || "orca_click_outcome_unknown").toLowerCase()
      });
      throw error;
    }
    context.clickEmittedAt = new Date().toISOString();
    context.submittedAt = context.clickEmittedAt;
    context.submitted = true;
    context.submitAcceptanceEvidence = validateSubmitAcceptanceEvidence({
      ...context.submitAcceptanceEvidence,
      clickStatus: "CLICK_EMITTED", clickEmittedAt: context.clickEmittedAt, observedAt: context.clickEmittedAt,
      clickCommandEvidence: clickCommandEvidence(commandResult || {}, {
        elementRef: context.submitRef,
        preflight: commandResult?.preflight || preflight,
        completedAt: commandResult?.completedAt || context.clickEmittedAt
      }),
      controlActivationEvidence: { status: "CONTROL_ACTIVATION_UNKNOWN", observedAt: context.clickEmittedAt, signals: [] }
    });
    await onSubmitSent(context.submitAcceptanceEvidence);
    context.submitAcceptanceEvidence = await this.#collectPostClickEvidence(context);
    return context;
  }

  async verifyPublished(context) {
    return this.verifier.verify(context.request, context.pageId, {
      expectedIdentityUrl: context.expectedIdentityUrl,
      executionId: context.request.executionId,
      submittedAt: context.submittedAt,
      preSubmitMediaIntegrity: context.media?.preSubmitMediaIntegrity
    });
  }

  async cleanup(context) {
    if (context?.pageId) await this.#safeClose(context.pageId, context.request);
    return context;
  }

  async recover(context) {
    if (context?.pageId && !context.intentPersisted && !context.submitted) await this.cleanup(context);
    return context;
  }

  async reconcile(request, { account, expectedIdentityUrl = account?.identityReference || account?.expectedIdentityUrl, submittedAt, preSubmitMediaIntegrity } = {}) {
    const startedAt = new Date().toISOString();
    const began = Date.now();
    const commandStart = this.browser.browserCommandCount?.() ?? 0;
    try {
      const page = await this.#getPage(request);
      if (!expectedIdentityUrl) throw Object.assign(new Error("Expected LinkedIn account identity is not configured"), { code: "ACCOUNT_MISMATCH" });
      await this.browser.navigate(page.pageId, LINKEDIN_FEED_URL_FOR_READINESS);
      await this.browser.waitForFeed(page.pageId);
      const identityPath = new URL(expectedIdentityUrl).pathname;
      const identity = await this.browser.evaluate(page.pageId, linkedInReadinessExpressions().context(identityPath));
      if (identity.securityChallenge) throw Object.assign(new Error("LinkedIn security challenge requires human action"), { code: "SECURITY_CHALLENGE" });
      if (identity.loginRequired || !identity.sessionAuthenticated || !identity.identityVerified) {
        throw Object.assign(new Error("LinkedIn authenticated account identity is not verified"), { code: identity.loginRequired ? "AUTH_REQUIRED" : "ACCOUNT_MISMATCH" });
      }
      const target = await this.browser.evaluate(page.pageId, TARGET_EXPRESSION(LINKEDIN_FEED_URL_FOR_READINESS));
      if (!target.domain || !target.targetMatched) throw Object.assign(new Error("LinkedIn feed target is not verified"), { code: "TARGET_MISMATCH" });
      const verification = await this.verifier.verify(request, page.pageId, { expectedIdentityUrl, executionId: request.executionId, submittedAt, preSubmitMediaIntegrity });
      return {
        ...verification,
        submitState: verification.state === "CONFIRMED" ? "CONFIRMED" : "UNKNOWN",
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - began,
        browserCommands: Math.max(0, (this.browser.browserCommandCount?.() ?? commandStart) - commandStart),
        computerUseCalls: 0,
        retries: 0,
        errorClassification: verification.state === "CONFIRMED" ? "NONE" : "PLATFORM_ERROR",
        recoveryClassification: verification.state === "CONFIRMED" ? "NONE" : "UNKNOWN"
      };
    } catch (error) {
      return {
        submitState: "UNKNOWN", startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - began,
        browserCommands: Math.max(0, (this.browser.browserCommandCount?.() ?? commandStart) - commandStart),
        computerUseCalls: 0, retries: 0,
        errorClassification: error.code === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : error.code === "ACCOUNT_MISMATCH" ? "ACCOUNT_MISMATCH" : "PLATFORM_ERROR",
        recoveryClassification: "UNKNOWN", reasonCode: String(error.code || "reconciliation_unknown").toLowerCase()
      };
    }
  }

  async #openComposer(request, pageId, expectedIdentityUrl) {
    const feed = await this.browser.evaluate(pageId, linkedInReadinessExpressions().context(new URL(expectedIdentityUrl).pathname));
    if (!feed.sessionAuthenticated || !feed.identityVerified) throw Object.assign(new Error("LinkedIn session/account verification failed"), { code: "ACCOUNT_MISMATCH" });
    const { state, domFallbackUsed } = await openLinkedInComposer(this.browser, pageId, { expectedIdentityPath: new URL(expectedIdentityUrl).pathname.replace(/\/$/, "").toLowerCase() || "/" });
    if (state.linkedinDomain !== true || (state.route !== true && state.routeCompatible !== true) || state.dialogCount !== 1 || state.editorCount !== 1 || state.audience !== true || state.postButton !== true || state.mediaControl !== true || state.advertisingControls !== 0) {
      throw Object.assign(new Error("LinkedIn composer structure is not confirmed"), { code: "UNKNOWN_COMPOSER" });
    }
    const visibility = await this.browser.evaluate(pageId, VISIBILITY_EXPRESSION(request.publicationVisibility || "PUBLIC"));
    if (visibility.dialogCount !== 1 || (visibility.visibilityMatch !== true && visibility.audienceMatch !== true)) throw Object.assign(new Error("LinkedIn publication visibility is not supported by the active composer"), { code: "TARGET_MISMATCH" });
    return { snapshot: await this.browser.snapshot(pageId), domFallbackUsed };
  }

  async #fillContent(request, pageId, snapshot) {
    const editor = findRef(snapshot, /textbox/i);
    if (!editor) throw Object.assign(new Error("Post editor is not uniquely identified"), { code: "CONTENT_MISMATCH" });
    await this.browser.fill(pageId, editor, request.content.payload);
    const actual = await this.browser.evaluate(pageId, EDITOR_EXPRESSION);
    const actualHash = createHash("sha256").update(String(actual.text || "")).digest("hex");
    if (actual.dialogCount !== 1 || actual.editorCount !== 1 || actualHash !== request.content.sha256) throw Object.assign(new Error("Entered content does not match the approved hash"), { code: "CONTENT_MISMATCH" });
    return await this.browser.snapshot(pageId);
  }

  async #attachMedia(request, pageId) {
    const media = validateMediaDescriptor(request);
    if (!media) return { mediaHashMatched: true, mediaPreviewConfirmed: true, audienceMatch: true, mediaAttachMs: 0, mediaReadyMs: 0 };
    const fileHash = await sha256File(media.path);
    if (fileHash !== media.sha256) throw Object.assign(new Error("Media hash differs from the approved artifact"), { code: "MEDIA_MISMATCH" });
    if (!await verifyMediaType(media.path, media.type)) throw Object.assign(new Error("Media file type does not match the approved descriptor"), { code: "MEDIA_MISMATCH" });
    const result = await attachLinkedInMedia(this.browser, pageId, media, { timeoutMs: this.mediaTimeoutMs });
    const visibility = await this.browser.evaluate(pageId, VISIBILITY_EXPRESSION(request.publicationVisibility || "PUBLIC"));
    if (visibility.dialogCount !== 1 || (visibility.visibilityMatch !== true && visibility.audienceMatch !== true)) throw Object.assign(new Error("LinkedIn publication visibility changed while attaching media"), { code: "TARGET_MISMATCH" });
    return { ...result, audienceMatch: true, preSubmitMediaIntegrity: {
      artifactId: media.artifactId, expectedSha256: media.sha256, localFileSha256: fileHash,
      mediaType: media.type, attached: true, previewReady: result.mediaPreviewConfirmed === true
    } };
  }
  async #safeClose(pageId, request) {
    await cleanupLinkedInComposer(this.browser, pageId, request.content.sha256);
  }

  /** Execute one request with optional per-execution injected session.
   * The injected session is authoritative for this call; no ORCA fallback is
   * created when transport/browserSurface is supplied.
   */
  async execute(request, options = {}) {
    const { executionSession = null, transport = null, browserSurface = null } = options;
    const selectedTransport = executionSession?.transport || transport;
    const selectedSurface = browserSurface || executionSession?.browserSurface || selectedTransport?.browserSurface || selectedTransport?.browser;
    if (selectedTransport || selectedSurface) {
      if (!selectedTransport || !selectedSurface) {
        return { submitState: "FAILED", reasonCode: "EXECUTION_SESSION_SURFACE_INCOMPLETE", errorClassification: "VALIDATION_ERROR", recoveryClassification: "NONE" };
      }
      const required = ["listTabs", "showTab", "navigate", "waitForUrl", "waitForFeed", "evaluate", "snapshot", "fill"];
      const missing = required.filter((name) => typeof selectedSurface[name] !== "function");
      if (missing.length) {
        return { submitState: "FAILED", reasonCode: "EXECUTION_SESSION_SURFACE_UNSUPPORTED", missingCapabilities: missing, errorClassification: "VALIDATION_ERROR", recoveryClassification: "NONE" };
      }
      const prior = { browser: this.browser, verifierBrowser: this.verifier?.browser, transport: this.transport, transportCandidates: this.transportCandidates, injectedTransport: this.injectedTransport, selectedTransport: this.selectedTransport, selectedTransportIdentity: this.selectedTransportIdentity, transportRuntime: this.transportRuntime };
      this.browser = selectedSurface;
      if (this.verifier?.browser) this.verifier.browser = selectedSurface;
      this.transport = selectedTransport;
      this.transportCandidates = [selectedTransport];
      this.injectedTransport = true;
      this.selectedTransportIdentity = selectedTransport.runtimeIdentity?.() || { transport: "browser-interaction" };
      this.selectedTransport = this.selectedTransportIdentity.transport || "browser-interaction";
      this.transportRuntime = this.selectedTransportIdentity;
      try { return await this.#executeInternal(request, options); }
      finally { Object.assign(this, prior); if (this.verifier?.browser && prior.verifierBrowser) this.verifier.browser = prior.verifierBrowser; }
    }
    return this.#executeInternal(request, options);
  }

  async #executeInternal(request, { dryRun = true, liveEnabled = false, beforeSubmitIntent, beforeProviderSend, onSubmitSent, account, expectedIdentityUrl = account?.identityReference || account?.expectedIdentityUrl } = {}) {
    const startedAt = new Date().toISOString();
    const began = Date.now();
    let pageId;
    let lifecycleContext;
    let intentPersisted = false;
    let submitted = false;
    let computerUseCalls = 0;
    const phaseTimings = {};
    const timed = async (key, operation) => {
      const at = Date.now();
      try { return await operation(); }
      finally { phaseTimings[key] = Date.now() - at; }
    };
    const commandStart = this.browser.browserCommandCount?.() ?? 0;
    try {
      if (request.platform !== this.platform) throw Object.assign(new Error("LinkedInAdapter received another platform"), { code: "PLATFORM_MISMATCH" });
      const boundAccount = account || (expectedIdentityUrl ? { identityReference: expectedIdentityUrl } : null);
      lifecycleContext = await timed("profileAcquireMs", () => this.prepareExecution(request, { account: boundAccount }));
      pageId = lifecycleContext.pageId;
      await timed("navigationMs", () => this.navigate(lifecycleContext));
      lifecycleContext = await timed("targetVerifyMs", () => this.verifyTarget(lifecycleContext));
      lifecycleContext = await timed("composerOpenMs", () => this.openComposer(lifecycleContext));
      phaseTimings.domClickFallbacks = lifecycleContext.domClickFallbackUsed ? 1 : 0;
      lifecycleContext = await timed("contentFillMs", () => this.fillContent(lifecycleContext));
      lifecycleContext = await this.attachMedia(lifecycleContext);
      phaseTimings.mediaAttachMs = lifecycleContext.media?.mediaAttachMs || 0;
      phaseTimings.mediaReadyMs = lifecycleContext.media?.mediaReadyMs || 0;
      phaseTimings.mediaControlOpenMs = lifecycleContext.media?.mediaControlOpenMs || 0;
      phaseTimings.uploadTargetDiscoveryMs = lifecycleContext.media?.uploadTargetDiscoveryMs || 0;
      phaseTimings.fileAttachMs = lifecycleContext.media?.fileAttachMs || 0;
      const media = lifecycleContext.media;
      const preSubmitStarted = Date.now();
      lifecycleContext = await this.verifyPreSubmit({ ...lifecycleContext, media });
      const gates = lifecycleContext.gates;
      phaseTimings.preSubmitVerifyMs = Date.now() - preSubmitStarted;
      lifecycleContext.gates = gates;
      if (!lifecycleContext.submitRef || !lifecycleContext.preClickControlEvidence) {
        lifecycleContext = { ...lifecycleContext, ...(await this.#captureSubmitControl(lifecycleContext)) };
      }
      const submit = lifecycleContext.submitRef;
      if (dryRun) {
        await timed("cleanupMs", () => this.cleanup(lifecycleContext));
        return { submitState: "NOT_STARTED", startedAt, finishedAt: new Date().toISOString(), gates, computerUseCalls, browserCommands: Math.max(0, (this.browser.browserCommandCount?.() ?? commandStart) - commandStart), retries: 0, durationMs: Date.now() - began, telemetry: phaseTimings };
      }
      if (!liveEnabled || typeof beforeSubmitIntent !== "function" || typeof onSubmitSent !== "function") throw new Error("Live publish is disabled; dry-run is the default");
      lifecycleContext.submitRef = submit;
      await this.submit(lifecycleContext, { beforeSubmitIntent, beforeProviderSend, onSubmitSent });
      intentPersisted = lifecycleContext.intentPersisted === true;
      submitted = lifecycleContext.submitted === true;
      const verification = await this.verifyPublished(lifecycleContext);
      const verifiedCandidate = verification.publicationEvidence?.verificationDetails?.candidate;
      const acceptanceInput = {
        ...lifecycleContext.submitAcceptanceEvidence,
        platformAcceptance: "ACCEPTED", acceptanceSource: "STABLE_PUBLICATION_IDENTITY",
        candidate: candidateEvidence({
          ...verifiedCandidate,
          authorMatched: verification.publicationEvidence?.accountMatched === true,
          contentMatched: verification.publicationEvidence?.contentHashMatched === true
        })
      };
      const finalAcceptance = verification.state === "CONFIRMED" ? validateSubmitAcceptanceEvidence(acceptanceInput) : lifecycleContext.submitAcceptanceEvidence;
      const common = { startedAt, finishedAt: verification.state === "CONFIRMED" ? verification.publicationEvidence.verifiedAt : new Date().toISOString(), gates, computerUseCalls, browserCommands: Math.max(0, (this.browser.browserCommandCount?.() ?? commandStart) - commandStart), retries: 0, durationMs: Date.now() - began, telemetry: phaseTimings, submitAcceptanceEvidence: finalAcceptance };
      if (verification.state !== "CONFIRMED") return { ...verification, reasonCode: lifecycleContext.submitAcceptanceEvidence?.platformAcceptance === "REJECTED" ? lifecycleContext.submitAcceptanceEvidence.errorReasonCode : verification.reasonCode, submitState: "UNKNOWN", ...common, errorClassification: "PLATFORM_ERROR", recoveryClassification: "UNKNOWN" };
      return { ...verification, submitState: "CONFIRMED", ...common, errorClassification: "NONE", recoveryClassification: "NONE" };
    } catch (error) {
      if (pageId && !submitted && !intentPersisted) {
        const cleanupStarted = Date.now();
        await this.recover(lifecycleContext, error).catch(() => undefined);
        phaseTimings.cleanupMs = Date.now() - cleanupStarted;
      }
      const uncertain = intentPersisted || submitted || lifecycleContext?.intentPersisted === true || lifecycleContext?.submitted === true;
      const code = String(error.code || "unknown").toUpperCase();
      const errorClassification = code === "AUTH_REQUIRED" || code === "SECURITY_CHALLENGE" ? "AUTH_REQUIRED"
        : code === "ACCOUNT_MISMATCH" || code === "IDENTITY_AMBIGUOUS" ? "ACCOUNT_MISMATCH"
          : code === "MEDIA_MISMATCH" ? "MEDIA_MISMATCH"
            : code === "UPLOAD_ERROR" ? "UPLOAD_ERROR"
              : code === "CONTENT_MISMATCH" ? "CONTENT_MISMATCH"
                : code === "UNKNOWN_COMPOSER" ? "UNKNOWN_COMPOSER"
                  : ["PAGE_LOAD_TIMEOUT", "PROVIDER_TIMEOUT", "ORCA_RUNTIME_UNAVAILABLE"].includes(code) ? "TIMEOUT"
                    : code === "TARGET_MISMATCH" ? "VALIDATION_ERROR" : "PLATFORM_ERROR";
      const recoveryClassification = uncertain ? "UNKNOWN"
        : ["AUTH_REQUIRED", "SECURITY_CHALLENGE", "ACCOUNT_MISMATCH", "IDENTITY_AMBIGUOUS"].includes(code) ? "HUMAN_REQUIRED"
          : ["PAGE_LOAD_TIMEOUT", "PROVIDER_TIMEOUT", "ORCA_RUNTIME_UNAVAILABLE", "NETWORK_ERROR", "UPLOAD_ERROR", "UNKNOWN_COMPOSER"].includes(code) ? "RECOVERABLE"
            : "NONE";
      const preSubmitFailure = error.preSubmitFailure || (!uncertain && !dryRun ? {
        reasonCode: code,
        stage: lifecycleContext?.gates ? "submit_boundary" : "adapter_execution",
        gate: null,
        gateStatus: false
      } : undefined);
      return {
        submitState: uncertain ? "UNKNOWN" : dryRun ? "NOT_STARTED" : "FAILED",
        startedAt, finishedAt: new Date().toISOString(),
        gates: error.verificationGates || error.gates || { passed: false }, computerUseCalls, browserCommands: Math.max(0, (this.browser.browserCommandCount?.() ?? commandStart) - commandStart), retries: 0, durationMs: Date.now() - began,
        telemetry: phaseTimings,
        errorClassification,
        recoveryClassification,
        preSubmitFailure,
        uploadFailure: error.uploadFailure || null,
        reasonCode: lifecycleContext?.submitAcceptanceEvidence?.platformAcceptance === "REJECTED" ? lifecycleContext.submitAcceptanceEvidence.errorReasonCode : code.toLowerCase(),
        submitAcceptanceEvidence: lifecycleContext?.submitAcceptanceEvidence || undefined
      };
    }
  }
}

export const linkedinAdapterExpressions = { target: TARGET_EXPRESSION, audience: VISIBILITY_EXPRESSION, visibility: VISIBILITY_EXPRESSION, editor: EDITOR_EXPRESSION, submitControl: SUBMIT_CONTROL_EXPRESSION };
