import { createHash } from "node:crypto";

/**
 * Provider-neutral mutation identity.  The operation name is only a label;
 * callers must also bind the exact generated expression bytes to its digest.
 */
export const MUTATION_OPERATIONS = Object.freeze([
  "LINKEDIN_COMPOSER_TRIGGER",
  "LINKEDIN_COMPOSER_CLOSE",
  "LINKEDIN_MEDIA_OPEN",
  "LINKEDIN_MEDIA_BASELINE",
  "LINKEDIN_MEDIA_INPUT_SELECT",
  "LINKEDIN_MEDIA_UPLOAD_BUTTON",
  "LINKEDIN_MEDIA_FINISH_CLICK",
  "LINKEDIN_MEDIA_CANCEL_EDITOR",
  "LINKEDIN_MEDIA_REMOVE_VIDEO",
  "LINKEDIN_MEDIA_CLEAR_COMPOSER",
  "LINKEDIN_MEDIA_CANCEL_COMPOSER"
]);

export const mutationExpressionHash = (expression) =>
  `sha256:${createHash("sha256").update(String(expression).trim()).digest("hex")}`;

export function isMutationOperation(value) {
  return MUTATION_OPERATIONS.includes(String(value || ""));
}

export function normalizeMutationHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  return /^sha256:[a-f0-9]{64}$/.test(hash) ? hash : null;
}

export function normalizeMutationHashRegistry(value) {
  const source = value instanceof Map ? Object.fromEntries(value.entries()) : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) return new Map();
  const result = new Map();
  for (const operation of MUTATION_OPERATIONS) {
    const raw = source[operation];
    const values = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    const hashes = values.map(normalizeMutationHash).filter(Boolean);
    if (hashes.length) result.set(operation, new Set(hashes));
  }
  return result;
}
