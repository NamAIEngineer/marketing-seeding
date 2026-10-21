import { createHash } from "node:crypto";
import { classifyReadinessError } from "./readiness.mjs";
import { LINKEDIN_FEED_URL_FOR_READINESS } from "./orca-browser-client.mjs";

const CONTEXT_EXPRESSION = (expectedPath) => `(() => {
  const path = location.pathname || '';
  const host = location.hostname || '';
  const expectedPath = ${JSON.stringify(expectedPath)}.replace(/\\/$/, '').toLowerCase() || '/';
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const identityVerified = anchors.some((anchor) => {
    try { const url = new URL(anchor.href, location.href); return url.hostname.toLowerCase().replace(/^www\\./, '') === 'linkedin.com' && url.pathname.replace(/\\/$/, '').toLowerCase() === expectedPath; } catch { return false; }
  });
  const pageText = document.body?.innerText || '';
  const securityChallenge = /captcha|security key|passkey|two[- ]step|verify your identity|checkpoint|security challenge|x\u00e1c minh danh t\u00ednh|kh\u00f3a b\u1ea3o m\u1eadt/i.test(path + ' ' + pageText.slice(0, 3000));
  const visible = (node) => Boolean(node && node.getClientRects().length);
  const pathSegments = path.toLowerCase().split('/').filter(Boolean);
  const loginRoute = pathSegments[0] === 'login' || (pathSegments[0] === 'uas' && pathSegments[1] === 'login');
  const loginForm = Array.from(document.querySelectorAll('input[name="session_key"], input[name="session_password"]')).some(visible);
  const loginRequired = loginRoute || loginForm;
  const feedReachable = host.toLowerCase().replace(/^www\\./, '') === 'linkedin.com' && /\\/feed\\/?$/i.test(path) && Boolean(document.querySelector('main,#main-content'));
  const authenticatedNavigation = Array.from(document.querySelectorAll('nav,[role="navigation"]')).some(visible);
  const composerTrigger = Array.from(document.querySelectorAll('button,[role="button"]')).some((node) => visible(node) && [node.getAttribute('aria-label') || '', node.innerText || ''].some((label) => /^(?:start a post|b\u1eaft \u0111\u1ea7u b\u00e0i \u0111\u0103ng)$/i.test(label.trim())));
  const sessionAuthenticated = !loginRequired && feedReachable && authenticatedNavigation && composerTrigger;
  return { linkedinDomain: host.toLowerCase().replace(/^www\\./, '') === 'linkedin.com', loginRequired, securityChallenge, sessionAuthenticated, authenticatedNavigation, composerTrigger, identityVerified, feedReachable };
})()`;

const COMPOSER_EXPRESSION = `(() => {
  const visible = (node) => Boolean(node && node.getClientRects().length);
  const dialogs = Array.from(document.querySelectorAll('dialog,[role="dialog"]')).filter(visible);
  const editors = dialogs.flatMap((dialog) => Array.from(dialog.querySelectorAll('[contenteditable="true"],[role="textbox"]')).filter(visible));
  const controls = dialogs.flatMap((dialog) => Array.from(dialog.querySelectorAll('button,[role="button"],input,[role="combobox"]')).filter(visible).map((node) => ({
    ariaLabel: (node.getAttribute('aria-label') || '').trim(),
    text: (node.innerText || '').replace(/\\s+/g, ' ').trim(),
    placeholder: (node.getAttribute('placeholder') || '').trim(),
    role: (node.getAttribute('role') || '').trim().toLowerCase(),
    tag: (node.tagName || '').toLowerCase()
  })));
  const fields = (control) => [control.ariaLabel, control.text, control.placeholder].filter(Boolean);
  const has = (pattern) => controls.some((control) => fields(control).some((field) => pattern.test(field)));
  const advertisingControls = controls.filter((control) => fields(control).some((field) => /budget|billing|campaign|ad account|boost|sponsor|ngân sách|thanh toán|chiến dịch|tài khoản quảng cáo|quảng bá/i.test(field))).length;
  const path = location.pathname.replace(/\\/$/, '').toLowerCase() || '/';
  const route = path === '/sharing/compose';
  const feedWithComposerSurface = /\\/feed$/i.test(path) && dialogs.length === 1;
  const routeCompatible = route || feedWithComposerSurface;
  const audience = has(/post to|audience|m\u1ecdi ng\u01b0\u1eddi|\u0111\u0103ng cho|anyone|everyone/i);
  const postButton = controls.some((control) => control.tag === 'button' && fields(control).some((field) => /^(\u0111\u0103ng b\u00e0i|post|publish)(?:$|[\s.\u2026])/i.test(field)));
  const mediaControl = has(/media|photo|video|ph\u01b0\u01a1ng ti\u1ec7n truy\u1ec1n th\u00f4ng|\u1ea3nh/i);
  const closeControl = has(/close|dismiss|cancel|h\u1ee7y|\u0111\u00f3ng/i);
  const dialogText = dialogs.map((dialog) => (dialog.innerText || '').replace(/\\s+/g, ' ').trim()).join(' ');
  const retryControl = has(/^(?:refresh|reload|try again|l\u00e0m m\u1edbi|th\u1eed l\u1ea1i)$/i);
  const transientLoadError = dialogs.length === 1 && editors.length === 0 && retryControl && /something went wrong|we hit a snag|there was a problem|\u0111\u00e3 x\u1ea3y ra s\u1ef1 c\u1ed1 \u1edf ph\u00eda ch\u00fang t\u00f4i|ch\u00fang t\u00f4i g\u1eb7p s\u1ef1 c\u1ed1/i.test(dialogText);
  const linkedinDomain = /(^|\\.)linkedin\\.com$/i.test(location.hostname);
  const confirmed = linkedinDomain && routeCompatible && dialogs.length === 1 && editors.length === 1 && audience && postButton && advertisingControls === 0;
  const signalCount = [routeCompatible, dialogs.length === 1, editors.length === 1, audience, postButton, mediaControl, closeControl].filter(Boolean).length;
  return { linkedinDomain, route, routeCompatible, dialogCount: dialogs.length, editorCount: editors.length, audience, postButton, mediaControl, closeControl, advertisingControls, signalCount, transientLoadError, confirmed };
})()`;

function linkedInPath(value) {
  const url = new URL(value);
  return url.pathname.replace(/\/$/, "").toLowerCase() || "/";
}

export function classifyLinkedInComposerState(result) {
  const routeCompatible = result?.routeCompatible === true || result?.route === true;
  if (result?.confirmed === true || (result?.linkedinDomain === true && routeCompatible && result?.dialogCount === 1 && result?.editorCount === 1 && result?.audience === true && result?.postButton === true && result?.advertisingControls === 0)) return "CONFIRMED";
  if (result?.dialogCount === 0 && result?.route !== true && result?.editorCount === 0) return "NOT_COMPOSER";
  const composerEvidence = result?.editorCount > 0 || result?.audience === true || result?.postButton === true || result?.mediaControl === true;
  if (result?.route === true || composerEvidence) return "UNKNOWN";
  return "NOT_COMPOSER";
}

async function sampleComposerState(browser, pageId, timeoutMs) {
  const started = Date.now();
  let state;
  do {
    state = await browser.evaluate(pageId, COMPOSER_EXPRESSION);
    if (classifyLinkedInComposerState(state) === "CONFIRMED") return state;
    if (Date.now() - started >= timeoutMs) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() - started < timeoutMs);
  return state;
}

async function waitForLinkedInFeed(browser, pageId, expectedPath, timeoutMs = 5_000) {
  const started = Date.now();
  let state;
  do {
    state = await browser.evaluate(pageId, CONTEXT_EXPRESSION(expectedPath));
    if (state.feedReachable && state.sessionAuthenticated && state.identityVerified) return state;
    if (state.loginRequired || state.securityChallenge) return state;
    if (Date.now() - started >= timeoutMs) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() - started < timeoutMs);
  return state;
}

const COMPOSER_TRIGGER_DOM_CLICK = `(() => {
  const visible = (node) => Boolean(node && node.getClientRects().length);
  const host = location.hostname.toLowerCase().replace(/^www\\./, '');
  const path = location.pathname.replace(/\\/$/, '').toLowerCase() || '/';
  const dialogs = Array.from(document.querySelectorAll('dialog,[role="dialog"]')).filter(visible);
  const candidates = Array.from(document.querySelectorAll('button,[role="button"],[aria-label]')).filter((node) => {
    if (!visible(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
    const labels = [node.getAttribute('aria-label') || '', node.innerText || ''].map((value) => value.trim());
    return labels.some((label) => /^(?:start a post|b\u1eaft \u0111\u1ea7u b\u00e0i \u0111\u0103ng)$/i.test(label));
  });
  const wrapperCandidates = candidates.filter((node) => node.tagName === 'BUTTON' || node.getAttribute('role') === 'button');
  const labelledCandidates = candidates.filter((node) => node.tagName !== 'BUTTON' && node.getAttribute('role') !== 'button' && node.getAttribute('aria-label'));
  if (host !== 'linkedin.com' || path !== '/feed' || dialogs.length !== 0 || wrapperCandidates.length !== 1 || labelledCandidates.length !== 1) {
    return { clicked: false, reason: 'composer_trigger_fallback_precondition_failed' };
  }
  // LinkedIn's current trigger is a role=button wrapper around a labelled
  // child. ORCA 1.4.230 acknowledges the wrapper click without dispatching
  // the framework event. Prefer the exact React handler owned by that wrapper
  // when it is present; this is still one activation of the one resolved
  // control, and avoids a second provider click or a broad DOM event.
  const activationTarget = labelledCandidates[0];
  const wrapper = wrapperCandidates[0];
  const fiberKey = Object.keys(wrapper).find((key) => key.startsWith('__reactFiber$'));
  const handler = fiberKey ? wrapper[fiberKey]?.memoizedProps?.onClick : null;
  if (typeof handler === 'function') {
    const event = {
      detail: 1,
      target: wrapper,
      currentTarget: wrapper,
      nativeEvent: { detail: 1, target: wrapper, currentTarget: wrapper },
      preventDefault() {},
      stopPropagation() {}
    };
    handler(event);
    return { clicked: true, activationMethod: 'owned_react_handler' };
  }
  if (activationTarget !== candidates[0]) {
    // Compatibility fallback for a future LinkedIn surface that has the same
    // strict wrapper/label structure but no inspectable framework handler.
    activationTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  } else {
    candidates[0].click();
  }
  return { clicked: true, activationMethod: 'owned_dom_event' };
})()`;

const CLOSE_EMPTY_COMPOSER_EXPRESSION = `(() => {
  const visible = (node) => Boolean(node && node.getClientRects().length);
  const host = location.hostname.toLowerCase().replace(/^www\\./, '');
  const path = location.pathname.replace(/\\/$/, '').toLowerCase() || '/';
  const dialogs = Array.from(document.querySelectorAll('dialog,[role="dialog"]')).filter(visible);
  // LinkedIn currently mounts the share composer as a dialog over /feed/
  // instead of navigating to /sharing/compose. Both routes are valid only
  // when the strict dialog/editor/media/close checks below prove ownership of
  // the empty composer. Keep the route allowlist narrow so an unrelated
  // dialog can never be treated as readiness cleanup.
  if (host !== 'linkedin.com' || !(['/sharing/compose', '/feed'].includes(path)) || dialogs.length !== 1) return { closed: false, reason: 'composer_identity_mismatch' };
  const dialog = dialogs[0];
  const editors = Array.from(dialog.querySelectorAll('[contenteditable="true"],[role="textbox"]')).filter(visible);
  if (editors.length !== 1 || editors.some((node) => String(node.innerText || node.textContent || '').trim())) return { closed: false, reason: 'composer_has_content' };
  const media = Array.from(dialog.querySelectorAll('video,[data-test-media-preview],[data-test-image-preview]')).filter(visible);
  if (media.length) return { closed: false, reason: 'composer_has_media' };
  const cancelButtons = Array.from(dialog.querySelectorAll('button[aria-label],button')).filter((node) => visible(node) && !node.disabled && /^(?:cancel|discard|close|h\u1ee7y b\u1ecf|\u0111\u00f3ng)$/i.test((node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim()));
  if (cancelButtons.length !== 1) return { closed: false, reason: 'composer_close_control_ambiguous' };
  cancelButtons[0].click();
  return { closed: true };
})()`;

export async function openLinkedInComposer(browser, pageId, { mountTimeoutMs = 8_000, expectedIdentityPath = "/" } = {}) {
  let domFallbackUsed = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // ORCA's current click command acknowledges this custom role=button without
    // dispatching a page click. Use the accessible label and strict feed/dialog
    // preconditions to activate that one control directly through the browser DOM.
    const activation = await browser.evaluate(pageId, COMPOSER_TRIGGER_DOM_CLICK);
    let state = await browser.evaluate(pageId, COMPOSER_EXPRESSION);
    domFallbackUsed ||= activation?.clicked === true;
    if (classifyLinkedInComposerState(state) === "CONFIRMED") return { state, domFallbackUsed };
    if (activation?.clicked !== true) return { state, domFallbackUsed, reasonCode: activation?.reason || "composer_trigger_not_activated" };
    if (!state.transientLoadError) state = await sampleComposerState(browser, pageId, mountTimeoutMs);
    if (classifyLinkedInComposerState(state) === "CONFIRMED") return { state, domFallbackUsed };
    if (!state.transientLoadError || attempt > 0) return { state, domFallbackUsed };

    // Retry this specific LinkedIn load error once, after returning to the feed
    // and revalidating the same account/session. No content is entered or sent.
    await browser.navigate(pageId, LINKEDIN_FEED_URL_FOR_READINESS);
    await browser.waitForFeed(pageId);
    const feed = await browser.evaluate(pageId, CONTEXT_EXPRESSION(expectedIdentityPath));
    if (!feed.feedReachable || !feed.sessionAuthenticated || !feed.identityVerified || feed.securityChallenge) {
      return { state, domFallbackUsed, reasonCode: "composer_retry_identity_unverified" };
    }
  }
  return { state: {}, domFallbackUsed, reasonCode: "composer_retry_exhausted" };
}

function safeEvidence(value) {
  return `linkedin-readiness:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
}

export class LinkedInReadinessProvider {
  constructor(browser, { ttlMs } = {}) {
    if (!browser) throw new Error("LinkedIn readiness requires an ORCA browser adapter");
    this.browser = browser;
    this.ttlMs = ttlMs;
  }

  async checkReadiness(context) {
    const checkedAt = new Date();
    try {
      const identityReference = context.identityReference || context.expectedIdentityUrl;
      if (!context.profileId || !identityReference) {
        return { state: "HUMAN_REQUIRED", reasonCode: "account_identity_not_configured", retryable: false, recoveryClassification: "HUMAN_REQUIRED", checkedAt: checkedAt.toISOString() };
      }
      const profile = (await this.browser.listProfiles()).find((item) => (typeof item === "string" ? item : item.id || item.profileId) === context.profileId);
      if (!profile) {
        return { state: "HUMAN_REQUIRED", reasonCode: "expected_profile_missing", retryable: false, recoveryClassification: "HUMAN_REQUIRED", checkedAt: checkedAt.toISOString() };
      }

      const tabs = (await this.browser.listTabs()).filter((tab) => {
        const profileId = typeof tab.profile === "string" ? tab.profile : tab.profile?.id || tab.profile?.profileId || tab.profileId;
        return profileId === context.profileId;
      });
      let pageId;
      if (tabs.length === 0) pageId = await this.browser.createTab(context.profileId);
      else {
        const linkedinTabs = tabs.filter((tab) => /(^|\.)linkedin\.com$/i.test(new URL(tab.url || "about:blank").hostname));
        if (linkedinTabs.length > 1) {
          return { state: "HUMAN_REQUIRED", reasonCode: "profile_has_ambiguous_linkedin_tabs", retryable: false, recoveryClassification: "HUMAN_REQUIRED", checkedAt: checkedAt.toISOString() };
        }
        const selected = linkedinTabs[0] || (tabs.length === 1 ? tabs[0] : null);
        if (!selected) return { state: "HUMAN_REQUIRED", reasonCode: "profile_tab_identity_ambiguous", retryable: false, recoveryClassification: "HUMAN_REQUIRED", checkedAt: checkedAt.toISOString() };
        pageId = selected.browserPageId || selected.pageId || selected.id;
      }
      if (!pageId) return { state: "UNKNOWN", reasonCode: "browser_page_identity_missing", retryable: true, recoveryClassification: "RECOVERABLE", checkedAt: checkedAt.toISOString() };

      let tab = await this.browser.showTab(pageId);
      if (tab.profileId !== context.profileId) {
        return { state: "HUMAN_REQUIRED", reasonCode: "browser_profile_mismatch", retryable: false, recoveryClassification: "HUMAN_REQUIRED", checkedAt: checkedAt.toISOString() };
      }
      if (!/(^|\.)linkedin\.com$/i.test(new URL(tab.url || "about:blank").hostname) || !/\/feed\/?$/i.test(new URL(tab.url).pathname)) {
        await this.browser.navigate(pageId, LINKEDIN_FEED_URL_FOR_READINESS);
        await this.browser.waitForFeed(pageId);
        tab = await this.browser.showTab(pageId);
      }

      let contextState = await this.browser.evaluate(pageId, CONTEXT_EXPRESSION(linkedInPath(identityReference)));
      if (contextState.securityChallenge) {
        return { state: "HUMAN_REQUIRED", reasonCode: "security_challenge", retryable: false, recoveryClassification: "HUMAN_REQUIRED", checkedAt: checkedAt.toISOString() };
      }
      if (contextState.loginRequired || !contextState.sessionAuthenticated) {
        if (contextState.loginRequired) {
          return { state: "HUMAN_REQUIRED", reasonCode: "authentication_required", retryable: false, recoveryClassification: "HUMAN_REQUIRED", checkedAt: checkedAt.toISOString() };
        }
        return { state: "UNKNOWN", reasonCode: "linkedin_auth_state_ambiguous", retryable: true, recoveryClassification: "RECOVERABLE", checkedAt: checkedAt.toISOString() };
      }
      if (!contextState.identityVerified) {
        return { state: "HUMAN_REQUIRED", reasonCode: "account_identity_mismatch", retryable: false, recoveryClassification: "HUMAN_REQUIRED", checkedAt: checkedAt.toISOString() };
      }
      if (!contextState.feedReachable) {
        return { state: "UNKNOWN", reasonCode: "linkedin_feed_unavailable", retryable: true, recoveryClassification: "RECOVERABLE", checkedAt: checkedAt.toISOString() };
      }

      const opened = await openLinkedInComposer(this.browser, pageId, { expectedIdentityPath: linkedInPath(identityReference) });
      const composer = opened.state;
      if (opened.reasonCode) return { state: "BLOCKED", reasonCode: "composer_trigger_missing", retryable: true, recoveryClassification: "RECOVERABLE", checkedAt: checkedAt.toISOString() };
      const composerClassification = classifyLinkedInComposerState(composer);
      if (composerClassification !== "CONFIRMED") {
        await this.browser.pressEscape(pageId).catch(() => undefined);
        return {
          state: composerClassification === "UNKNOWN" ? "UNKNOWN" : "BLOCKED",
          reasonCode: composerClassification === "UNKNOWN" ? "composer_state_incomplete" : "composer_not_confirmed",
          retryable: true, recoveryClassification: "RECOVERABLE", checkedAt: checkedAt.toISOString()
        };
      }
      const closeResult = await this.browser.evaluate(pageId, CLOSE_EMPTY_COMPOSER_EXPRESSION);
      if (!closeResult?.closed) return { state: "UNKNOWN", reasonCode: closeResult?.reason || "composer_close_unverified", retryable: true, recoveryClassification: "RECOVERABLE", checkedAt: checkedAt.toISOString() };
      contextState = await waitForLinkedInFeed(this.browser, pageId, linkedInPath(identityReference));
      const composerClosed = contextState.feedReachable && contextState.identityVerified && contextState.sessionAuthenticated;
      if (!composerClosed) return { state: "UNKNOWN", reasonCode: "composer_close_unverified", retryable: true, recoveryClassification: "RECOVERABLE", checkedAt: checkedAt.toISOString() };
      const finishedAt = new Date();
      return {
        state: "READY",
        checkedAt: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + (this.ttlMs || 5 * 60 * 1000)).toISOString(),
        reasonCode: "linkedin_session_target_composer_verified",
        capabilities: { sessionAuthenticated: true, identityVerified: true, feedReachable: true, composerAvailable: true, composerCloseable: true },
        evidenceReference: safeEvidence({ platform: context.platform, profileId: context.profileId, targetId: context.targetId, checkedAt: checkedAt.toISOString(), finishedAt: finishedAt.toISOString() }),
        retryable: false,
        recoveryClassification: "NONE"
      };
    } catch (error) {
      return { ...classifyReadinessError(error), checkedAt: checkedAt.toISOString() };
    }
  }
}

export function linkedInReadinessExpressions() {
  return { context: CONTEXT_EXPRESSION, composer: COMPOSER_EXPRESSION };
}
