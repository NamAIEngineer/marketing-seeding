import test from "node:test";
import assert from "node:assert/strict";
import { GpmCdpClient, createGpmCdpClientFactory } from "../src/gpm-cdp-client.mjs";
import { mutationExpressionHash } from "../src/browser-mutation-policy.mjs";

class FakeSocket {
  constructor(responder = () => {}) {
    this.readyState = 1;
    this.sent = [];
    this.listeners = new Map();
    this.responder = responder;
    this.closed = false;
  }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); }
  send(body) {
    this.sent.push(JSON.parse(body));
    this.responder(this, this.sent.at(-1));
  }
  emit(name, value) { this.listeners.get(name)?.(value); }
  close() { this.closed = true; this.readyState = 3; this.emit("close", {}); }
}

function socketFactoryFor({ targets = [{ targetId: "target-1", type: "page", url: "https://www.linkedin.com/feed/", title: "Feed" }], noResponse = false } = {}) {
  const sockets = [];
  const factory = (url) => {
    const socket = new FakeSocket((current, request) => {
      if (noResponse) return;
      const result = request.method === "Browser.getVersion" ? { product: "Chrome/156.0.1" }
        : request.method === "Target.getTargets" ? { targetInfos: targets }
          : request.method === "Target.attachToTarget" ? { sessionId: "session-1" }
            : request.method === "Target.getTargetInfo" ? { targetInfo: { targetId: "target-1", type: "page", url: "https://www.linkedin.com/feed/", title: "Feed", attached: true } }
              : request.method === "Target.detachFromTarget" ? {}
                : request.method === "Page.navigate" ? { frameId: "frame-1" }
                  : request.method === "Runtime.evaluate" ? { result: { type: "boolean", value: true } } : {};
      queueMicrotask(() => current.emit("message", { data: JSON.stringify({ id: request.id, result }) }));
    });
    sockets.push({ socket, url });
    return socket;
  };
  factory.sockets = sockets;
  return factory;
}

const base = { endpoint: "ws://127.0.0.1:19495/devtools/browser/fixture", profileReference: "profile-a", sessionAuthority: "authority-a", expressionPolicy: () => true };

test("GPM CDP construction is inert, bounded and rejects endpoint/authority secrets", () => {
  let calls = 0;
  const client = new GpmCdpClient({ ...base, websocketFactory: () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(client.runtimeIdentity().provider, "gpm");
  assert.equal(JSON.stringify(client).includes("profile-a"), false);
  assert.throws(() => new GpmCdpClient({ ...base, endpoint: "http://127.0.0.1:1" }), { code: "GPM_CDP_ENDPOINT_INVALID" });
  assert.throws(() => new GpmCdpClient({ ...base, sessionAuthority: "Bearer abc" }), { code: "GPM_CDP_AUTHORITY_INVALID" });
});

test("GPM CDP attaches one exact page and exposes bounded browser operations", async () => {
  const factory = socketFactoryFor();
  const client = new GpmCdpClient({ ...base, websocketFactory: factory, targetId: "target-1" });
  assert.equal((await client.health()).state, "UNKNOWN");
  const attached = await client.attach();
  assert.equal(attached.attached, true);
  assert.equal(client.profileIdentity().bound, true);
  assert.equal((await client.listTabs())[0].profileId, "profile-a");
  assert.equal((await client.showTab("target-1")).url, "https://www.linkedin.com/feed/");
  assert.equal((await client.navigate("target-1", "https://www.linkedin.com/feed/")).status, "COMMAND_COMPLETED");
  assert.equal(await client.evaluate("target-1", "true"), true);
  assert.equal((await client.fill("target-1", "textarea", "hello")).status, "COMMAND_COMPLETED");
  assert.equal((await client.click({ pageId: "target-1", selector: "button" }, { validate: async () => ({ safe: true }) })).status, "COMMAND_COMPLETED");
  assert.equal(client.browserCommandCount() > 5, true);
  await client.detach();
  assert.equal((await client.detach()).status, "ALREADY_DETACHED");
  assert.equal(factory.sockets[0].socket.closed, true);
});

test("GPM CDP snapshot returns accessibility refs that resolve back to bounded DOM selectors", async () => {
  const factory = socketFactoryFor();
  const original = factory;
  const wrapped = (url) => {
    const socket = original(url);
    const send = socket.send.bind(socket);
    socket.send = (body) => {
      const request = JSON.parse(body);
      if (request.method === "Runtime.evaluate" && request.params?.expression?.includes("const controls")) {
        queueMicrotask(() => socket.emit("message", { data: JSON.stringify({ id: request.id, result: { result: { type: "object", value: { url: "https://www.linkedin.com/feed/", title: "Feed", text: "", controls: [{ ref: "gpm-0", selector: "main>div:nth-of-type(1)", line: '- textbox "Post editor" [ref=gpm-0]' }] } } } }) }));
        return;
      }
      send(body);
    };
    return socket;
  };
  const client = new GpmCdpClient({ ...base, websocketFactory: wrapped, targetId: "target-1" });
  await client.attach();
  assert.equal(await client.snapshot("target-1"), '- textbox "Post editor" [ref=gpm-0]');
  assert.equal((await client.fill("target-1", "gpm-0", "hello")).status, "COMMAND_COMPLETED");
  await client.detach();
});

test("GPM CDP fails closed for ambiguous targets, mismatches, restricted expressions and unsupported media", async () => {
  const factory = socketFactoryFor({ targets: [{ targetId: "a", type: "page", url: "https://a.test" }, { targetId: "b", type: "page", url: "https://b.test" }] });
  const client = new GpmCdpClient({ ...base, websocketFactory: factory });
  await assert.rejects(() => client.attach(), { code: "GPM_CDP_TARGET_AMBIGUOUS" });
  await client.detach();
  const next = new GpmCdpClient({ ...base, websocketFactory: socketFactoryFor(), targetId: "target-1" });
  await next.attach();
  await assert.rejects(() => next.showTab("other"), { code: "GPM_CDP_TARGET_MISMATCH" });
  await assert.rejects(() => next.evaluate("target-1", "document.cookie"), { code: "GPM_CDP_EXPRESSION_UNSAFE" });
  await assert.rejects(() => next.evaluate("target-1", "globalThis['fetch']('https://example.test')"), { code: "GPM_CDP_EXPRESSION_UNSAFE" });
  await assert.rejects(() => next.evaluate("target-1", "document.body.innerHTML='changed'"), { code: "GPM_CDP_EXPRESSION_UNSAFE" });
  await assert.rejects(() => next.screenshot(), { code: "GPM_CDP_CAPABILITY_UNSUPPORTED" });
  await next.detach();
});

test("GPM CDP enforces exact target URL and malformed target responses fail closed", async () => {
  const factory = socketFactoryFor();
  const client = new GpmCdpClient({ ...base, websocketFactory: factory, targetId: "target-1" });
  await assert.rejects(() => client.attach({ targetUrl: "https://www.linkedin.com/in/other" }), { code: "GPM_CDP_TARGET_URL_MISMATCH" });
  await client.detach();
  const malformed = socketFactoryFor();
  const original = malformed;
  const bad = (url) => {
    const socket = original(url);
    const send = socket.send.bind(socket);
    socket.send = (body) => {
      const request = JSON.parse(body);
      if (request.method === "Target.getTargets") {
        socket.responder = (current, req) => queueMicrotask(() => current.emit("message", { data: JSON.stringify({ id: req.id, result: { targetInfos: "invalid" } }) }));
      }
      send(body);
    };
    return socket;
  };
  const malformedClient = new GpmCdpClient({ ...base, websocketFactory: bad, targetId: "target-1" });
  await assert.rejects(() => malformedClient.attach(), { code: "GPM_CDP_TARGET_LIST_INVALID" });
  await malformedClient.detach();
});

test("GPM CDP timeout and disconnect fail closed without retry", async () => {
  const timeout = new GpmCdpClient({ ...base, websocketFactory: socketFactoryFor({ noResponse: true }), timeoutMs: 100 });
  await assert.rejects(() => timeout.attach(), { code: "GPM_CDP_TIMEOUT" });
  await timeout.detach();
  let socket;
  const factory = () => { socket = new FakeSocket(() => {}); socket.readyState = 0; return socket; };
  const disconnected = new GpmCdpClient({ ...base, websocketFactory: factory });
  const pending = disconnected.attach();
  queueMicrotask(() => socket.emit("close", {}));
  await assert.rejects(() => pending, { code: "GPM_CDP_CONNECT_FAILED" });
  await disconnected.detach();
});

test("GPM CDP applies host expression policy to generated browser operations", async () => {
  const factory = socketFactoryFor();
  const client = new GpmCdpClient({ ...base, websocketFactory: factory, targetId: "target-1", expressionPolicy: ({ expression }) => !expression.includes("querySelector") });
  await client.attach();
  await assert.rejects(() => client.fill("target-1", "textarea", "hello"), { code: "GPM_CDP_EXPRESSION_UNSAFE" });
  await client.detach();
});

test("GPM CDP never promotes a caller marker into mutation authority", async () => {
  const factory = socketFactoryFor();
  const client = new GpmCdpClient({
    ...base,
    websocketFactory: factory,
    targetId: "target-1",
    expressionPolicy: ({ expression }) => expression.includes("SYSTEM_AGENTIC_BOUNDED_MUTATION") ? "ALLOW_MUTATION" : true
  });
  await client.attach();
  await assert.rejects(
    () => client.evaluate("target-1", "(() => { /* SYSTEM_AGENTIC_BOUNDED_MUTATION */ document.querySelector('button').click(); return true; })()"),
    { code: "GPM_CDP_EXPRESSION_UNSAFE" }
  );
  await client.detach();
});

test("GPM CDP exposes only named bounded mutation operations", async () => {
  const factory = socketFactoryFor();
  const expression = "(() => { document.querySelector('button').click(); return true; })()";
  const operations = [];
  const client = new GpmCdpClient({
    ...base,
    websocketFactory: factory,
    targetId: "target-1",
    expressionPolicy: ({ operation }) => { operations.push(operation); return true; },
    mutationExpressionHashes: { LINKEDIN_COMPOSER_TRIGGER: [mutationExpressionHash(expression)] }
  });
  await client.attach();
  assert.equal(await client.evaluateMutation("target-1", expression, { operation: "LINKEDIN_COMPOSER_TRIGGER", expressionHash: mutationExpressionHash(expression) }), true);
  await assert.rejects(() => client.evaluateMutation("target-1", expression, { operation: "ARBITRARY_SCRIPT", expressionHash: mutationExpressionHash(expression) }), { code: "GPM_CDP_MUTATION_OPERATION_INVALID" });
  await assert.rejects(() => client.evaluateMutation("target-1", "(() => { document.querySelector('other').click(); return true; })()", { operation: "LINKEDIN_COMPOSER_TRIGGER", expressionHash: mutationExpressionHash(expression) }), { code: "GPM_CDP_MUTATION_EXPRESSION_MISMATCH" });
  await assert.rejects(() => client.evaluateMutation("target-1", "(() => { document.body.innerHTML = 'owned'; return true; })()", { operation: "LINKEDIN_COMPOSER_TRIGGER", expressionHash: mutationExpressionHash("(() => { document.body.innerHTML = 'owned'; return true; })()") }), { code: "GPM_CDP_MUTATION_EXPRESSION_UNAUTHORIZED" });
  assert.equal(operations.at(-1), "LINKEDIN_COMPOSER_TRIGGER");
  await client.detach();
});

test("GPM CDP requires the caller to bind mutation bytes to their digest", async () => {
  const expression = "(() => { document.querySelector('button').click(); return true; })()";
  const client = new GpmCdpClient({
    ...base,
    websocketFactory: socketFactoryFor(),
    targetId: "target-1",
    expressionPolicy: () => true,
    mutationExpressionHashes: { LINKEDIN_COMPOSER_TRIGGER: [mutationExpressionHash(expression)] }
  });
  await client.attach();
  await assert.rejects(() => client.evaluateMutation("target-1", expression, { operation: "LINKEDIN_COMPOSER_TRIGGER" }), { code: "GPM_CDP_MUTATION_EXPRESSION_MISMATCH" });
  await client.detach();
});

test("GPM CDP host factory requires explicit mutation authority and binds it lazily", async () => {
  assert.throws(() => createGpmCdpClientFactory({ endpoint: base.endpoint, expressionPolicy: () => true }), { code: "GPM_CDP_FACTORY_MUTATION_REGISTRY_REQUIRED" });
  const expression = "(() => { document.querySelector('button').click(); return true; })()";
  const calls = [];
  const factory = createGpmCdpClientFactory({
    endpoint: base.endpoint,
    expressionPolicy: () => true,
    mutationExpressionAuthorizer: async (request) => {
      calls.push(request);
      return request.operation === "LINKEDIN_COMPOSER_TRIGGER" && request.expressionHash === mutationExpressionHash(expression);
    },
    websocketFactory: socketFactoryFor()
  });
  const client = await factory({ profileReference: "profile-a", sessionAuthority: "authority-a", targetId: "target-1" });
  // Factory construction and client creation are inert; authorization is
  // evaluated only at the exact mutation boundary with exact expression bytes.
  assert.deepEqual(calls, []);
  await client.attach();
  assert.equal(await client.evaluateMutation("target-1", expression, { operation: "LINKEDIN_COMPOSER_TRIGGER", expressionHash: mutationExpressionHash(expression) }), true);
  assert.equal(calls.length, 1);
  await client.detach();
});

test("GPM CDP rejects oversized expressions instead of truncating them", async () => {
  const factory = socketFactoryFor();
  const client = new GpmCdpClient({ ...base, websocketFactory: factory, targetId: "target-1" });
  await client.attach();
  await assert.rejects(() => client.evaluate("target-1", "true".padEnd(32_001, " ")), { code: "GPM_CDP_EXPRESSION_UNSAFE" });
  await client.detach();
});
