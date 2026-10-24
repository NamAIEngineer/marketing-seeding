import { createHash } from "node:crypto";
import { isMutationOperation, mutationExpressionHash, normalizeMutationHashRegistry } from "./browser-mutation-policy.mjs";

const SECRET_KEY = /(cookie|password|token|secret|authorization|credential|storage|header|access[_-]?key)/i;
const SECRET_VALUE = /(?:bearer\s+|cookie\s*=|session[_ -]?token|access[_ -]?token)/i;
const MAX_MESSAGE_BYTES = 512_000;
const MAX_TEXT = 32_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const WS_OPEN = 1;
const FORBIDDEN_EXPRESSION = /(?:document\s*\[|window\s*\[|globalThis\s*\[|navigator\s*\[|localStorage|sessionStorage|indexedDB|document\s*\.\s*cookie|(?:^|[^\w])(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval|Function)\s*\(|(?:Object|Reflect)\s*\[|Object\s*\.\s*getOwnPropertyDescriptor|Reflect\s*\.|new\s+Image\s*\(|\.\s*(?:src|href)\s*=|\.\s*value\s*(?!=)|location\s*=|location\s*\.\s*(?:assign|replace|reload)\s*\(|constructor\s*\.\s*constructor|document\s*\.\s*createElement)/i;
const MUTATING_EXPRESSION = /(?:\.\s*(?:click|dispatchEvent|focus|setAttribute|removeAttribute|deleteContents|append|prepend|remove|replaceWith|insertAdjacent(?:Element|HTML|Text))\s*\(|\.\s*(?:value|textContent|innerText|innerHTML|outerHTML)\s*=|(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=|\b(?:InputEvent|MouseEvent)\s*\(|crypto\s*\.\s*subtle\s*\.|document\s*\.\s*createRange\s*\()/i;
const SAFE_GLOBAL_PROPERTIES = Object.freeze({
  document: new Set(["activeElement", "body", "createRange", "documentElement", "elementFromPoint", "querySelector", "querySelectorAll", "title"]),
  location: new Set(["href", "hostname", "pathname", "origin"]),
  window: new Set(["scrollX", "scrollY"]),
  crypto: new Set(["subtle"])
});

const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const expressionText = (value) => {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT) {
    throw fail("GPM_CDP_EXPRESSION_UNSAFE", "GPM CDP expression is not an approved bounded browser operation");
  }
  return value.trim();
};
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });
const hashRef = (value) => `sha256:${createHash("sha256").update(String(value)).digest("hex").slice(0, 32)}`;

function safeErrorMessage(value) {
  const message = text(value, 240).replace(/(?:wss?|https?):\/\/[^\s)]+/gi, "[endpoint]");
  return SECRET_VALUE.test(message) ? "GPM CDP protocol error" : message || "GPM CDP protocol error";
}

function assertSafeRecord(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) throw fail("GPM_CDP_SECRET_VALUE", "CDP response contains secret-like material");
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 128)) assertSafeRecord(child, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value).slice(0, 128)) {
    if (SECRET_KEY.test(key)) throw fail("GPM_CDP_SECRET_FIELD", "CDP response contains a secret-like field");
    assertSafeRecord(child, depth + 1);
  }
}

function sanitize(value, depth = 0) {
  assertSafeRecord(value);
  if (depth > 6 || value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.slice(0, MAX_TEXT);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 128).map((child) => sanitize(child, depth + 1));
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 128)) output[String(key).slice(0, 80)] = sanitize(child, depth + 1);
  return output;
}

function redactText(value) {
  return String(value || "")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(/(?:cookie|authorization|access[_-]?token)\s*[:=]\s*[^\s;]+/gi, "$1=[REDACTED]")
    .slice(0, MAX_TEXT);
}

function endpoint(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { throw fail("GPM_CDP_ENDPOINT_INVALID", "GPM CDP endpoint is invalid"); }
  if (!(["ws:", "wss:"].includes(parsed.protocol)) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw fail("GPM_CDP_ENDPOINT_INVALID", "GPM CDP endpoint must be a credential-free WebSocket URL");
  }
  return parsed.toString();
}

function boundedTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 100 && timeout <= 60_000 ? Math.trunc(timeout) : DEFAULT_TIMEOUT_MS;
}

function socketFactory(factory, url) {
  if (typeof factory !== "function") throw fail("GPM_CDP_WEBSOCKET_UNAVAILABLE", "GPM CDP WebSocket factory is unavailable");
  try {
    if (factory.prototype && typeof factory.prototype.send === "function") return new factory(url);
    return factory(url);
  } catch (error) {
    throw fail("GPM_CDP_CONNECT_FAILED", safeErrorMessage(error?.message));
  }
}

function addListener(socket, event, handler) {
  if (typeof socket?.addEventListener === "function") socket.addEventListener(event, handler);
  else if (typeof socket?.on === "function") socket.on(event, handler);
  else socket[`on${event}`] = handler;
}

function removeListener(socket, event, handler) {
  if (typeof socket?.removeEventListener === "function") socket.removeEventListener(event, handler);
  else if (typeof socket?.off === "function") socket.off(event, handler);
  else if (socket?.[`on${event}`] === handler) socket[`on${event}`] = null;
}

function messageData(value) {
  if (value && typeof value === "object" && "data" in value) return value.data;
  return value;
}

function validUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { throw fail("GPM_CDP_URL_INVALID", "browser URL is invalid"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw fail("GPM_CDP_URL_INVALID", "browser URL is not an allowed public URL");
  return parsed.toString();
}

function safeSelector(value) {
  const selector = text(value, 500);
  if (!selector || selector.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(selector)) throw fail("GPM_CDP_SELECTOR_INVALID", "browser selector is invalid");
  return selector;
}

function assertBoundedExpression(script, { allowMutation = false } = {}) {
  if (!script || script.length > MAX_TEXT || SECRET_KEY.test(script) || SECRET_VALUE.test(script) || FORBIDDEN_EXPRESSION.test(script)) {
    throw fail("GPM_CDP_EXPRESSION_UNSAFE", "GPM CDP expression is not an approved bounded browser operation");
  }
  const selectorMaterial = script.match(/(?:querySelectorAll?|closest)\s*\(([^)]*)\)/gi)?.join(" ") || "";
  if (/(?:token|secret|cookie|authorization|credential|access[_-]?token)/i.test(selectorMaterial)) throw fail("GPM_CDP_EXPRESSION_UNSAFE", "GPM CDP selector targets restricted material");
  if (!allowMutation && MUTATING_EXPRESSION.test(script)) throw fail("GPM_CDP_EXPRESSION_UNSAFE", "GPM CDP mutation requires a bounded browser operation");
  const propertyPattern = /\b(document|location|window|globalThis|navigator|crypto)\s*\.\s*([A-Za-z_$][\w$]*)/g;
  for (const match of script.matchAll(propertyPattern)) {
    const [receiver, property] = [match[1], match[2]];
    if (!SAFE_GLOBAL_PROPERTIES[receiver]?.has(property)) throw fail("GPM_CDP_EXPRESSION_UNSAFE", "GPM CDP global property is not allowed");
  }
  return script;
}

/**
 * Small, injected WebSocket/CDP client for an already-authorized GPM browser.
 * Construction is inert. It never starts a profile, reads browser storage, or
 * sends credential/session material. Provider-specific handles remain private.
 */
export class GpmCdpClient {
  #endpoint; #profileReference; #sessionAuthority; #targetId; #identityObserver; #expressionPolicy; #mutationExpressionHashes; #mutationExpressionAuthorizer; #socketFactory; #timeoutMs;
  #socket = null; #socketHandlers = null; #opened = false; #closed = false; #connectPromise = null; #nextId = 1; #pending = new Map();
  #sessionId = null; #commandCount = 0; #runtimeIdentity;

  constructor({ endpoint: endpointValue, profileReference, sessionAuthority, targetId = null, identityObserver = null, expressionPolicy = null, mutationExpressionHashes = null, mutationExpressionAuthorizer = null, websocketFactory = globalThis.WebSocket, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.#endpoint = endpoint(endpointValue);
    this.#profileReference = text(profileReference, 160);
    this.#sessionAuthority = text(sessionAuthority, 180);
    if (!this.#profileReference) throw fail("GPM_CDP_PROFILE_REQUIRED", "GPM CDP profile reference is required");
    if (!this.#sessionAuthority || SECRET_KEY.test("sessionAuthority") || SECRET_VALUE.test(this.#sessionAuthority)) throw fail("GPM_CDP_AUTHORITY_INVALID", "GPM CDP session authority reference is invalid");
    if (targetId !== null && !text(targetId, 200)) throw fail("GPM_CDP_TARGET_INVALID", "GPM CDP target id is invalid");
    if (identityObserver !== null && typeof identityObserver !== "function") throw fail("GPM_CDP_IDENTITY_OBSERVER_INVALID", "identityObserver must be a function");
    if (expressionPolicy !== null && typeof expressionPolicy !== "function") throw fail("GPM_CDP_EXPRESSION_POLICY_INVALID", "expressionPolicy must be a function");
    if (mutationExpressionAuthorizer !== null && typeof mutationExpressionAuthorizer !== "function") throw fail("GPM_CDP_MUTATION_AUTHORIZER_INVALID", "mutationExpressionAuthorizer must be a function");
    this.#targetId = targetId === null ? null : text(targetId, 200);
    this.#identityObserver = identityObserver;
    this.#expressionPolicy = expressionPolicy;
    this.#mutationExpressionHashes = normalizeMutationHashRegistry(mutationExpressionHashes);
    this.#mutationExpressionAuthorizer = mutationExpressionAuthorizer;
    this.#socketFactory = websocketFactory;
    this.#timeoutMs = boundedTimeout(timeoutMs);
    this.#runtimeIdentity = Object.freeze({ transport: "gpm-cdp", provider: "gpm", providerVersion: null, endpointReference: hashRef(this.#endpoint) });
  }

  runtimeIdentity() { return this.#runtimeIdentity; }
  profileIdentity() { return Object.freeze({ profileReference: hashRef(this.#profileReference), bound: true }); }
  sessionIdentity() { return Object.freeze({ state: this.#opened && !this.#closed ? "ATTACHED" : "DETACHED", authorityReference: hashRef(this.#sessionAuthority) }); }
  browserCommandCount() { return this.#commandCount; }

  async health() {
    if (this.#closed) return { state: "UNAVAILABLE", reason: "GPM_CDP_CLIENT_CLOSED", ...this.#runtimeIdentity };
    if (!this.#endpoint || !this.#profileReference || !this.#sessionAuthority) return { state: "UNAVAILABLE", reason: "GPM_CDP_BINDING_REQUIRED", ...this.#runtimeIdentity };
    if (typeof this.#socketFactory !== "function") return { state: "UNAVAILABLE", reason: "GPM_CDP_WEBSOCKET_UNAVAILABLE", ...this.#runtimeIdentity };
    if (typeof this.#expressionPolicy !== "function") return { state: "UNKNOWN", reason: "GPM_CDP_EXPRESSION_POLICY_REQUIRED", ...this.#runtimeIdentity };
    return { state: this.#opened ? "READY" : "UNKNOWN", reason: this.#opened ? "GPM_CDP_ATTACHED" : "GPM_CDP_NOT_ATTACHED", ...this.#runtimeIdentity };
  }

  async #connect() {
    if (this.#closed) throw fail("GPM_CDP_CLIENT_CLOSED", "GPM CDP client is closed");
    if (this.#opened && this.#socket) return this.#socket;
    if (this.#connectPromise) return this.#connectPromise;
    this.#connectPromise = new Promise((resolve, reject) => {
      let socket;
      try { socket = socketFactory(this.#socketFactory, this.#endpoint); } catch (error) { reject(error); return; }
      this.#socket = socket;
      let settled = false;
      let openTimer;
      const finishOpen = () => { if (settled) return; settled = true; clearTimeout(openTimer); this.#opened = true; resolve(socket); };
      const failOpen = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        this.#opened = false;
        this.#closed = true;
        const connectError = fail("GPM_CDP_CONNECT_FAILED", safeErrorMessage(error?.message || error));
        reject(connectError);
        this.#closeSocket();
      };
      const onOpen = () => finishOpen();
      const onError = (event) => failOpen(event?.error || event);
      const onClose = () => { if (!settled) failOpen(new Error("socket closed")); this.#onClosed(); };
      const onMessage = (event) => this.#onMessage(messageData(event));
      this.#socketHandlers = { onOpen, onError, onClose, onMessage };
      addListener(socket, "open", onOpen); addListener(socket, "error", onError); addListener(socket, "close", onClose); addListener(socket, "message", onMessage);
      if (Number(socket?.readyState) === WS_OPEN) queueMicrotask(finishOpen);
      openTimer = setTimeout(() => failOpen(new Error("socket open timeout")), this.#timeoutMs);
      openTimer.unref?.();
    }).finally(() => { this.#connectPromise = null; });
    return this.#connectPromise;
  }

  #onClosed() {
    this.#opened = false;
    const error = fail("GPM_CDP_DISCONNECTED", "GPM CDP socket disconnected");
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
  }

  #closeSocket() {
    const socket = this.#socket;
    const handlers = this.#socketHandlers;
    this.#socket = null;
    this.#socketHandlers = null;
    if (socket && handlers) {
      for (const [event, handler] of [["open", handlers.onOpen], ["error", handlers.onError], ["close", handlers.onClose], ["message", handlers.onMessage]]) removeListener(socket, event, handler);
    }
    try { socket?.close?.(); } catch { /* bounded cleanup */ }
  }

  #onMessage(raw) {
    let payload;
    try {
      const serialized = typeof raw === "string" ? raw : raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : String(raw || "");
      if (serialized.length > MAX_MESSAGE_BYTES) throw fail("GPM_CDP_MESSAGE_TOO_LARGE", "GPM CDP message is too large");
      payload = JSON.parse(serialized);
      assertSafeRecord(payload);
    } catch (error) {
      const protocolError = error?.code ? error : fail("GPM_CDP_PROTOCOL_INVALID", "GPM CDP message is invalid");
      this.#closed = true;
      this.#opened = false;
      for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(protocolError); }
      this.#pending.clear();
      this.#closeSocket();
      return;
    }
    const pending = this.#pending.get(Number(payload?.id));
    if (!pending) return;
    this.#pending.delete(Number(payload.id)); clearTimeout(pending.timer);
    if (payload.error) pending.reject(fail("GPM_CDP_COMMAND_FAILED", safeErrorMessage(payload.error.message), { providerCode: text(payload.error.code, 80) }));
    else pending.resolve(sanitize(payload.result || {}));
  }

  async #evaluateBounded(pageId, script, { allowMutation = false, operation = "evaluate" } = {}) {
    this.#assertTarget(pageId);
    const mutating = MUTATING_EXPRESSION.test(script);
    // Public evaluate/observe paths are read-only. Mutation is available only
    // through the generated fill/click primitives below, which set
    // allowMutation internally after their selector/value validation. A
    // caller-controlled marker must never promote arbitrary JavaScript into a
    // mutation-capable operation.
    if (mutating && !allowMutation) throw fail("GPM_CDP_EXPRESSION_UNSAFE", "GPM CDP mutation requires a bounded browser operation");
    assertBoundedExpression(script, { allowMutation });
    if (typeof this.#expressionPolicy !== "function") throw fail("GPM_CDP_EXPRESSION_POLICY_REQUIRED", "GPM CDP expression policy is required");
    let decision = false;
    try { decision = this.#expressionPolicy(Object.freeze({ expression: script, pageId, operation })); } catch { decision = false; }
    if (mutating ? !(allowMutation && (decision === true || decision === "ALLOW_MUTATION")) : decision !== true) throw fail("GPM_CDP_EXPRESSION_UNSAFE", "GPM CDP expression was rejected by the host policy");
    const result = await this.#command("Runtime.evaluate", { expression: script, returnByValue: true, awaitPromise: true, userGesture: false }, this.#sessionId);
    if (result.exceptionDetails) throw fail("GPM_CDP_EVALUATION_FAILED", "GPM CDP evaluation failed");
    return sanitize(result.result?.value ?? result.result ?? null);
  }

  async #command(method, params = {}, sessionId = this.#sessionId) {
    const socket = await this.#connect();
    if (!socket || typeof socket.send !== "function") throw fail("GPM_CDP_SOCKET_INVALID", "GPM CDP socket cannot send commands");
    const id = this.#nextId++;
    const payload = { id, method, params: params && typeof params === "object" ? params : {} };
    if (sessionId) payload.sessionId = sessionId;
    const body = JSON.stringify(payload);
    if (body.length > MAX_MESSAGE_BYTES) throw fail("GPM_CDP_MESSAGE_TOO_LARGE", "GPM CDP command is too large");
    this.#commandCount += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(fail("GPM_CDP_TIMEOUT", `GPM CDP command timed out: ${method}`)); }, this.#timeoutMs);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, timer });
      try { socket.send(body); } catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(fail("GPM_CDP_SEND_FAILED", safeErrorMessage(error?.message))); }
    });
  }

  async attach({ targetId = this.#targetId, targetUrl = null } = {}) {
    if (this.#sessionId) {
      if (targetId !== null && text(targetId, 200) !== this.#targetId) throw fail("GPM_CDP_TARGET_MISMATCH", "GPM CDP target does not match attached target");
      if (targetUrl !== null && validUrl(targetUrl) !== (await this.showTab(this.#targetId)).url) throw fail("GPM_CDP_TARGET_URL_MISMATCH", "GPM CDP target URL does not match requested URL");
      return Object.freeze({ ...this.#runtimeIdentity, attached: true, targetReference: hashRef(this.#sessionId) });
    }
    await this.#connect();
    const version = await this.#command("Browser.getVersion", {});
    const targets = await this.#command("Target.getTargets", {});
    if (!Array.isArray(targets.targetInfos)) throw fail("GPM_CDP_TARGET_LIST_INVALID", "GPM CDP target list is invalid");
    const rows = targets.targetInfos;
    const requestedUrl = targetUrl === null ? null : validUrl(targetUrl);
    const candidates = rows.filter((row) => row?.type === "page" && (!requestedUrl || String(row.url || "") === requestedUrl));
    const chosenId = text(targetId, 200) || (candidates.length === 1 ? text(candidates[0].targetId, 200) : "");
    if (!chosenId) throw fail(candidates.length > 1 ? "GPM_CDP_TARGET_AMBIGUOUS" : "GPM_CDP_TARGET_REQUIRED", "GPM CDP requires one exact page target");
    const chosen = rows.find((row) => row?.targetId === chosenId && row?.type === "page");
    if (!chosen) throw fail("GPM_CDP_TARGET_NOT_FOUND", "GPM CDP target was not found");
    if (requestedUrl && String(chosen.url || "") !== requestedUrl) throw fail("GPM_CDP_TARGET_URL_MISMATCH", "GPM CDP target URL does not match requested URL");
    const attached = await this.#command("Target.attachToTarget", { targetId: chosenId, flatten: true }, null);
    if (!text(attached.sessionId, 200)) throw fail("GPM_CDP_ATTACH_FAILED", "GPM CDP attach did not return a session");
    this.#targetId = chosenId; this.#sessionId = text(attached.sessionId, 200);
    this.#runtimeIdentity = Object.freeze({ ...this.#runtimeIdentity, providerVersion: text(version.product || version.revision, 80) || null });
    return Object.freeze({ ...this.#runtimeIdentity, attached: true, targetReference: hashRef(chosenId) });
  }

  async observeIdentity() {
    if (typeof this.#identityObserver !== "function") return { state: "UNKNOWN", reason: "GPM_CDP_IDENTITY_OBSERVER_REQUIRED" };
    try {
      const observed = await this.#identityObserver(this);
      if (!observed || typeof observed !== "object") return { state: "UNKNOWN", reason: "GPM_CDP_IDENTITY_UNKNOWN" };
      assertSafeRecord(observed);
      return sanitize({ ...observed, profileReference: this.#profileReference });
    } catch (error) {
      return { state: "UNKNOWN", reason: text(error?.code || "GPM_CDP_IDENTITY_OBSERVER_FAILED", 80) };
    }
  }

  #assertTarget(targetId) {
    const requested = text(targetId, 200);
    if (!this.#sessionId || !this.#targetId) throw fail("GPM_CDP_NOT_ATTACHED", "GPM CDP target is not attached");
    if (requested && requested !== this.#targetId) throw fail("GPM_CDP_TARGET_MISMATCH", "GPM CDP target does not match attached target");
    return this.#targetId;
  }

  async listTabs() {
    await this.#connect();
    const result = await this.#command("Target.getTargets", {}, null);
    if (!Array.isArray(result.targetInfos)) throw fail("GPM_CDP_TARGET_LIST_INVALID", "GPM CDP target list is invalid");
    return result.targetInfos.filter((row) => row?.type === "page").slice(0, 64).map((row) => ({
      browserPageId: text(row.targetId, 200), pageId: text(row.targetId, 200), profileId: this.#profileReference,
      url: text(row.url, 2_000), title: text(row.title, 240), attached: row.attached === true
    }));
  }

  async showTab(pageId = this.#targetId) {
    const target = this.#assertTarget(pageId);
    const result = await this.#command("Target.getTargetInfo", { targetId: target }, null);
    const info = result.targetInfo || result;
    if (!info || text(info.targetId, 200) !== target || info.type !== "page") throw fail("GPM_CDP_TARGET_INVALID", "GPM CDP target identity is invalid");
    return { browserPageId: target, pageId: target, profileId: this.#profileReference, url: text(info.url, 2_000), title: text(info.title, 240), attached: info.attached === true };
  }

  async navigate(pageId, url) {
    const target = this.#assertTarget(pageId);
    const destination = validUrl(url);
    const result = await this.#command("Page.navigate", { url: destination }, this.#sessionId);
    return { status: "COMMAND_COMPLETED", pageId: target, url: destination, frameId: text(result.frameId, 200) || null };
  }

  async evaluate(pageId, expression) {
    this.#assertTarget(pageId);
    const script = expressionText(expression);
    return this.#evaluateBounded(pageId, script, { operation: "evaluate" });
  }

  async evaluateMutation(pageId, expression, { operation, expressionHash } = {}) {
    this.#assertTarget(pageId);
    const boundedOperation = text(operation, 80);
    if (!isMutationOperation(boundedOperation)) throw fail("GPM_CDP_MUTATION_OPERATION_INVALID", "GPM CDP mutation operation is not allowlisted");
    const script = expressionText(expression);
    const computedExpressionHash = mutationExpressionHash(script);
    if (String(expressionHash || "") !== computedExpressionHash) {
      throw fail("GPM_CDP_MUTATION_EXPRESSION_MISMATCH", "GPM CDP mutation expression hash does not match expression bytes", { operation: boundedOperation, expressionHash: computedExpressionHash });
    }
    let authorized = this.#mutationExpressionHashes.get(boundedOperation)?.has(computedExpressionHash) === true;
    if (!authorized && this.#mutationExpressionAuthorizer) {
      try {
        authorized = (await this.#mutationExpressionAuthorizer(Object.freeze({
          operation: boundedOperation,
          expressionHash: computedExpressionHash,
          expression: script
        }))) === true;
      } catch { authorized = false; }
    }
    if (!authorized) {
      throw fail("GPM_CDP_MUTATION_EXPRESSION_UNAUTHORIZED", "GPM CDP mutation expression is not registered for this operation", { operation: boundedOperation, expressionHash: computedExpressionHash });
    }
    return this.#evaluateBounded(pageId, script, { allowMutation: true, operation: boundedOperation });
  }

  async snapshot(pageId) {
    const value = await this.#evaluateBounded(pageId, "({url:location.href,title:document.title,text:document.body?.innerText||''})", { operation: "snapshot" });
    return redactText(typeof value === "string" ? value : value?.text || "");
  }

  async fill(pageId, selector, value) {
    const target = safeSelector(selector); const textValue = text(value, 20_000);
    const expression = `(()=>{const e=document.querySelector(${JSON.stringify(target)});if(!e)return false;const v=${JSON.stringify(textValue)};if(e.isContentEditable){e.textContent=v;}else{e.value=v;}e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));return true;})()`;
    const result = await this.#evaluateBounded(pageId, expression, { allowMutation: true, operation: "fill" });
    if (result !== true) throw fail("GPM_CDP_CONTROL_NOT_FOUND", "GPM CDP fill target was not found");
    return { status: "COMMAND_COMPLETED", selector: target };
  }

  async type(target, value) {
    const pageId = target?.pageId || this.#targetId;
    const selector = target?.selector || target?.targetRef || target;
    return this.fill(pageId, selector, value);
  }

  async resolve(query = {}) {
    const pageId = query.pageId || this.#targetId;
    const selector = safeSelector(query.selector || query.targetRef || query);
    const expression = `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {selector:${JSON.stringify(selector)},visible:!!(r.width&&r.height),enabled:!e.disabled,boundingBox:{x:r.x,y:r.y,width:r.width,height:r.height}};})()`;
    return this.#evaluateBounded(pageId, expression, { operation: "resolve" });
  }

  findControl(query) { return this.resolve(query); }

  async click(target, { validate } = {}) {
    if (typeof validate !== "function") throw fail("TRANSPORT_VALIDATION_REQUIRED", "GPM CDP click requires pre-provider validation");
    await validate();
    const pageId = target?.pageId || this.#targetId;
    const selector = safeSelector(target?.selector || target?.targetRef);
    const expression = `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true;})()`;
    const result = await this.#evaluateBounded(pageId, expression, { allowMutation: true, operation: "click" });
    if (result !== true) throw fail("GPM_CDP_CONTROL_NOT_FOUND", "GPM CDP click target was not found");
    return { status: "COMMAND_COMPLETED", transport: "gpm-cdp-click", elementRef: selector };
  }

  async waitForUrl(pageId, url, timeoutMs = this.#timeoutMs) {
    const expected = validUrl(url); const deadline = Date.now() + Math.min(60_000, Math.max(100, Number(timeoutMs) || this.#timeoutMs));
    while (Date.now() < deadline) { if ((await this.showTab(pageId)).url === expected) return { state: "READY", url: expected }; await new Promise((resolve) => setTimeout(resolve, 50)); }
    throw fail("GPM_CDP_TIMEOUT", "GPM CDP URL wait timed out");
  }

  async waitForFeed(pageId) { return this.waitForUrl(pageId, "https://www.linkedin.com/feed/"); }
  async waitForExpression(pageId, expression, timeoutMs = this.#timeoutMs) {
    const deadline = Date.now() + Math.min(60_000, Math.max(100, Number(timeoutMs) || this.#timeoutMs));
    while (Date.now() < deadline) { if (await this.evaluate(pageId, expression)) return { state: "READY" }; await new Promise((resolve) => setTimeout(resolve, 50)); }
    throw fail("GPM_CDP_TIMEOUT", "GPM CDP expression wait timed out");
  }

  async observeTransition(pageId, expression) { return this.evaluate(pageId, expression); }
  async verifyActivation(pageId, expression) { return this.evaluate(pageId, expression); }
  async screenshot() { throw fail("GPM_CDP_CAPABILITY_UNSUPPORTED", "GPM CDP screenshot is not enabled in this seam"); }
  async upload() { throw fail("GPM_CDP_CAPABILITY_UNSUPPORTED", "GPM CDP upload is not enabled in this seam"); }
  async uploadSelector() { throw fail("GPM_CDP_CAPABILITY_UNSUPPORTED", "GPM CDP upload is not enabled in this seam"); }

  async detach() {
    if (this.#closed) return Object.freeze({ detached: true, status: "ALREADY_DETACHED" });
    const sessionId = this.#sessionId;
    if (sessionId && this.#opened) { try { await this.#command("Target.detachFromTarget", { sessionId }, null); } catch { /* close remains authoritative */ } }
    this.#sessionId = null; this.#closed = true;
    this.#onClosed();
    this.#closeSocket();
    return Object.freeze({ detached: true, status: "DETACHED" });
  }

  closeOwnedResources() { return this.detach(); }
}

/**
 * Build a protocol factory for a host that has already selected one exact
 * endpoint/profile/session binding.  The mutation registry is deliberately a
 * required factory input: a mutation-capable host must bind exact expression
 * hashes before a client can be used for LinkedIn DOM mutations.
 *
 * The returned factory is inert.  It creates a client only when the injected
 * execution transport acquires a session.  No endpoint probing, profile
 * lifecycle call, credential read, or browser command happens here.
 */
export function createGpmCdpClientFactory({
  endpoint,
  targetId = null,
  identityObserver = null,
  expressionPolicy,
  mutationExpressionHashes,
  mutationExpressionAuthorizer = null,
  websocketFactory = globalThis.WebSocket,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof endpoint !== "string" && typeof endpoint !== "function") throw fail("GPM_CDP_FACTORY_ENDPOINT_REQUIRED", "GPM CDP factory endpoint is required");
  if (typeof expressionPolicy !== "function") throw fail("GPM_CDP_FACTORY_EXPRESSION_POLICY_REQUIRED", "GPM CDP factory expression policy is required");
  const registry = normalizeMutationHashRegistry(mutationExpressionHashes);
  if (!registry.size && typeof mutationExpressionAuthorizer !== "function") throw fail("GPM_CDP_FACTORY_MUTATION_REGISTRY_REQUIRED", "GPM CDP factory mutation hash registry or authorizer is required");
  return async ({ profileReference, sessionAuthority, sessionHandle, targetId: requestTargetId = null } = {}) => {
    const selectedEndpoint = typeof endpoint === "function"
      ? await endpoint({ profileReference, sessionAuthority, sessionHandle })
      : endpoint;
    return new GpmCdpClient({
      endpoint: selectedEndpoint,
      profileReference,
      // The authority is a bounded host reference.  Session handles remain
      // opaque and are never copied into browser protocol payloads.
      sessionAuthority: sessionAuthority || sessionHandle,
      targetId: requestTargetId || targetId,
      identityObserver,
      expressionPolicy,
      mutationExpressionHashes: registry,
      mutationExpressionAuthorizer,
      websocketFactory,
      timeoutMs
    });
  };
}

export default GpmCdpClient;
