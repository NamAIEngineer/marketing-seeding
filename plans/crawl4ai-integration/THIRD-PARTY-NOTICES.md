# Third-party notices

Session D uses two pinned Python source checkouts:

- **Crawl4AI** `v0.9.5` at `838869bdda93f25e6d50b3f50ae9577d9b19a586`, Apache-2.0. The distribution must retain the UncleCode/Crawl4AI attribution and Apache notice.
- **nodriver** at `0233da5bfbe98dc58341f0863526b6315a97e646`, AGPL-3.0. The worker uses a separate subprocess and temporary public-read Chrome profile. That process boundary does not decide the AGPL obligations for a selected distribution or service model.

The complete source license texts remain in the pinned reference checkouts recorded in [source-audit.md](source-audit.md). The exact installed package revisions and runtime pins are recorded in [python-dependencies.lock](python-dependencies.lock). Review distribution obligations before packaging nodriver into a product release.
