#!/usr/bin/env node

const [url, expectedNonce, expectedCommit] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

if (!url || !expectedNonce || !expectedCommit) {
  fail("health probe requires URL, nonce, and source commit");
} else {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`health HTTP ${response.status}`);
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("health response is not a JSON object");
    if (body.ok !== true || body.service !== "global-seeding") throw new Error("health service identity mismatch");
    const ownership = body.serviceOwnership;
    if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) throw new Error("health ownership metadata missing");
    if (ownership.service !== "marketing-seeding") throw new Error("health ownership service mismatch");
    if (ownership.nonce !== expectedNonce) throw new Error("health ownership nonce mismatch");
    if (ownership.sourceCommit !== expectedCommit) throw new Error("health ownership source commit mismatch");
  } catch (error) {
    fail(error?.message || "health probe failed");
  }
}
