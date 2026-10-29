import { createHash } from "node:crypto";
import { mutationExpressionHash, normalizeMutationHash, isMutationOperation } from "./browser-mutation-policy.mjs";
import { linkedInReadinessExpressions } from "./linkedin-readiness.mjs";
import { canonicalIdentityUrl } from "./execution-binding.mjs";

const text = (value, limit = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
// Keep readiness expressions such as `sessionAuthenticated` usable while
// rejecting actual credential/session material. This filter runs before page
// evaluation; mutation expressions use the separate hash/operation gate.
const secretPattern = /(?:\b(?:password|passwd|cookie|token|secret|credential|authorization|private[_-]?key|access[_-]?key)\b|\b(?:access|refresh|id|auth|csrf|bearer)Token\b|\bsession(?:Token|Cookie|Storage|Secret|Handle|Material|Data)\b|\b(?:localStorage|sessionStorage)\b|\bdocument\.cookie\b|\b(?:document|window|globalThis|self)\s*\[)/i;
const readOnlySideEffectPattern = new RegExp([
  String.raw`\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval|setTimeout|setInterval|queueMicrotask|import)\s*(?:\?\.\s*)?\(`,
  String.raw`\bFunction\s*(?:\?\.\s*)?\(`,
  String.raw`\b(?:globalThis|window|self)\s*(?:\?\.\s*|\.\s*)(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval|Function)\b`,
  String.raw`\b(?:Reflect|Object)\s*\.\s*(?:get|set|defineProperty|defineProperties|assign)\s*\(`,
  String.raw`\bconstructor\s*(?:\.|\()` ,
  String.raw`\.(?:click|submit|dispatchEvent|setAttribute|removeAttribute|toggleAttribute|appendChild|prepend|insertBefore|replaceChild|replaceWith|removeChild|remove|insertAdjacent(?:Element|HTML|Text)|focus|blur|select|setRangeText|scrollIntoView|requestFullscreen)\s*(?:\?\.\s*)?\(`,
  String.raw`\b(?:location|window\s*\.\s*location)\s*=\s*(?!=|>)`,
  String.raw`\b(?:location|window\s*\.\s*location)\s*\.\s*(?:assign|replace|reload)\s*(?:\?\.\s*)?\(`,
  String.raw`\b(?:location|window\s*\.\s*location|history)\s*\[\s*['"](?:assign|replace|reload|pushState|replaceState|back|forward|go)['"]\s*\]\s*(?:\?\.\s*)?\(`,
  String.raw`\bhistory\s*\.\s*(?:pushState|replaceState|back|forward|go)\s*(?:\?\.\s*)?\(`,
  String.raw`\b(?:document|window|globalThis|self|navigator)\s*\.\s*(?:write|open|execCommand|sendBeacon)\s*(?:\?\.\s*)?\(`,
  String.raw`(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*(?:=|\+=|-=|\*=|\/=|%=|\|\|=|&&=|\?\?=)(?!=|>)`,
  String.raw`(?:^|[;{},(,\n])\s*(?!(?:const|let|var)\b)[A-Za-z_$][\w$]*\s*(?:=|\+=|-=|\*=|\/=|%=|\|\|=|&&=|\?\?=)(?!=|>)`,
  String.raw`\+\+|--`
].join("|"), "i");

// Remove literals/comments before the side-effect scan so a visible label or
// regex payload cannot turn a read-only observation into a false rejection.
// This is deliberately conservative lexical hardening, not an AST proof.
function stripJavascriptLiterals(source) {
  const value = String(source);

  // Preserve JavaScript inside `${ ... }` while blanking template text. The
  // previous scanner treated a whole template literal as an opaque quote,
  // which let a side effect hidden in an interpolation reach page.evaluate.
  function scanCode(start, stopAtBrace = false) {
    let output = "";
    let index = start;
    while (index < value.length) {
      const character = value[index];
      const next = value[index + 1];
      if (stopAtBrace && character === "}") return { output, index: index + 1 };
      if (character === "/" && next === "/") {
        output += "  "; index += 2;
        while (index < value.length && value[index] !== "\n") { output += " "; index += 1; }
        continue;
      }
      if (character === "/" && next === "*") {
        output += "  "; index += 2;
        while (index < value.length) {
          if (value[index] === "*" && value[index + 1] === "/") { output += "  "; index += 2; break; }
          output += value[index] === "\n" ? "\n" : " "; index += 1;
        }
        continue;
      }
      if (character === "'" || character === '"') {
        const quote = character;
        output += " "; index += 1;
        let escaped = false;
        while (index < value.length) {
          const literal = value[index];
          output += literal === "\n" ? "\n" : " "; index += 1;
          if (escaped) escaped = false;
          else if (literal === "\\") escaped = true;
          else if (literal === quote) break;
        }
        continue;
      }
      if (character === "`") {
        const template = scanTemplate(index + 1);
        output += template.output;
        index = template.index;
        continue;
      }
      output += character;
      index += 1;
    }
    return { output, index };
  }

  function scanTemplate(start) {
    let output = " ";
    let index = start;
    let escaped = false;
    while (index < value.length) {
      const character = value[index];
      if (escaped) { output += character === "\n" ? "\n" : " "; escaped = false; index += 1; continue; }
      if (character === "\\") { output += " "; escaped = true; index += 1; continue; }
      if (character === "`") { output += " "; return { output, index: index + 1 }; }
      if (character === "$" && value[index + 1] === "{") {
        const expression = scanCode(index + 2, true);
        output += "${" + expression.output;
        index = expression.index;
        continue;
      }
      output += character === "\n" ? "\n" : " "; index += 1;
    }
    return { output, index };
  }

  return scanCode(0).output;
}

function assertSafeExpression(source) {
  const script = String(source || "");
  const scan = stripJavascriptLiterals(script);
  if (!script || secretPattern.test(script) || readOnlySideEffectPattern.test(scan)) {
    throw Object.assign(new Error("Camoufox expression rejected"), { code: "CAMOUFOX_EXPRESSION_REJECTED" });
  }
  return script;
}

function safePageId(value) { return /^[A-Za-z0-9._:-]{1,120}$/.test(String(value || "")) ? String(value) : null; }
function safeUrl(value) { try { const url = new URL(String(value)); return /^https?:$/.test(url.protocol) || url.protocol === "about:" ? url.toString() : null; } catch { return null; } }

// Read the identity from the rendered LinkedIn surface itself. This expression
// intentionally does not receive the expected profile path: the caller must
// compare the observed result with the bound identity after evaluation. A nav
// or header profile link is preferred over arbitrary member links in the feed;
// ties are reported as ambiguous and fail closed in observeIdentity().
const LINKEDIN_IDENTITY_EXPRESSION = `(() => {
  const visible = (node) => Boolean(node && node.getClientRects().length);
  const normalize = (value) => {
    try {
      const url = new URL(value, location.href);
      const host = url.hostname.toLowerCase().replace(/^www\\./, '');
      const path = url.pathname.replace(/\\/$/, '') || '/';
      if (host !== 'linkedin.com' || !/^\\/in\\/[^/]+$/i.test(path)) return null;
      return url.origin.toLowerCase() + path;
    } catch { return null; }
  };
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const candidates = anchors.map((anchor, sourceIndex) => {
    if (!visible(anchor)) return null;
    const reference = normalize(anchor.href);
    if (!reference) return null;
    const label = [anchor.getAttribute('aria-label') || '', anchor.getAttribute('title') || '', anchor.innerText || '']
      .join(' ').replace(/\\s+/g, ' ').trim().slice(0, 160);
    const ownerSurface = Boolean(anchor.closest('nav,[role="navigation"],header'));
    const ownerModule = Boolean(anchor.closest('[id*="feedIdentityModuleComponentRef"],[id*="shareboxProfilePictureComponentRef"]'));
    const ownerLabel = /\\b(?:me|profile|tôi|hồ sơ)\\b/i.test(label);
    const score = (ownerModule ? 160 : 0) + (ownerSurface ? 100 : 0) + (ownerLabel ? 40 : 0);
    return { reference, score, sourceIndex, ownerSurface, ownerModule, ownerLabel };
  }).filter(Boolean);
  const ranked = candidates.sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex);
  const top = ranked[0] || null;
  const topReferences = top ? ranked.filter((item) => item.score === top.score).map((item) => item.reference).filter((item, index, all) => all.indexOf(item) === index) : [];
  const stableId = top?.reference ? top.reference.split('/in/')[1] || null : null;
  return {
    identityReference: topReferences.length === 1 ? top.reference : null,
    stableId: topReferences.length === 1 ? stableId : null,
    ambiguous: topReferences.length > 1,
    confidence: top?.score || 0,
    source: top?.ownerModule ? 'linkedin-owner-profile-module' : top?.ownerSurface ? 'linkedin-navigation-surface' : top ? 'linkedin-rendered-profile-link' : null,
    candidates: ranked.slice(0, 8).map(({ reference, score, ownerSurface, ownerModule, ownerLabel }) => ({ reference, score, ownerSurface, ownerModule, ownerLabel }))
  };
})()`;

/** Playwright Firefox Juggler client for an already acquired persistent Camoufox context. */
export class CamoufoxPlaywrightProtocolClient {
  #context; #profileReference; #expectedIdentity; #runtimeIdentity; #pages = new Map(); #refs = new Map(); #mutations; #detached = false; #pageSequence = 0;
  constructor({ context, profileReference, expectedIdentity, runtimeIdentity, mutationExpressionHashes = null } = {}) {
    if (!context || typeof context.pages !== "function") throw new Error("Camoufox Playwright context is required");
    this.#context = context; this.#profileReference = text(profileReference, 180);
    this.#expectedIdentity = Object.freeze({ ...(expectedIdentity || {}) }); this.#runtimeIdentity = Object.freeze({ ...(runtimeIdentity || {}) });
    this.#mutations = new Map();
    const source = mutationExpressionHashes instanceof Map ? mutationExpressionHashes : mutationExpressionHashes && typeof mutationExpressionHashes === "object" ? mutationExpressionHashes : {};
    for (const [operation, hashes] of Object.entries(source)) {
      if (!isMutationOperation(operation)) continue;
      const values = hashes instanceof Set ? [...hashes] : Array.isArray(hashes) ? hashes : [hashes];
      this.#mutations.set(operation, new Set(values.map(normalizeMutationHash).filter(Boolean)));
    }
  }
  #assertAttached() { if (this.#detached) throw Object.assign(new Error("Camoufox protocol client detached"), { code: "CAMOUFOX_PROTOCOL_DETACHED" }); }
  #page(pageId) { this.#assertAttached(); const page = this.#pages.get(safePageId(pageId)); if (!page) throw Object.assign(new Error("Camoufox page is unavailable"), { code: "CAMOUFOX_PAGE_NOT_FOUND" }); return page; }
  #register(page) { let id = [...this.#pages.entries()].find(([, current]) => current === page)?.[0]; if (!id) { this.#pageSequence += 1; id = `page-${this.#pageSequence}-${createHash("sha256").update(String(page.url?.() || "about:blank")).digest("hex").slice(0, 12)}`; this.#pages.set(id, page); } return id; }
  async attach() { this.#assertAttached(); for (const page of this.#context.pages()) this.#register(page); if (!this.#context.pages().length) this.#register(await this.#context.newPage()); return { attached: true }; }
  async observeIdentity() {
    this.#assertAttached();
    const page = this.#context.pages()[0] || await this.#context.newPage(); this.#register(page);
    if (!/^https?:/i.test(page.url()) || !/linkedin\.com$/i.test(new URL(page.url()).hostname)) await page.goto("https://www.linkedin.com/feed/", { waitUntil: "commit", timeout: 30_000 }).catch(() => undefined);
    const expectedPath = text(this.#expectedIdentity.identityReference || this.#expectedIdentity.expectedIdentityUrl, 400);
    let state = { loginRequired: false, securityChallenge: false, sessionAuthenticated: false, identityVerified: false };
    let observed = null;
    try {
      const identityUrl = expectedPath ? new URL(expectedPath) : null;
      state = await page.evaluate(linkedInReadinessExpressions().context(identityUrl?.pathname || "/"));
      if (state.sessionAuthenticated && !state.securityChallenge) observed = await page.evaluate(LINKEDIN_IDENTITY_EXPRESSION);
    } catch { state = { loginRequired: true, sessionAuthenticated: false, identityVerified: false }; }
    const expectedIdentity = canonicalIdentityUrl(this.#expectedIdentity.identityReference || this.#expectedIdentity.expectedIdentityUrl);
    const observedIdentity = canonicalIdentityUrl(observed?.identityReference);
    const expectedStableId = expectedIdentity ? expectedIdentity.split('/in/')[1] || null : null;
    // During credential onboarding there is no caller supplied identity. A
    // rendered profile link is accepted only when it came from a bounded
    // owner surface (navigation/header or LinkedIn's owner profile module),
    // has a stable /in/<id> value, and is unambiguous. Feed text or an
    // arbitrary member link cannot establish account identity.
    const ownerSurfaceEvidence = ["linkedin-owner-profile-module", "linkedin-navigation-surface"].includes(observed?.source);
    const independentIdentityVerified = expectedIdentity
      ? Boolean(observedIdentity && !observed?.ambiguous && observedIdentity === expectedIdentity && observed?.stableId && observed.stableId === expectedStableId)
      : Boolean(observedIdentity && !observed?.ambiguous && observed?.stableId && ownerSurfaceEvidence);
    const sessionState = state.securityChallenge ? "CHALLENGED" : state.loginRequired ? "LOGIN_REQUIRED" : state.sessionAuthenticated && independentIdentityVerified ? "READY" : "UNKNOWN";
    return { state: sessionState, provider: "camoufox", platform: text(this.#expectedIdentity.platform).toLowerCase(), accountId: text(this.#expectedIdentity.accountId), providerProfileId: this.#profileReference, profileReference: this.#profileReference, identityReference: observedIdentity || null, expectedIdentityReference: expectedIdentity || null, stableIdentityId: observed?.stableId || null, evidence: { sessionAuthenticated: state.sessionAuthenticated === true, identityVerified: independentIdentityVerified, stableIdentityId: observed?.stableId || null, stableIdentityIdVerified: Boolean(observed?.stableId && observed.stableId === expectedStableId), feedReachable: state.feedReachable === true, identitySource: observed?.source || null, identityConfidence: observed?.confidence || 0, identityAmbiguous: observed?.ambiguous === true, candidateCount: Array.isArray(observed?.candidates) ? observed.candidates.length : 0 } };
  }
  async listTabs() { this.#assertAttached(); return this.#context.pages().map((page) => { const id = this.#register(page); return { id, pageId: id, browserPageId: id, profileId: this.#profileReference, url: page.url() }; }); }
  async showTab(pageId) { const page = this.#page(pageId); return { pageId, browserPageId: pageId, id: pageId, profileId: this.#profileReference, url: page.url() }; }
  async createTab() { this.#assertAttached(); return this.#register(await this.#context.newPage()); }
  async navigate(pageId, url) { const target = safeUrl(url); if (!target) throw Object.assign(new Error("Camoufox navigation URL is invalid"), { code: "CAMOUFOX_URL_INVALID" }); await this.#page(pageId).goto(target, { waitUntil: "commit", timeout: 30_000 }); return { url: this.#page(pageId).url() }; }
  async waitForUrl(pageId, url, timeoutMs = 10_000) { const target = safeUrl(url); await this.#page(pageId).waitForURL((value) => value.origin === new URL(target).origin && value.pathname.replace(/\/$/, "") === new URL(target).pathname.replace(/\/$/, ""), { timeout: timeoutMs }); return { url: this.#page(pageId).url() }; }
  async waitForFeed(pageId, timeoutMs = 15_000) {
    const page = this.#page(pageId);
    await page.waitForURL((value) => value.hostname.toLowerCase().replace(/^www\./, '') === 'linkedin.com' && /^\/feed(?:\/|$)/i.test(value.pathname), { timeout: timeoutMs });
    return { url: page.url() };
  }
  async waitForExpression(pageId, expression, timeoutMs = 8_000) { const page = this.#page(pageId); const script = assertSafeExpression(expression); await page.waitForFunction((source) => { try { return Boolean((0, eval)(source)); } catch { return false; } }, script, { timeout: timeoutMs }); return true; }
  async evaluate(pageId, expression) { return this.#page(pageId).evaluate(assertSafeExpression(expression)); }
  async evaluateMutation(pageId, expression, { operation, expressionHash } = {}) {
    const script = String(expression || ""); const computed = mutationExpressionHash(script); const allowed = this.#mutations.get(String(operation || ""));
    if (!allowed || !allowed.has(computed) || normalizeMutationHash(expressionHash) !== computed) throw Object.assign(new Error("Camoufox mutation expression is not authorized"), { code: "CAMOUFOX_MUTATION_UNAUTHORIZED", operation: String(operation || ""), expressionHash: computed });
    return this.#page(pageId).evaluate(script);
  }
  async snapshot(pageId) {
    const page = this.#page(pageId);
    const selector = "button,[role=\"button\"],[contenteditable=\"true\"],[role=\"textbox\"],input[type=\"file\"]";
    const elements = await page.locator(selector).evaluateAll((nodes) => nodes.map((node, sourceIndex) => ({ node, sourceIndex }))
      .filter(({ node }) => node.getClientRects().length).slice(0, 120)
      .map(({ node, sourceIndex }, index) => ({ sourceIndex, index, tag: node.tagName.toLowerCase(), role: node.getAttribute('role') || (node.tagName.toLowerCase() === 'button' ? 'button' : node.getAttribute('contenteditable') === 'true' ? 'textbox' : 'input'), name: (node.getAttribute('aria-label') || node.innerText || node.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 120) })));
    this.#refs.set(pageId, elements.map((element) => { const ref = `cf-${element.index}`; return [ref, element]; }));
    return elements.map((element) => `- ${element.role} "${element.name.replaceAll('"', '\\"')}" [ref=cf-${element.index}]`).join("\n");
  }
  #locator(pageId, ref) { const match = String(ref || "").match(/^cf-(\d+)$/); if (!match) throw Object.assign(new Error("Camoufox element reference is invalid"), { code: "CAMOUFOX_ELEMENT_REF_INVALID" }); const entry = this.#refs.get(pageId)?.find(([key]) => key === String(ref)); if (!entry) throw Object.assign(new Error("Camoufox element reference is stale"), { code: "CAMOUFOX_ELEMENT_REF_STALE" }); return this.#page(pageId).locator("button,[role=\"button\"],[contenteditable=\"true\"],[role=\"textbox\"],input[type=\"file\"]").nth(Number(entry[1].sourceIndex)); }
  async resolve(pageId, query) { const snapshot = await this.snapshot(pageId); const pattern = query instanceof RegExp ? query : new RegExp(String(query || ""), "i"); const line = snapshot.split("\n").find((value) => pattern.test(value)); return line?.match(/ref=([^\]]+)/)?.[1] || null; }
  async type(pageId, ref, value) { return this.fill(pageId, ref, value); }
  async fill(pageId, ref, value) { await this.#locator(pageId, ref).fill(String(value)); return { filled: true }; }
  async upload(pageId, ref, filePath) { await this.#locator(pageId, ref).setInputFiles(filePath); return { uploaded: true }; }
  async uploadSelector(pageId, selector, filePath) { await this.#page(pageId).locator(String(selector)).setInputFiles(filePath); return { uploaded: true }; }
  async click(target, options = {}) { const pageId = target?.pageId || target?.browserPageId || target; const ref = target?.targetRef || target?.ref || target; const result = await this.#locator(pageId, ref).click({ timeout: 15_000 }); return { status: "COMMAND_COMPLETED", providerResult: { clicked: String(ref) }, result }; }
  async observeTransition(pageId, options = {}) { return { state: await this.evaluate(pageId, options.expression || "location.href") }; }
  async verifyActivation(pageId, options = {}) { return this.evaluate(pageId, options.expression || "true"); }
  async browserCommandCount() { return 0; }
  async detach() { this.#detached = true; this.#pages.clear(); this.#refs.clear(); return { detached: true }; }
}
export default CamoufoxPlaywrightProtocolClient;
