import test from "node:test";
import assert from "node:assert/strict";
import { observePublicWithCamoufox, validatePublicObserverUrl } from "../src/camoufox-public-observer.mjs";

const publicLookup = async (hostname) => [{ address: hostname === "example.com" ? "93.184.216.34" : hostname, family: 4 }];

test("public observer rejects unsafe destinations and credentials", async () => {
  await assert.rejects(() => validatePublicObserverUrl("http://localhost/test", { lookup: publicLookup }), /private or reserved/);
  await assert.rejects(() => validatePublicObserverUrl("http://127.0.0.1/test", { lookup: publicLookup }), /private or reserved/);
  await assert.rejects(() => validatePublicObserverUrl("https://user:pass@example.com", { lookup: publicLookup }), /credentials/);
  await assert.rejects(() => validatePublicObserverUrl("file:///tmp/x", { lookup: publicLookup }), /unsupported URL scheme/);
});

test("observer fails closed without an isolated Camoufox transport", async () => {
  const missing = await observePublicWithCamoufox("https://example.com", { lookup: publicLookup });
  assert.equal(missing.code, "OBSERVER_TRANSPORT_UNAVAILABLE");
  const nonIsolated = await observePublicWithCamoufox("https://example.com", { lookup: publicLookup, transport: { observePublic: async () => ({}) } });
  assert.equal(nonIsolated.code, "OBSERVER_ISOLATION_REQUIRED");
});

test("observer returns bounded public evidence and no publication claim", async () => {
  const calls = [];
  const result = await observePublicWithCamoufox("https://example.com", {
    now: "2026-10-23T00:00:00.000Z",
    maxText: 20,
    lookup: publicLookup,
    transport: {
      isolated: true, transportId: "camoufox-test", profileReference: "isolated-public", async observePublic(url) {
        calls.push(url);
        return { url, title: " Example ", text: "abcdefghijklmnopqrstuvwxyz", links: ["/a", "http://127.0.0.1/private", "/a"] };
      }
    }
  });
  assert.equal(result.state, "OBSERVED");
  assert.equal(result.text, "abcdefghijklmnopqrst");
  assert.deepEqual(result.links, ["https://example.com/a"]);
  assert.equal(result.publication.status, "NOT_EVALUATED");
  assert.equal(result.externalSideEffects, false);
  assert.deepEqual(calls, ["https://example.com/"]);
});

test("observer turns transport errors into UNKNOWN without retry or mutation", async () => {
  let calls = 0;
  const result = await observePublicWithCamoufox("https://example.com", { lookup: publicLookup, transport: { isolated: true, async observePublic() { calls += 1; throw Object.assign(new Error("offline"), { code: "OBSERVER_OFFLINE" }); } } });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.code, "OBSERVER_OFFLINE");
  assert.equal(calls, 1);
});
