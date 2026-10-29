#!/usr/bin/env python3
"""Bounded, offline HTML extraction stage for Session D.

stdin/stdout are a versioned JSON IPC boundary. No URL fetching, browser
startup, model call, or script execution is allowed in this process.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from typing import Any

CONTRACT_VERSION = 1
MAX_INPUT_BYTES = 2_000_000
MAX_OUTPUT_BYTES = 1_500_000
SOURCE_REVISION = "v0.9.5@838869bdda93f25e6d50b3f50ae9577d9b19a586"
EXTRACTOR_REVISION = f"crawl4ai-{SOURCE_REVISION}"


def log(message: str) -> None:
    print(f"[crawl4ai-extract] {message}", file=sys.stderr, flush=True)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def bounded(value: Any, limit: int = 8000) -> str:
    return " ".join(str(value or "").split())[:limit]


def status_error(job_id: str | None, reason: str, status: str = "FAILED") -> dict[str, Any]:
    return {
        "contractVersion": CONTRACT_VERSION,
        "jobId": bounded(job_id, 160) or None,
        "status": status,
        "reason": bounded(reason, 300),
        "extractorRevision": EXTRACTOR_REVISION,
        "records": [],
        "markdown": "",
        "extractedHash": sha256(""),
        "coverage": {"html": False, "markdown": False, "structured": False, "post": False, "comment": False,
                      "iframe": False, "shadowDom": "UNKNOWN", "notes": [bounded(reason, 180)]},
    }


def extract(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("contractVersion") != CONTRACT_VERSION:
        return status_error(payload.get("jobId"), "unsupported contractVersion")
    source_url = bounded(payload.get("sourceUrl"), 1000)
    final_url = bounded(payload.get("finalUrl") or source_url, 1000)
    html = payload.get("html")
    if not source_url or not isinstance(html, str):
        return status_error(payload.get("jobId"), "sourceUrl and html are required")
    if len(html.encode("utf-8")) > MAX_INPUT_BYTES:
        return status_error(payload.get("jobId"), "HTML input exceeds byte bound")
    expected_hash = bounded(payload.get("contentHash"), 128)
    actual_hash = sha256(html)
    if expected_hash and expected_hash != actual_hash:
        return status_error(payload.get("jobId"), "HTML contentHash mismatch")

    started = time.monotonic()
    # Imports are intentionally local. Crawl4AI components below parse the
    # supplied string only; AsyncWebCrawler is never imported or instantiated.
    from crawl4ai import JsonCssExtractionStrategy
    from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
    from bs4 import BeautifulSoup, Comment

    # Keep this stage pure. Crawl4AI's higher-level scraping strategy can
    # inspect image metadata with requests.head(); direct component use avoids
    # any network call while preserving the pinned Markdown/JSON extractors.
    soup = BeautifulSoup(html, "lxml")
    for node in soup.find_all(["script", "style", "noscript"]):
        node.decompose()
    for node in soup.find_all(string=lambda value: isinstance(value, Comment)):
        node.extract()
    cleaned_html = str(soup)
    markdown_result = DefaultMarkdownGenerator(content_source="cleaned_html").generate_markdown(
        cleaned_html, base_url=final_url, citations=True
    )
    markdown = bounded(markdown_result.markdown_with_citations or markdown_result.raw_markdown, 400_000)
    schema = {
        "name": "public-listening-records",
        "baseSelector": "article, [role='article'], [data-testid*='post'], tr.athing, .comment, [class*='comment'], main",
        "fields": [
            {"name": "title", "selector": "h1, h2, h3, [role='heading'], .titleline a, .title a", "type": "text", "default": ""},
            {"name": "text", "selector": "p, [data-testid*='text'], [role='paragraph'], .commtext, .toptext, .comment", "type": "text", "default": ""},
            {"name": "url", "selector": "a[href]", "type": ["attribute"], "attribute": "href", "default": ""},
            {"name": "author", "selector": "[rel='author'], [data-author], [class*='author']", "type": "text", "default": ""},
            {"name": "sourceId", "selector": "[id]", "type": ["attribute"], "attribute": "id", "default": ""},
            {"name": "className", "selector": "[class]", "type": ["attribute"], "attribute": "class", "default": ""},
        ],
    }
    # Crawl4AI's structured component is still invoked against the supplied
    # snapshot. Its generic selector output can contain one row for every
    # nested anchor, though, so normalize platform-shaped records from the
    # same inert BeautifulSoup tree before publishing them.
    structured = JsonCssExtractionStrategy(schema=schema).extract(final_url, cleaned_html)
    records: list[dict[str, Any]] = []
    seen_records: set[str] = set()

    def append_record(*, title: str, body: str, url: str, source_id: str | None,
                      record_type: str, author: str | None = None, parent_id: str | None = None) -> None:
        title = bounded(title, 800)
        body = bounded(body, 8_000)
        if not title and not body:
            return
        content_hash = sha256(f"{title}\n{body}")
        identity = source_id or content_hash
        if identity in seen_records or content_hash in seen_records:
            return
        seen_records.add(identity)
        seen_records.add(content_hash)
        records.append({
            "recordId": source_id or f"extract-{content_hash[:32]}", "sourceId": source_id, "recordType": record_type,
            "sourceUrl": source_url, "url": bounded(url, 1000) or final_url, "title": title, "text": body,
            "author": bounded(author, 240) or None, "contentHash": content_hash, "parentRecordId": parent_id,
        })

    # Hacker News uses stable tr#<item-id> rows. Preserve those IDs and avoid
    # treating vote/reply links as records.
    hn_rows = soup.select("tr.athing[id]")
    coverage_notes = ["HTML-only extraction; no browser/network/model"]
    if hn_rows:
        if len(hn_rows) > 100:
            coverage_notes.append("record limit reached: 100")
        parent_id = None
        try:
            from urllib.parse import parse_qs, urlparse
            parent_id = parse_qs(urlparse(final_url).query).get("id", [None])[0]
        except Exception:
            parent_id = None
        for row in hn_rows[:100]:
            source_id = bounded(row.get("id"), 240) or None
            classes = set(row.get("class") or [])
            is_comment = "comtr" in classes or bool(row.select_one(".comment, .commtext"))
            title_node = row.select_one(".titleline a, .title a")
            title = title_node.get_text(" ", strip=True) if title_node else ""
            body_node = row.select_one(".commtext, .comment")
            body = body_node.get_text(" ", strip=True) if body_node else ""
            if not is_comment:
                subtext = row.select_one(".subtext")
                body = subtext.get_text(" ", strip=True) if subtext else body
            link = (body_node.select_one("a[href^='reply?id=']") if body_node else None) or title_node
            href = link.get("href") if link else final_url
            try:
                from urllib.parse import urljoin
                href = urljoin(final_url, href or final_url)
            except Exception:
                href = final_url
            author_node = row.select_one(".hnuser, [rel='author'], [data-author]")
            append_record(title=title, body=body, url=href, source_id=source_id,
                          record_type="comment" if is_comment else "post",
                          author=author_node.get_text(" ", strip=True) if author_node else None,
                          parent_id=parent_id if is_comment else None)

    # Generic article/card pages. Use Crawl4AI's component result as a
    # fallback only when the page has no recognizable platform rows.
    if not records:
        for item in structured[:100]:
            title = bounded(item.get("title"), 800)
            body = bounded(item.get("text"), 8_000)
            source_id = bounded(item.get("sourceId"), 240) or None
            url = bounded(item.get("url"), 1000) or final_url
            marker = f"{title} {body}".lower()
            append_record(title=title, body=body, url=url, source_id=source_id,
                          record_type="comment" if "comment" in marker or "reply" in marker else "post",
                          author=bounded(item.get("author"), 240) or None)
    if not records:
        # A page record is explicit about coverage. It does not invent a post
        # or comment when the source contains no repeated structured item.
        title = bounded((cleaned_html.split("<title", 1)[-1].split(">", 1)[-1].split("</title", 1)[0] if "<title" in cleaned_html.lower() else ""), 800)
        text = bounded(markdown, 8_000)
        if title or text:
            content_hash = sha256(f"{title}\n{text}")
            records.append({"recordId": f"page-{content_hash[:32]}", "sourceId": None, "recordType": "page",
                            "sourceUrl": source_url, "url": final_url, "title": title, "text": text,
                            "author": None, "contentHash": content_hash, "parentRecordId": None})
    has_post = any(item["recordType"] == "post" for item in records)
    has_comment = any(item["recordType"] == "comment" for item in records)
    output = {
        "contractVersion": CONTRACT_VERSION, "jobId": bounded(payload.get("jobId"), 160) or None,
        "status": "SUCCEEDED" if records and markdown else "PARTIAL",
        "reason": None if records and markdown else "structured content was incomplete",
        "sourceUrl": source_url, "finalUrl": final_url, "capturedAt": payload.get("capturedAt"),
        "contentHash": actual_hash, "extractorRevision": EXTRACTOR_REVISION,
        "markdown": markdown, "extractedHash": sha256(markdown), "records": records,
        "coverage": {"html": True, "markdown": bool(markdown), "structured": bool(structured),
                      "post": has_post, "comment": has_comment, "iframe": False,
                      "shadowDom": "UNKNOWN", "notes": coverage_notes},
        "elapsedMs": round((time.monotonic() - started) * 1000, 2),
    }
    return output


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        result = status_error(None, "IPC input exceeds byte bound")
    else:
        try:
            payload = json.loads(raw.decode("utf-8"))
            result = extract(payload) if isinstance(payload, dict) else status_error(None, "JSON object required")
        except Exception as exc:  # deterministic failure returned as contract JSON
            log(f"failure={type(exc).__name__}: {exc}")
            result = status_error(None, f"extractor failure: {type(exc).__name__}")
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_OUTPUT_BYTES:
        encoded = json.dumps(status_error(result.get("jobId"), "extractor output exceeds byte bound"), separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(encoded + b"\n")
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
