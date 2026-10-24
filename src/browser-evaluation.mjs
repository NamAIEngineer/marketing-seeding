/**
 * Provider-neutral browser expression dispatch.
 * Read observations use evaluate(); bounded DOM mutations use the explicit
 * evaluateMutation() capability. Legacy fixtures must opt in explicitly.
 */
import { mutationExpressionHash } from "./browser-mutation-policy.mjs";

export function evaluateBrowser(browser, pageId, expression, { mutation = false, operation = "evaluate" } = {}) {
  if (mutation) {
    const expressionHash = mutationExpressionHash(expression);
    if (typeof browser?.evaluateMutation === "function") {
      return browser.evaluateMutation(pageId, expression, { operation, expressionHash });
    }
    if (browser?.legacyMutationEvaluation === true) return browser.evaluate(pageId, expression);
    throw Object.assign(new Error("browser mutation evaluation is unavailable"), { code: "BROWSER_MUTATION_CAPABILITY_UNSUPPORTED", operation, expressionHash });
  }
  if (typeof browser?.evaluate !== "function") {
    throw Object.assign(new Error("browser expression evaluation is unavailable"), { code: "BROWSER_EVALUATION_UNAVAILABLE" });
  }
  return browser.evaluate(pageId, expression);
}

export default evaluateBrowser;
