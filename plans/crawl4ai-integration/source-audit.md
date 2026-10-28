# Crawl4AI / nodriver source audit

Observed on 2026-10-29 (Mac, Python 3.12.15):

| Component | Checkout | Pin | License | Use |
|---|---|---|---|---|
| Crawl4AI | `/Users/nam/Documents/crawl4ai-v0.9.5-reference` | `v0.9.5`, `838869bdda93f25e6d50b3f50ae9577d9b19a586` | Apache-2.0 | `DefaultMarkdownGenerator` and `JsonCssExtractionStrategy` against supplied HTML only |
| nodriver | `/Users/nam/Documents/nodriver-reference` | `0233da5bfbe98dc58341f0863526b6315a97e646` | AGPL-3.0 | Dedicated public-read Chrome/CDP worker in `scripts/nodriver_fetcher.py` |

Crawl4AI attribution requirement is retained from its `LICENSE`: distributions must include the UncleCode/Crawl4AI attribution. nodriver's AGPL-3.0 obligations remain applicable to the chosen distribution/service arrangement; subprocess isolation does not decide those obligations.

Runtime observations:

- Python: `3.12.15`; pinned venv: `.venv-crawl4ai`; installed editable sources match the pins above.
- Crawl4AI imports and direct component extraction passed.
- nodriver runtime reports `0.50.6`; package metadata reports `0.50.99` at the pinned commit. Fetch receipts keep this runtime version separate from the Chrome `Browser` version returned by CDP.
- Chrome executable: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; real runs observed Chrome `156.0.8078.48` through nodriver/CDP.
- Extraction receives a bounded HTML JSON snapshot, never a browser object. The extraction worker imports no browser crawler, makes no URL request, and makes no model call.
- nodriver owns a temporary unauthenticated profile per fetch. Cleanup evidence reports `browser_process_exited;profile_removed`.
- The committed [python-dependencies.lock](python-dependencies.lock) records the installed editable source revisions and bounded runtime package pins; the ignored venv and source checkouts remain outside the product repository.
- License handling is summarized in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Subprocess isolation is not treated as a license exemption.
