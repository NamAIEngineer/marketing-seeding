import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clampPage, pageCountFor, paginateRows } from "../ui/src/pagination.mjs";
import { compactDisplayText } from "../ui/src/display-safe.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Figma-derived dashboard shell is wired to real local data", async () => {
  const html = await readFile(path.join(appRoot, "public", "index.html"), "utf8");
  const app = await readFile(path.join(appRoot, "ui", "src", "App.tsx"), "utf8");
  const css = await readFile(path.join(appRoot, "ui", "src", "index.css"), "utf8");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-[A-Za-z0-9_-]+\.js/);
  assert.match(app, /fetch\("\/api\/dashboard"/);
  assert.match(app, /Kết nối 9Router một lần/);
  assert.match(app, /Mở 9Router dashboard/);
  assert.match(app, /zero-touch pairing/);
  assert.match(app, /\/v1\/models/);
  assert.match(app, /dashboardUrl/);
  assert.match(app, /cache: "no-store"/);
  assert.match(app, /Không có dữ liệu mock/);
  assert.match(app, /Không tải được dữ liệu/);
  assert.match(app, /Đăng theo ủy quyền chủ sở hữu/);
  assert.match(app, /Conversation detail/);
  assert.match(app, /Engagement candidate detail/);
  assert.match(app, /slice\(0, 5\)/);
  assert.match(app, /không có nút approve, reply hoặc send/);
  assert.match(app, /compactDisplayText/);
  assert.equal(compactDisplayText("author token=abc123 password: hunter2 cookie=abc Bearer abcdef authorization: xyz Authorization: Bearer abcdefgh authorization=Bearer xyz", "UNKNOWN", 180), "author token=[REDACTED] password: [REDACTED] cookie=[REDACTED] Bearer [REDACTED] authorization: [REDACTED] Authorization: [REDACTED] authorization=[REDACTED]");
  assert.equal(compactDisplayText("  ", "UNKNOWN", 10), "UNKNOWN");
  assert.match(css, /--purple:\s*#8778f8/);
  for (const mockValue of ["1.84M", "127.8K", "84.2K", "Relay AI Launch", "Nam Hoang"]) {
    assert.doesNotMatch(app, new RegExp(mockValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("React tables paginate long collections without discarding filters", async () => {
  const pages = await readFile(path.join(appRoot, "ui", "src", "Pages.tsx"), "utf8");
  const rows = Array.from({ length: 23 }, (_, index) => ({ id: index + 1 }));
  assert.equal(pageCountFor(rows.length), 3);
  assert.deepEqual(paginateRows(rows, 2).map((row) => row.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(paginateRows(rows, 3).map((row) => row.id), [21, 22, 23]);
  assert.equal(clampPage(3, 4), 1);
  assert.match(pages, />\s*Trước\s*<\/button>/);
  assert.match(pages, />\s*Sau\s*<\/button>/);
  assert.match(pages, /Trang \{page\}\/\{pageCount\}/);
  assert.match(pages, /value=\{query\}/);
  assert.match(pages, /value=\{status\}/);
  assert.match(pages, /value=\{platform\}/);
  assert.match(pages, /paged\.rows\.map/);
});
