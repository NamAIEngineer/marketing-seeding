import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { attachLinkedInMedia, cleanupLinkedInComposer, selectLinkedInUploadInput } from "../src/linkedin-media.mjs";

const media = { path: "D:\\approved.mp4", type: "video/mp4" };

test("LinkedIn media filename extraction accepts Windows and POSIX paths", () => {
  assert.equal(path.win32.basename("D:\\approved.mp4"), "approved.mp4");
  assert.equal(path.win32.basename("/tmp/approved.mp4"), "approved.mp4");
});

function browserFixture(options = {}) {
  let phase = "composer";
  const calls = [];
  const browser = {
    legacyMutationEvaluation: true,
    calls,
    async evaluate(_pageId, expression) {
      new Function(`return ${expression}`);
      calls.push(expression.match(/LINKEDIN_MEDIA_[A-Z_]+/)?.[0] || "eval");
      if (expression.includes("LINKEDIN_MEDIA_SURFACE_STATE")) {
        const mediaDialogCount = phase === "composer" || options.noMediaDialog ? 0 : options.ambiguousMediaDialog ? 2 : 1;
        return { dialogCount: 1 + mediaDialogCount, composerCount: 1, mediaDialogCount, fileInputCount: phase === "composer" ? 2 : 2 + (options.newInputs ?? 1) };
      }
      if (expression.includes("LINKEDIN_MEDIA_OPEN")) { phase = "media"; return { clicked: true }; }
      if (expression.includes("LINKEDIN_MEDIA_BASELINE")) return { fileInputCount: 2, selectedCount: 0 };
      if (expression.includes("LINKEDIN_MEDIA_UPLOAD_BUTTON")) { phase = "upload_control"; return { clicked: true }; }
      if (expression.includes("LINKEDIN_MEDIA_INPUT_")) {
        const newInputCount = phase === "upload_control" ? options.newInputs ?? 1 : 0;
        const eligibleCount = options.eligibleInputs ?? newInputCount;
        return { fileInputCount: 2 + newInputCount, newInputCount, eligibleCount,
          selectorCount: expression.includes("LINKEDIN_MEDIA_INPUT_SELECT") && eligibleCount === 1 ? 1 : 0,
          portalMounted: options.portalMounted !== false };
      }
      if (expression.includes("LINKEDIN_MEDIA_PREVIEW_STATE")) {
        const fileCount = options.previewFileMissing ? 0 : 1;
        const visibleVideo = options.previewMissing ? 0 : 1;
        return { composerCount: 1, mediaDialogCount: 1, selectedInputCount: 1, fileCount,
          filename: fileCount ? "approved.mp4" : "", mediaType: "video/mp4",
          videoCount: visibleVideo, videoWidth: visibleVideo ? 1280 : 0, videoHeight: visibleVideo ? 720 : 0,
          uploadError: false };
      }
      if (expression.includes("LINKEDIN_MEDIA_FINISH_STATE")) return {
        composerCount: 1, mediaDialogCount: phase === "done" ? 0 : 1,
        nextEnabled: phase === "attached", doneEnabled: phase === "next"
      };
      if (expression.includes("LINKEDIN_MEDIA_FINISH_CLICK")) {
        phase = expression.includes("const pattern = /^(next") ? "next" : "done";
        return { clicked: true };
      }
      throw new Error("Unexpected browser expression");
    },
    async uploadSelector(_pageId, selector, filePath) {
      calls.push("uploadSelector");
      assert.match(selector, /^input\[data-orca-media-target=m[a-f0-9]{32}\]$/);
      assert.equal(filePath, media.path);
      if (options.attachFailure) throw new Error("Browser upload rejected");
      phase = "attached";
    },
    async click() { assert.fail("Semantic click or Post must not be used by media helper"); }
  };
  return browser;
}

test("nested media dialog mounts a hidden body portal input only after its upload control", async () => {
  const browser = browserFixture();
  const result = await attachLinkedInMedia(browser, "page", media, { timeoutMs: 10 });
  assert.equal(result.mediaPreviewConfirmed, true);
  assert.equal(result.portalMounted, true);
  assert.equal(result.selectedSurface, "media_editor_dialog");
  assert.equal(browser.calls.filter(x => x === "uploadSelector").length, 1);
  assert.ok(browser.calls.indexOf("LINKEDIN_MEDIA_UPLOAD_BUTTON") < browser.calls.indexOf("LINKEDIN_MEDIA_INPUT_STATE"));
});

test("file input inside media dialog and one video candidate among multiple new inputs are unambiguous", async () => {
  const browser = browserFixture({ portalMounted: false, newInputs: 2, eligibleInputs: 1 });
  const result = await attachLinkedInMedia(browser, "page", media, { timeoutMs: 10 });
  assert.equal(result.portalMounted, false);
  assert.equal(selectLinkedInUploadInput({ newInputCount: 2, eligibleCount: 1 }), null);
});

for (const [name, options, subreason] of [
  ["media editor does not mount", { noMediaDialog: true }, "MEDIA_DIALOG_NOT_FOUND"],
  ["multiple media editors are ambiguous", { ambiguousMediaDialog: true }, "MEDIA_DIALOG_AMBIGUOUS"],
  ["file input never mounts", { newInputs: 0 }, "FILE_INPUT_NOT_MOUNTED"],
  ["new inputs do not accept video", { eligibleInputs: 0 }, "FILE_INPUT_NOT_FOUND"],
  ["multiple video inputs are ambiguous", { newInputs: 2, eligibleInputs: 2 }, "FILE_INPUT_AMBIGUOUS"],
  ["direct file attachment fails", { attachFailure: true }, "FILE_ATTACH_FAILED"],
  ["selected file is not reflected in preview", { previewFileMissing: true }, "MEDIA_PREVIEW_NOT_FOUND"],
  ["video preview times out", { previewMissing: true }, "MEDIA_PREVIEW_TIMEOUT"]
]) {
  test(`${name} returns ${subreason} with non-secret evidence`, async () => {
    const browser = browserFixture(options);
    await assert.rejects(
      attachLinkedInMedia(browser, "page", media, { timeoutMs: 5 }),
      error => {
        assert.equal(error.code, "UPLOAD_ERROR");
        assert.equal(error.uploadFailure.subreason, subreason);
        assert.equal(typeof error.uploadFailure.dialogCount, "number");
        assert.equal(typeof error.uploadFailure.fileInputCount, "number");
        assert.equal(error.uploadFailure.selectedSurface === "unknown" || error.uploadFailure.selectedSurface === "media_editor_dialog", true);
        assert.equal(typeof error.uploadFailure.attachAttempted, "boolean");
        assert.equal(typeof error.uploadFailure.previewObserved, "boolean");
        return true;
      }
    );
  });
}

test("cleanup removes the video, selects composer Cancel over preview Close, and unloads the stale file input", async () => {
  const calls = [];
  let phase = "composer-video";
  const browser = {
    legacyMutationEvaluation: true,
    async evaluate(_pageId, expression) {
      new Function(`return ${expression}`);
      const name = expression.match(/LINKEDIN_MEDIA_[A-Z_]+/)?.[0];
      calls.push(name);
      if (name === "LINKEDIN_MEDIA_CLEANUP_STATE") return {
        path: phase === "feed" || phase === "fresh-feed" ? "/feed/" : "/sharing/compose",
        composerCount: phase === "feed" || phase === "fresh-feed" ? 0 : 1,
        mediaDialogCount: 0, composerVideoCount: phase === "composer-video" ? 1 : 0,
        selectedFileCount: phase === "fresh-feed" ? 0 : 1
      };
      if (name === "LINKEDIN_MEDIA_REMOVE_VIDEO") { phase = "composer-empty"; return { clicked: true }; }
      if (name === "LINKEDIN_MEDIA_CLEAR_COMPOSER") return { cleared: true };
      if (name === "LINKEDIN_MEDIA_CANCEL_COMPOSER") {
        assert.match(expression, /cancel\|discard\|h/);
        assert.doesNotMatch(expression, /cancel\|close\|discard/);
        phase = "feed";
        return { clicked: true };
      }
      throw new Error(`Unexpected ${name}`);
    },
    async waitForFeed() { calls.push("waitForFeed"); },
    async navigate(_pageId, url) { assert.equal(url, "https://www.linkedin.com/feed/"); calls.push("navigate"); phase = "fresh-feed"; }
  };
  assert.equal(await cleanupLinkedInComposer(browser, "page", "a".repeat(64)), true);
  assert.ok(calls.indexOf("LINKEDIN_MEDIA_REMOVE_VIDEO") < calls.indexOf("LINKEDIN_MEDIA_CLEAR_COMPOSER"));
  assert.ok(calls.indexOf("LINKEDIN_MEDIA_CLEAR_COMPOSER") < calls.indexOf("LINKEDIN_MEDIA_CANCEL_COMPOSER"));
  assert.equal(calls.filter(x => x === "navigate").length, 1);
});
