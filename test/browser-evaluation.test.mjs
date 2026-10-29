import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBrowser } from "../src/browser-evaluation.mjs";
import { mutationExpressionHash } from "../src/browser-mutation-policy.mjs";

test("browser mutation dispatch fails closed when the provider lacks the explicit capability", async () => {
  const browser = { async evaluate() { assert.fail("read-only evaluate must not receive a mutation"); } };
  const expression = "(() => { document.querySelector('button').click(); return true; })()";
  assert.throws(
    () => evaluateBrowser(browser, "page", expression, { mutation: true, operation: "LINKEDIN_COMPOSER_TRIGGER" }),
    error => error?.code === "BROWSER_MUTATION_CAPABILITY_UNSUPPORTED" && error.expressionHash === mutationExpressionHash(expression)
  );
});

test("legacy mutation evaluation requires an explicit fixture opt-in", async () => {
  const calls = [];
  const expression = "(() => { document.querySelector('button').click(); return true; })()";
  const browser = { legacyMutationEvaluation: true, async evaluate(...args) { calls.push(args); return true; } };
  assert.equal(await evaluateBrowser(browser, "page", expression, { mutation: true, operation: "LINKEDIN_COMPOSER_TRIGGER" }), true);
  assert.deepEqual(calls, [["page", expression]]);
});

test("mutation dispatch binds the normalized expression bytes", async () => {
  const calls = [];
  const expression = "(() => { document.querySelector('button').click(); return true; })()";
  const browser = {
    async evaluateMutation(...args) { calls.push(args); return true; }
  };
  assert.equal(await evaluateBrowser(browser, "page", `  ${expression}  `, { mutation: true, operation: "LINKEDIN_COMPOSER_TRIGGER" }), true);
  assert.equal(calls[0][2].expressionHash, mutationExpressionHash(expression));
});
