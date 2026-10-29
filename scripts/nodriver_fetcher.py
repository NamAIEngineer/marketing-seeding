#!/usr/bin/env python3
"""Public-read nodriver backend with a temporary, unauthenticated profile."""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

CONTRACT_VERSION = 1
SOURCE_REVISION = "0233da5bfbe98dc58341f0863526b6315a97e646"
FETCHER_REVISION = f"nodriver-{SOURCE_REVISION}"
MAX_HTML_BYTES = 2_000_000
BLOCK_MARKERS = ("captcha", "verify you are human", "access denied", "login required", "sign in to continue", "bot challenge")


def log(message: str) -> None:
    print(f"[nodriver-fetch] {message}", file=sys.stderr, flush=True)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def text(value: Any, limit: int = 400) -> str:
    return " ".join(str(value or "").split())[:limit]


def public_host(hostname: str) -> bool:
    try:
        ip = ipaddress.ip_address(hostname)
        return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified)
    except ValueError:
        if hostname.lower() in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
            return False
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)}
        except OSError:
            return False
        return bool(addresses) and all(public_host(address) for address in addresses)


def public_addresses(hostname: str) -> list[str]:
    """Resolve a host once and return only globally routable addresses."""
    try:
        address = ipaddress.ip_address(hostname)
        return [str(address)] if public_host(str(address)) else []
    except ValueError:
        if hostname.lower() in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
            return []
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)}
        except OSError:
            return []
        return sorted(address for address in addresses if public_host(address))


def owned_process_pids(root_pid: int | None) -> list[int]:
    """Return the browser process tree observed from the owned root PID."""
    if not root_pid:
        return []
    try:
        output = subprocess.run(
            ["ps", "-axo", "pid=,ppid="], capture_output=True, text=True,
            check=False, timeout=1.0
        ).stdout
        children: dict[int, list[int]] = {}
        for row in output.splitlines():
            parts = row.split()
            if len(parts) != 2:
                continue
            try:
                pid, parent = int(parts[0]), int(parts[1])
            except ValueError:
                continue
            children.setdefault(parent, []).append(pid)
        result: list[int] = []
        queue = [root_pid]
        while queue:
            pid = queue.pop(0)
            if pid in result:
                continue
            result.append(pid)
            queue.extend(children.get(pid, []))
        return result
    except (OSError, subprocess.SubprocessError):
        return [root_pid]


def validate_url(raw: str) -> str:
    parsed = urlparse(str(raw or ""))
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or not parsed.hostname:
        raise ValueError("unsupported or credential-bearing URL")
    if not public_host(parsed.hostname):
        raise ValueError("private or reserved destination is not allowed")
    return parsed._replace(fragment="").geturl()


def validate_request_url(raw: str) -> str | None:
    """Apply the public destination policy to browser redirects/requests."""
    parsed = urlparse(str(raw or ""))
    if parsed.scheme not in {"http", "https"}:
        return None
    return validate_url(raw)


def result(payload: dict[str, Any], status: str, reason: str, **extra: Any) -> dict[str, Any]:
    return {"contractVersion": CONTRACT_VERSION, "jobId": text(payload.get("jobId"), 160) or None,
            "backend": "nodriver", "sourceUrl": text(payload.get("sourceUrl"), 1000),
            "finalUrl": text(extra.pop("finalUrl", payload.get("sourceUrl")), 1000),
            "capturedAt": extra.pop("capturedAt", None), "contentHash": extra.pop("contentHash", sha256("")),
            "fetcherRevision": FETCHER_REVISION, "browserVersion": extra.pop("browserVersion", None),
            "runtimeVersion": extra.pop("runtimeVersion", None),
            "observedHttpStatus": "UNKNOWN", "status": status, "reason": text(reason, 300),
            "contentType": "text/html", "coverage": extra.pop("coverage", {}),
            "html": extra.pop("html", ""), "processEvidence": extra.pop("processEvidence", None), **extra}


async def fetch(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("contractVersion") != CONTRACT_VERSION:
        return result(payload, "FAILED", "unsupported contractVersion")
    source_url = validate_url(payload.get("sourceUrl"))
    started = time.monotonic()
    profile = Path(tempfile.mkdtemp(prefix="marketing-seeding-nodriver-"))
    browser = None
    browser_process = None
    browser_pid = None
    browser_version = None
    runtime_version = None
    process_count_before = 0
    process_count_after = 0
    html = ""
    captured_at = None
    final_url = source_url
    observed_http_status: int | str = "UNKNOWN"
    blocked_destination = None
    outcome = None
    cleanup = "not_started"
    try:
        import nodriver
        from nodriver import cdp
        runtime_version = text(getattr(nodriver, "__version__", None), 80) or None
        parsed_source = urlparse(source_url)
        addresses = public_addresses(parsed_source.hostname or "")
        if not addresses:
            raise ValueError("source hostname did not resolve to a public address")
        # Pin the initial host to the preflight address.  Redirects and every
        # subsequent HTTP request are checked by request_guard below.
        resolver_rule = f"MAP {parsed_source.hostname} {addresses[0]}"
        executable = os.environ.get("SEEDING_NODRIVER_CHROME") or "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        browser = await nodriver.start(headless=True, user_data_dir=str(profile), browser_executable_path=executable,
                                       browser_args=["--disable-background-networking", "--disable-sync", "--no-first-run",
                                                     f"--host-resolver-rules={resolver_rule}"])
        browser_info = getattr(browser, "info", None)
        if hasattr(browser_info, "get"):
            browser_version = text(browser_info.get("Browser"), 180) or None
        browser_version = browser_version or runtime_version
        browser_process = getattr(browser, "_process", None)
        browser_pid = getattr(browser_process, "pid", None)
        process_count_before = len(owned_process_pids(browser_pid))
        request_tab = browser.tabs[0]

        async def request_guard(event, tab=None):
            nonlocal blocked_destination
            target = str(getattr(getattr(event, "request", None), "url", "") or "")
            try:
                validate_request_url(target)
            except Exception as exc:
                blocked_destination = text(target, 1000)
                try:
                    await (tab or request_tab).send(cdp.fetch.fail_request(
                        event.request_id, cdp.network.ErrorReason.ACCESS_DENIED
                    ))
                except Exception:
                    pass
                log(f"blocked_destination={blocked_destination} reason={type(exc).__name__}")
                return
            try:
                await (tab or request_tab).send(cdp.fetch.continue_request(event.request_id))
            except Exception:
                pass

        async def response_observer(event, _tab=None):
            nonlocal observed_http_status
            response = getattr(event, "response", None)
            resource_type = getattr(event, "type_", None)
            if response is not None and resource_type == cdp.network.ResourceType.DOCUMENT:
                observed_http_status = int(getattr(response, "status", 0) or 0) or "UNKNOWN"

        request_tab.add_handler(cdp.fetch.RequestPaused, request_guard)
        request_tab.add_handler(cdp.network.ResponseReceived, response_observer)
        await request_tab.send(cdp.network.enable())
        await request_tab.send(cdp.fetch.enable())
        tab = await browser.get(source_url)
        await asyncio.sleep(min(3.0, max(0.1, float(payload.get("waitSeconds", 1.0) or 1.0))))
        await tab.sleep(0.05)
        final_url = validate_url(getattr(getattr(tab, "target", None), "url", "") or source_url)
        html = await tab.get_content()
        captured_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z")
        if blocked_destination:
            outcome = result(payload, "BLOCKED", "browser request or redirect resolved to a private/reserved destination",
                             finalUrl=final_url, capturedAt=captured_at, observedHttpStatus=observed_http_status,
                             browserVersion=browser_version, runtimeVersion=runtime_version,
                             coverage={"html": False, "jsRendered": True, "notes": ["private destination blocked", blocked_destination]},
                             processEvidence={"workerPid": os.getpid(), "browserPid": browser_pid, "cleanup": "pending"})
        elif not isinstance(html, str) or not html.strip():
            outcome = result(payload, "FAILED", "empty HTML snapshot", finalUrl=final_url, capturedAt=captured_at,
                             observedHttpStatus=observed_http_status,
                             browserVersion=browser_version, runtimeVersion=runtime_version,
                             processEvidence={"workerPid": os.getpid(), "browserPid": browser_pid, "cleanup": "pending"})
        elif len(html.encode("utf-8")) > MAX_HTML_BYTES:
            outcome = result(payload, "FAILED", "HTML snapshot exceeds byte bound", finalUrl=final_url, capturedAt=captured_at,
                             observedHttpStatus=observed_http_status,
                             browserVersion=browser_version, runtimeVersion=runtime_version,
                             processEvidence={"workerPid": os.getpid(), "browserPid": browser_pid, "cleanup": "pending"})
        else:
            lowered = html.lower()
            status = "BLOCKED" if any(marker in lowered for marker in BLOCK_MARKERS) else "SUCCEEDED"
            reason = "public source presented login or bot challenge" if status == "BLOCKED" else None
            outcome = result(payload, status, reason, finalUrl=final_url, capturedAt=captured_at, html=html,
                             contentHash=sha256(html), browserVersion=browser_version, runtimeVersion=runtime_version,
                             observedHttpStatus=observed_http_status,
                             coverage={"html": True, "jsRendered": True, "network": True, "post": "article" in lowered or "post" in lowered,
                                       "comment": "comment" in lowered or "reply" in lowered, "iframe": "<iframe" in lowered,
                                       "shadowDom": "UNKNOWN", "notes": ["public-read temporary profile", "document status observed by CDP"]},
                             processEvidence={"workerPid": os.getpid(), "browserPid": browser_pid, "cleanup": "pending"})
    except Exception as exc:
        log(f"failure={type(exc).__name__}: {exc}")
        outcome = result(payload, "UNKNOWN" if isinstance(exc, (TimeoutError, asyncio.TimeoutError)) else "FAILED",
                         f"nodriver failure: {type(exc).__name__}", finalUrl=final_url, capturedAt=captured_at,
                         observedHttpStatus=observed_http_status,
                         browserVersion=browser_version, runtimeVersion=runtime_version,
                         processEvidence={"workerPid": os.getpid(), "browserPid": browser_pid, "cleanup": "pending"})
    finally:
        if browser is not None:
            try:
                browser_process = getattr(browser, "_process", None) or browser_process
                browser.stop()
                if browser_process is not None:
                    try:
                        await asyncio.wait_for(browser_process.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        try:
                            browser_process.kill()
                        except Exception:
                            pass
                        try:
                            await asyncio.wait_for(browser_process.wait(), timeout=2.0)
                        except Exception:
                            pass
                cleanup = "browser_process_exited" if browser_process is None or browser_process.returncode is not None else "browser_process_exit_unknown"
                process_count_after = len(owned_process_pids(browser_pid))
            except Exception as exc:
                log(f"browser.stop failed: {type(exc).__name__}")
                cleanup = f"browser_stop_error:{type(exc).__name__}"
            process_count_after = len(owned_process_pids(browser_pid))
        try:
            shutil.rmtree(profile)
            cleanup = f"{cleanup};profile_removed"
        except FileNotFoundError:
            cleanup = f"{cleanup};profile_already_removed"
        except Exception as exc:
            cleanup = f"{cleanup};profile_remove_error:{type(exc).__name__}"
    if outcome is None:
        outcome = result(payload, "UNKNOWN", "nodriver produced no outcome", finalUrl=final_url, capturedAt=captured_at,
                         observedHttpStatus=observed_http_status)
    outcome.setdefault("processEvidence", {})
    outcome["processEvidence"]["cleanup"] = cleanup
    outcome["processEvidence"]["processCountBefore"] = process_count_before
    outcome["processEvidence"]["processCountAfter"] = process_count_after
    outcome["processEvidence"]["elapsedMs"] = round((time.monotonic() - started) * 1000, 2)
    return outcome


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_HTML_BYTES)
    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("JSON object required")
        final = asyncio.run(asyncio.wait_for(fetch(payload), timeout=float(payload.get("timeoutSeconds", 30) or 30)))
    except Exception as exc:
        log(f"fatal={type(exc).__name__}: {exc}")
        final = result(payload if "payload" in locals() and isinstance(payload, dict) else {}, "UNKNOWN", f"worker failure: {type(exc).__name__}")
    final.setdefault("processEvidence", {})
    final["processEvidence"].setdefault("cleanup", "worker_exit_without_browser")
    encoded = json.dumps(final, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(encoded[:2_500_000] + b"\n")
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
