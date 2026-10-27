import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { evaluateBrowser } from "./browser-evaluation.mjs";

const surfaceState = `(() => {
  /* LINKEDIN_MEDIA_SURFACE_STATE */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  const editors = dialogs.filter(d => d !== composers[0] && /media editor|tr\u00ecnh ch\u1ec9nh s\u1eeda/i.test(d.innerText || '') &&
    [...d.querySelectorAll('button')].some(b => /^(upload from computer|t\u1ea3i l\u00ean t\u1eeb m\u00e1y t\u00ednh)$/i.test((b.innerText || '').trim())));
  return { dialogCount: dialogs.length, composerCount: composers.length, mediaDialogCount: editors.length,
    fileInputCount: document.querySelectorAll('input[type="file"]').length };
})()`;

const openMedia = `(() => {
  /* LINKEDIN_MEDIA_OPEN */
  const visible = e => Boolean(e && e.getClientRects().length);
  const composers = [...document.querySelectorAll('dialog')].filter(visible).filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  if (location.hostname.toLowerCase().replace(/^www\\./, '') !== 'linkedin.com' || location.pathname !== '/sharing/compose' || composers.length !== 1)
    return { clicked: false, reason: 'composer_context_invalid' };
  const buttons = [...composers[0].querySelectorAll('button')].filter(b => visible(b) && !b.disabled &&
    /^(media|ph\u01b0\u01a1ng ti\u1ec7n truy\u1ec1n th\u00f4ng)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
  if (buttons.length !== 1) return { clicked: false, reason: 'media_control_ambiguous' };
  buttons[0].click();
  return { clicked: true };
})()`;

const uploadButton = `(() => {
  /* LINKEDIN_MEDIA_UPLOAD_BUTTON */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  const editors = dialogs.filter(d => d !== composers[0] && /media editor|tr\u00ecnh ch\u1ec9nh s\u1eeda/i.test(d.innerText || ''));
  if (composers.length !== 1 || editors.length !== 1) return { clicked: false, reason: 'media_dialog_ambiguous' };
  const buttons = [...editors[0].querySelectorAll('button')].filter(b => visible(b) && !b.disabled &&
    /^(upload from computer|t\u1ea3i l\u00ean t\u1eeb m\u00e1y t\u00ednh)$/i.test((b.innerText || '').trim()));
  if (buttons.length !== 1) return { clicked: false, reason: 'upload_control_ambiguous' };
  buttons[0].click();
  return { clicked: true };
})()`;

const baselineInputs = marker => `(() => {
  /* LINKEDIN_MEDIA_BASELINE */
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  for (const input of inputs) input.setAttribute('data-orca-media-baseline', ${JSON.stringify(marker)});
  return { fileInputCount: inputs.length, selectedCount: inputs.filter(input => input.files?.length).length };
})()`;

const inputState = (marker, mediaType, extension, select = false) => `(() => {
  /* LINKEDIN_MEDIA_INPUT_${select ? "SELECT" : "STATE"} */
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  const fresh = inputs.filter(input => input.getAttribute('data-orca-media-baseline') !== ${JSON.stringify(marker)});
  const eligible = fresh.filter(input => {
    const accept = (input.accept || '').toLowerCase();
    return input.isConnected && !input.disabled && !input.files?.length &&
      (accept.includes('video/*') || accept.includes(${JSON.stringify(mediaType.toLowerCase())}) || accept.includes(${JSON.stringify(extension.toLowerCase())}));
  });
  if (${select} && eligible.length === 1) eligible[0].setAttribute('data-orca-media-target', ${JSON.stringify(marker)});
  const selectorCount = document.querySelectorAll('input[data-orca-media-target=${marker}]').length;
  return { fileInputCount: inputs.length, newInputCount: fresh.length, eligibleCount: eligible.length,
    portalMounted: eligible.length === 1 && !eligible[0].closest('dialog'), selectorCount };
})()`;

const previewState = marker => `(() => {
  /* LINKEDIN_MEDIA_PREVIEW_STATE */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  const editors = dialogs.filter(d => d !== composers[0] && /media editor|tr\u00ecnh ch\u1ec9nh s\u1eeda/i.test(d.innerText || ''));
  const selected = [...document.querySelectorAll('input[data-orca-media-target=${marker}]')];
  const file = selected.length === 1 ? selected[0].files?.[0] : null;
  const surface = editors.length === 1 ? editors[0] : composers[0];
  const videos = surface ? [...surface.querySelectorAll('video')].filter(v => visible(v) && v.readyState >= 1 && v.videoWidth > 0 && v.videoHeight > 0) : [];
  const images = surface ? [...surface.querySelectorAll('img')].filter(i => visible(i) && i.naturalWidth > 0) : [];
  return { dialogCount: dialogs.length, composerCount: composers.length, mediaDialogCount: editors.length,
    selectedInputCount: selected.length, fileCount: file ? 1 : 0, filename: file?.name || '', mediaType: file?.type || '',
    videoCount: videos.length, videoWidth: videos[0]?.videoWidth || 0, videoHeight: videos[0]?.videoHeight || 0,
    imageCount: images.length, uploadError: /upload failed|couldn't upload|cannot upload|upload error|t\u1ea3i l\u00ean th\u1ea5t b\u1ea1i/i.test(editors[0]?.innerText || '') };
})()`;

const finishState = `(() => {
  /* LINKEDIN_MEDIA_FINISH_STATE */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  const editors = dialogs.filter(d => d !== composers[0]);
  const buttons = editors.length === 1 ? [...editors[0].querySelectorAll('button')].filter(visible) : [];
  const named = pattern => buttons.filter(b => pattern.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
  const next = named(/^(next|ti\u1ebfp theo)$/i);
  const done = named(/^(done|xong|ho\u00e0n t\u1ea5t)$/i);
  return { composerCount: composers.length, mediaDialogCount: editors.length, nextCount: next.length,
    nextEnabled: next.length === 1 && !next[0].disabled, doneCount: done.length,
    doneEnabled: done.length === 1 && !done[0].disabled };
})()`;

const finishClick = action => `(() => {
  /* LINKEDIN_MEDIA_FINISH_CLICK */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  const editors = dialogs.filter(d => d !== composers[0]);
  if (composers.length !== 1 || editors.length !== 1) return { clicked: false };
  const pattern = ${action === "next" ? "/^(next|ti\\u1ebfp theo)$/i" : "/^(done|xong|ho\\u00e0n t\\u1ea5t)$/i"};
  const buttons = [...editors[0].querySelectorAll('button')].filter(b => visible(b) && !b.disabled && pattern.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
  if (buttons.length !== 1) return { clicked: false };
  buttons[0].click();
  return { clicked: true };
})()`;

async function poll(browser, pageId, expression, accept, timeoutMs) {
  const started = Date.now();
  let state;
  do {
    state = await browser.evaluate(pageId, expression);
    if (accept(state)) return { state, durationMs: Date.now() - started, reached: true };
    if (Date.now() - started >= timeoutMs) break;
    await sleep(250);
  } while (true);
  return { state, durationMs: Date.now() - started, reached: false };
}

export function selectLinkedInUploadInput(state) {
  if (!state || !Number.isInteger(state.newInputCount) || state.newInputCount === 0) return "FILE_INPUT_NOT_MOUNTED";
  if (state.eligibleCount === 0) return "FILE_INPUT_NOT_FOUND";
  if (state.eligibleCount !== 1) return "FILE_INPUT_AMBIGUOUS";
  return null;
}

export async function attachLinkedInMedia(browser, pageId, media, { timeoutMs = 60_000 } = {}) {
  const started = Date.now();
  const marker = `m${randomUUID().replaceAll("-", "")}`;
  const extension = path.extname(media.path).toLowerCase();
  const evidence = { dialogCount: 0, fileInputCount: 0, selectedSurface: "unknown", waitDurationMs: 0, attachAttempted: false, previewObserved: false };
  const fail = (subreason, cause) => {
    const error = Object.assign(new Error(subreason), { code: "UPLOAD_ERROR", uploadFailure: { ...evidence, subreason } });
    if (cause) error.cause = cause;
    throw error;
  };
  const before = await browser.evaluate(pageId, surfaceState);
  evidence.dialogCount = before.dialogCount || 0;
  evidence.fileInputCount = before.fileInputCount || 0;
  if (before.composerCount !== 1 || before.mediaDialogCount > 0) fail("MEDIA_DIALOG_AMBIGUOUS");
  const activated = await evaluateBrowser(browser, pageId, openMedia, { mutation: true, operation: "LINKEDIN_MEDIA_OPEN" });
  if (!activated?.clicked) fail("MEDIA_DIALOG_NOT_FOUND");
  const mount = await poll(browser, pageId, surfaceState, state => state?.mediaDialogCount > 0, Math.min(timeoutMs, 8_000));
  evidence.dialogCount = mount.state?.dialogCount || 0;
  evidence.waitDurationMs = mount.durationMs;
  if (!mount.reached) fail("MEDIA_DIALOG_NOT_FOUND");
  if (mount.state.composerCount !== 1 || mount.state.mediaDialogCount !== 1) fail("MEDIA_DIALOG_AMBIGUOUS");
  evidence.selectedSurface = "media_editor_dialog";
  const mediaControlOpenMs = Date.now() - started;
  const baseline = await evaluateBrowser(browser, pageId, baselineInputs(marker), { mutation: true, operation: "LINKEDIN_MEDIA_BASELINE" });
  evidence.fileInputCount = baseline.fileInputCount || 0;
  if (baseline.selectedCount) fail("FILE_INPUT_AMBIGUOUS");
  const uploadActivated = await evaluateBrowser(browser, pageId, uploadButton, { mutation: true, operation: "LINKEDIN_MEDIA_UPLOAD_BUTTON" });
  if (!uploadActivated?.clicked) fail("FILE_INPUT_NOT_FOUND");
  const input = await poll(browser, pageId, inputState(marker, media.type, extension), state => state?.newInputCount > 0, Math.min(timeoutMs, 8_000));
  evidence.waitDurationMs = input.durationMs;
  evidence.fileInputCount = input.state?.fileInputCount || evidence.fileInputCount;
  const inputError = selectLinkedInUploadInput(input.state);
  if (inputError) fail(inputError);
  const selected = await evaluateBrowser(browser, pageId, inputState(marker, media.type, extension, true), { mutation: true, operation: "LINKEDIN_MEDIA_INPUT_SELECT" });
  if (selected?.eligibleCount !== 1 || selected.selectorCount !== 1) fail("FILE_INPUT_AMBIGUOUS");
  const uploadTargetDiscoveryMs = Date.now() - started - mediaControlOpenMs;
  const attachStarted = Date.now();
  evidence.attachAttempted = true;
  if (typeof browser.uploadSelector !== "function") fail("FILE_ATTACH_FAILED");
  try {
    await browser.uploadSelector(pageId, `input[data-orca-media-target=${marker}]`, media.path);
  } catch (error) {
    fail("FILE_ATTACH_FAILED", error);
  }
  const fileAttachMs = Date.now() - attachStarted;
  const readyStarted = Date.now();
  const expectedName = path.win32.basename(media.path).toLowerCase();
  const firstPreview = await browser.evaluate(pageId, previewState(marker));
  if (firstPreview?.uploadError) fail("MEDIA_PREVIEW_INVALID");
  const ready = firstPreview?.fileCount === 1 && firstPreview.filename?.toLowerCase() === expectedName && firstPreview.videoCount > 0
    ? { state: firstPreview, reached: true, durationMs: 0 }
    : await poll(browser, pageId, previewState(marker), value => value?.uploadError || (value?.fileCount === 1 && value.filename?.toLowerCase() === expectedName && value.videoCount > 0), timeoutMs);
  evidence.waitDurationMs = ready.durationMs;
  evidence.previewObserved = Boolean(ready.state?.videoCount);
  if (!ready.reached) fail(firstPreview?.fileCount === 0 ? "MEDIA_PREVIEW_NOT_FOUND" : "MEDIA_PREVIEW_TIMEOUT");
  if (ready.state.uploadError || ready.state.composerCount !== 1 || ready.state.mediaDialogCount !== 1 ||
      ready.state.selectedInputCount !== 1 || ready.state.fileCount !== 1 ||
      ready.state.filename?.toLowerCase() !== expectedName || !ready.state.mediaType?.toLowerCase().startsWith("video/") ||
      !ready.state.videoWidth || !ready.state.videoHeight) fail("MEDIA_PREVIEW_INVALID");

  // LinkedIn's media editor must commit the selected video back to the post composer.
  for (let step = 0; step < 3; step += 1) {
    const phase = await poll(browser, pageId, finishState,
      state => state?.mediaDialogCount === 0 || state?.nextEnabled || state?.doneEnabled,
      Math.min(timeoutMs, 12_000));
    evidence.waitDurationMs = phase.durationMs;
    if (!phase.reached || phase.state.composerCount !== 1 || phase.state.mediaDialogCount > 1) fail("MEDIA_PREVIEW_INVALID");
    if (phase.state.mediaDialogCount === 0) break;
    const action = phase.state.doneEnabled ? "done" : "next";
    const clicked = await evaluateBrowser(browser, pageId, finishClick(action), { mutation: true, operation: "LINKEDIN_MEDIA_FINISH_CLICK" });
    if (!clicked?.clicked) fail("MEDIA_PREVIEW_INVALID");
    if (action === "done") {
      const closed = await poll(browser, pageId, finishState, state => state?.mediaDialogCount === 0, Math.min(timeoutMs, 12_000));
      if (!closed.reached || closed.state.composerCount !== 1) fail("MEDIA_PREVIEW_INVALID");
      break;
    }
    if (step === 2) fail("MEDIA_PREVIEW_INVALID");
  }
  const final = await browser.evaluate(pageId, finishState);
  if (final.composerCount !== 1 || final.mediaDialogCount !== 0) fail("MEDIA_PREVIEW_INVALID");
  return { mediaHashMatched: true, mediaPreviewConfirmed: true, mediaAttachMs: Date.now() - started,
    mediaReadyMs: Date.now() - readyStarted, mediaControlOpenMs, uploadTargetDiscoveryMs, fileAttachMs,
    selectedSurface: evidence.selectedSurface, portalMounted: selected.portalMounted === true };
}

const cleanupState = `(() => {
  /* LINKEDIN_MEDIA_CLEANUP_STATE */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  return { path: location.pathname, composerCount: composers.length, mediaDialogCount: dialogs.filter(d => d !== composers[0]).length,
    composerVideoCount: composers[0] ? [...composers[0].querySelectorAll('video')].filter(visible).length : 0,
    selectedFileCount: [...document.querySelectorAll('input[type="file"]')].filter(i => i.files?.length).length };
})()`;

const removeComposerVideo = `(() => {
  /* LINKEDIN_MEDIA_REMOVE_VIDEO */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  if (location.pathname !== '/sharing/compose' || dialogs.length !== 1 || composers.length !== 1) return { clicked: false };
  const buttons = [...composers[0].querySelectorAll('button')].filter(b => visible(b) &&
    /^(close|remove|x\u00f3a)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()) &&
    [b.parentElement, b.parentElement?.parentElement, b.parentElement?.parentElement?.parentElement].some(e => e?.querySelector('video')));
  if (buttons.length !== 1) return { clicked: false };
  buttons[0].click();
  return { clicked: true };
})()`;

const cancelMediaEditor = `(() => {
  /* LINKEDIN_MEDIA_CANCEL_EDITOR */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  const editors = dialogs.filter(d => d !== composers[0]);
  if (composers.length !== 1 || editors.length !== 1) return { clicked: false };
  const buttons = [...editors[0].querySelectorAll('button')].filter(b => visible(b) &&
    /^(cancel|close|discard|h\u1ee7y b\u1ecf|\u0111\u00f3ng)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
  if (buttons.length !== 1) return { clicked: false };
  buttons[0].click();
  return { clicked: true };
})()`;

const clearComposer = expectedHash => `(async () => {
  /* LINKEDIN_MEDIA_CLEAR_COMPOSER */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  if (location.hostname.toLowerCase().replace(/^www\\./, '') !== 'linkedin.com' || location.pathname !== '/sharing/compose' || composers.length !== 1)
    return { cleared: false, reason: 'composer_identity_mismatch' };
  const editors = [...composers[0].querySelectorAll('[contenteditable="true"],[role="textbox"]')].filter(visible);
  if (editors.length !== 1) return { cleared: false, reason: 'editor_ambiguous' };
  const editor = editors[0];
  const text = editor.innerText || editor.textContent || '';
  if (text.trim()) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== ${JSON.stringify(expectedHash)}) return { cleared: false, reason: 'content_identity_mismatch' };
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.deleteContents();
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
  }
  return { cleared: !(editor.innerText || editor.textContent || '').trim() };
})()`;

const cancelComposer = `(() => {
  /* LINKEDIN_MEDIA_CANCEL_COMPOSER */
  const visible = e => Boolean(e && e.getClientRects().length);
  const dialogs = [...document.querySelectorAll('dialog')].filter(visible);
  const composers = dialogs.filter(d => [...d.querySelectorAll('[contenteditable="true"],[role="textbox"]')].some(visible));
  if (location.pathname !== '/sharing/compose' || composers.length !== 1 || dialogs.length !== 1) return { clicked: false };
  const editor = [...composers[0].querySelectorAll('[contenteditable="true"],[role="textbox"]')].filter(visible);
  if (editor.length !== 1 || String(editor[0].innerText || editor[0].textContent || '').trim()) return { clicked: false };
  const buttons = [...composers[0].querySelectorAll('button')].filter(b => visible(b) &&
    /^(cancel|discard|h\u1ee7y b\u1ecf)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
  if (buttons.length !== 1) return { clicked: false };
  buttons[0].click();
  return { clicked: true };
})()`;

export async function cleanupLinkedInComposer(browser, pageId, contentHash) {
  let state = await browser.evaluate(pageId, cleanupState);
  if (state.path === '/feed/' && state.composerCount === 0) return true;
  if (state.path !== '/sharing/compose' || state.composerCount !== 1 || state.mediaDialogCount > 1) throw new Error("LinkedIn draft cleanup state is ambiguous");
  if (state.mediaDialogCount === 1) {
    const cancelled = await evaluateBrowser(browser, pageId, cancelMediaEditor, { mutation: true, operation: "LINKEDIN_MEDIA_CANCEL_EDITOR" });
    if (!cancelled?.clicked) throw new Error("LinkedIn media editor could not be safely cancelled");
    const closed = await poll(browser, pageId, cleanupState, value => value?.mediaDialogCount === 0, 8_000);
    if (!closed.reached || closed.state.composerCount !== 1) throw new Error("LinkedIn media editor cleanup was not verified");
  }
  if (state.composerVideoCount > 0) {
    const removed = await evaluateBrowser(browser, pageId, removeComposerVideo, { mutation: true, operation: "LINKEDIN_MEDIA_REMOVE_VIDEO" });
    if (!removed?.clicked) throw new Error("LinkedIn video preview could not be safely removed");
    const absent = await poll(browser, pageId, cleanupState, value => value?.composerVideoCount === 0, 8_000);
    if (!absent.reached) throw new Error("LinkedIn video removal was not verified");
  }
  const cleared = await evaluateBrowser(browser, pageId, clearComposer(contentHash), { mutation: true, operation: "LINKEDIN_MEDIA_CLEAR_COMPOSER" });
  if (!cleared?.cleared) throw new Error("LinkedIn approved content could not be safely cleared");
  const cancelled = await evaluateBrowser(browser, pageId, cancelComposer, { mutation: true, operation: "LINKEDIN_MEDIA_CANCEL_COMPOSER" });
  if (!cancelled?.clicked) throw new Error("LinkedIn composer could not be safely cancelled");
  await browser.waitForFeed(pageId);
  // The SPA may retain the hidden selected file input after dismissing the composer.
  // A same-profile feed navigation unloads that detached upload state.
  await browser.navigate(pageId, 'https://www.linkedin.com/feed/');
  await browser.waitForFeed(pageId);
  state = await browser.evaluate(pageId, cleanupState);
  if (state.path !== '/feed/' || state.composerCount !== 0 || state.selectedFileCount !== 0) throw new Error("LinkedIn draft cleanup was not verified");
  return true;
}

export const linkedInMediaExpressions = { surfaceState, inputState, previewState, finishState };
