import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Integrations dashboard API diagnostic stays same-origin and port agnostic", async () => {
  const pages = await readFile(path.join(root, "ui", "src", "Pages.tsx"), "utf8");
  assert.match(pages, /<p>\/api\/dashboard<\/p>/);
  assert.doesNotMatch(pages, /127\.0\.0\.1:4318\/api\/dashboard/);
});

