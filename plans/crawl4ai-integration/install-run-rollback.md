# Install, run, rollback

## Install

1. Keep the source checkouts and `.venv-crawl4ai` outside Git.
2. Use the pinned venv: `SEEDING_LISTENING_PYTHON=.venv-crawl4ai/bin/python`.
3. Ensure Chrome exists at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, or set `SEEDING_NODRIVER_CHROME`.
4. Confirm local provider health only when configured: `curl http://127.0.0.1:8767/v1/models`.

## Run

```bash
AGENTIC_ROOT=/tmp/listening-state \
SEEDING_LISTENING_PYTHON="$PWD/.venv-crawl4ai/bin/python" \
SEEDING_LISTENING_BACKEND=nodriver \
SEEDING_OI_PROVIDER_BASE_URL=http://127.0.0.1:8767/v1 \
SEEDING_OI_PROVIDER_MODEL=/Users/nam/.cache/system-agentic-ai/Qwen3-8B-4bit \
node scripts/listening-run.mjs \
  --urls 'https://example.com/,https://news.ycombinator.com/item?id=50276792' \
  --backend nodriver --campaign-id <campaign-id> --provider-analysis \
  --evidence plans/crawl4ai-integration/real-run-final.json
```

`http` is the rollback baseline. Set `SEEDING_LISTENING_BACKEND=http` or pass `--backend http`; no nodriver process starts. Listening is public read only. It never logs in, exports cookies, solves challenges, publishes, messages, or changes an account.
