# ORCA — Giao việc: ráp marketing-seeding thành Autonomous Growth OS (end-to-end)

> Owner: Nam. Ngày giao: 2026-11-01. Session C = integration lead, như các wave trước.
> Tiếp tục từ checkpoint hiện tại, không build lại từ đầu. Đọc file này xong thì tự lập task graph, chia session và chạy.

---

## 0. Đích cuối (không đổi)

```
Nam đưa: (1) repo sản phẩm  (2) pool account đã được phép dùng  (3) định hướng chiến lược
                    │
                    ▼
HỆ THỐNG TỰ LÀM:
  phát hiện bản release mới của sản phẩm
  → hiểu tính năng mới (grounded từ CHANGELOG/code)
  → quay màn hình thật từng tính năng → dựng video recap theo mẫu
  → crawl/listen tìm cộng đồng liên quan (Figma, UI/UX, AI…) → join có kiểm soát → đọc rule
  → viết copy riêng cho từng nền tảng × từng account × từng cộng đồng
  → lên lịch, đăng, xác minh permalink
  → đo metrics, đọc comment, nháp/trả lời trong phạm vi đã duyệt
  → học, đổi chiến lược, chạy tiếp 24/7
                    │
                    ▼
Nam: CHỈ XEM DASHBOARD OVERVIEW + chỉnh định hướng khi cần
```

Sản phẩm đầu tiên: `jangtrinh/design-os-studio`. Kiến trúc phải nhận được repo sản phẩm khác sau này mà không sửa code (product = config).

---

## 1. Hiện trạng thật (Claude đã đọc repo lúc 2026-11-01, ORCA tự xác minh lại)

**Nhánh mới nhất không phải `main`.** `main` dừng ở `98a499e` (2026-10-21). Code mới nhất nằm ở:

| Nhánh | Head | Ghi chú |
|---|---|---|
| `NamAIEngineer/marketing-seeding-desktop-integrated` (PR #3) | `34a62a0` (2026-11-01) | +251 commit so với main. Đã gồm toàn bộ `integration/session-c-reconciled` (PR #2). Có Camoufox account agents, login adapters, publication adapters (LinkedIn, Threads, Reddit, Facebook Group, Product Hunt, Indie Hackers), content pipeline + ffmpeg, desktop app macOS, 9router, due-schedule, all-social fan-out. |
| `NamAIEngineer/monkfish` | `11e3a47` | 7 commit **không patch-equivalent** với desktop-integrated. 3 commit có subject hoàn toàn vắng mặt bên kia: `800e074` harden Camoufox target and rules verification · `013ae8e` harden desktop update and 9router capability routing · `1a74acc` provision verified content runtime artifacts. |
| `integration/session-c-reconciled` (PR #2) | `bec96d6` | 0 commit ngoài desktop-integrated → đã hấp thụ. |

**Blocker còn mở (theo `.orca-coordination/blockers.md`):** `CAMOUFOX-LIVE-AUTH`, `LIVE-PUBLICATION-METRICS`, `AUTO-GTM-GENERATION`, `A-DIRTY-OVERLAY` (A worktree 22 tracked dirty + 100 untracked), runtime `4318` health UNKNOWN. Chưa có một bài live nào có permalink xác minh.

**Video hiện tại quá yếu so với mục tiêu.** `src/product-content-pipeline.mjs` chỉ render *asset đầu tiên* thành MP4 (ảnh tĩnh → video). Không có quay màn hình, không có dựng cảnh, không có template. Bridge (`product-content-campaign-bridge.mjs`) chỉ nhận `linkedin` + `threads`.

**design-os-studio đã có sẵn đồ nghề marketing video — tái sử dụng, đừng viết lại:**
- `designos-studio --fixture showcase --panel <x> --size 1440x900 --scale 2 --screenshot <out>` chụp headless thật.
- `design/marketing/svg-animation/runtime/hyperframes-engine.mjs` (+ `hyperframes-motion-presets.mjs`, `hyperframes-extra-beats.mjs`): engine HTML/SVG theo beat.
- `scripts/render-micro-8x30s-videos.mjs`: Playwright seek từng frame → ffmpeg, xuất 16:9 và 9:16.
- `scripts/mix-svg-animation-audio.mjs`, `scripts/audit-studio-launch-videos.py` (anti-flop gate), `geist-fonts.css`.
- Bài học đã có: `.brv/context-tree/features/micro-interactions-video-suite-review/status.md` — sếp Jang **reject** bản "6 ảnh tĩnh + con trỏ SVG" vì nhìn như slideshow. ⇒ Clip tính năng phải là **quay màn hình thật, chuyển động liên tục**.
- CHANGELOG có cấu trúc chuẩn `## [x.y.z] - date` + `### Added/Changed/Fixed`. Hiện có 0.7.6 (2026-11-01) trong CHANGELOG nhưng tag mới nhất là `v0.7.5`.

---

## 2. Diễn tập E3 (2026-11-02)

`docs/OPERATOR-RUNBOOK.md` mục "Diễn tập vận hành macOS — 2026-11-02 (E3)" ghim `test "$(git rev-parse HEAD)" = "9dff92b…"`. Head nhánh là `34a62a0` (commit docs thêm chính runbook đó) ⇒ chạy nguyên văn sẽ STOP ở bước điều kiện. Chạy trong worktree sạch ở `9dff92b` (đã có `ms-ready-rehearsal-20261102`). Acceptance: 4 nhóm `node --test` exit 0; `content-runtime-preflight --mode LOCAL` exit 0 (exit 2 thì tự provision bằng `repairContentRuntime` rồi chạy lại). Lưu stdout + SHA-256 vào `plans/e3-rehearsal-20261102/`.

---

## 3. Task graph

### W0 — Một nhánh nền duy nhất
1. Lấy `desktop-integrated` làm nền. Review 7 commit monkfish không equivalent; cherry-pick cái nào còn giá trị, chạy test, ghi lý do bỏ cái nào.
2. A overlay (wave-13-bridge bẩn): checkpoint sạch hoặc khai báo phần nào bỏ.
3. Full suite xanh. Mở PR → `main` khi xong. `main` phải là sự thật.
4. Runtime `4318` chạy từ nền này (LaunchAgent), `/health` 200, `sourceDirty=false`.

### W1 — Release Watcher + Feature Brief
- `src/release-watcher.mjs`: theo dõi repo sản phẩm (releases/tags + section CHANGELOG mới), `releaseId` idempotent.
- LLM chọn 6–9 tính năng nhìn thấy được trên màn hình; headline ≤ 6 từ kiểu "Fill a slot. No detach.", "Pick your agent.", "Ask before acting."; pill `<version> <chủ đề>`; `capturePlan` mỗi tính năng. Headline phải map về dòng CHANGELOG.

### W2 — Video Factory
Mẫu: video recap Nam gửi (Nam sẽ đặt ở `campaigns/design-os-studio-launch/reference/release-recap-reference.mp4`).
- 1280×720 @30fps H.264+AAC ~30 s; xuất 1920×1080, 1080×1920, 1:1/4:5.
- Nền `#121114`, chữ `#F3F2F5`, cam `#E26122`, viền mảnh xanh chấm góc, font Geist.
- Intro `design:os studio X → Y` ~3 s → mỗi tính năng ~3.2 s (pill + headline + clip quay màn hình thật) → "Next: …" (chỉ khi có nguồn) → end card + credit kit + nhạc có license.
- Capture trên Mac: launch `designos-studio` đúng version, điều khiển bằng `designos-mcp`/CLI, quay cửa sổ liên tục (ffmpeg avfoundation / `screencapture -v`). Fallback still+pan chỉ gắn quality=B, không tự đăng.
- Compose bằng hyperframes runtime + Playwright + ffmpeg của design-os-studio. QA gate: ffprobe, blackdetect/freezedetect, loudness, proof-grid, evidenceRef mọi headline, hash MP4.
- Tích hợp qua `runProductContentPipeline` (assets[0] = MP4) → bridge → artifact/story/drafts.
- Done: lệnh mới `node src/cli.mjs release-recap --product design-os-studio --from 0.7.0 --to 0.7.6` ra 3 MP4 đạt QA gate.

### W3 — Fan-out đa nền tảng × đa account
- Bridge thêm `facebook`, `facebook_group`, `reddit`, `product_hunt`, `indie_hackers`, `x` (export trước).
- Mỗi (platform × account × target) một biến thể riêng. Account profile: platform, identity, audience, ngôn ngữ, cap, giờ đăng.
- Standing campaign authorization cho phạm vi đã duyệt.

### W3b — Community Engine
Crawl/listening đã có; join chưa có (README + `docs/REQUIREMENTS-2026-10-07.md` ghi "không join hàng loạt"). Nam đã quyết định thêm join có kiểm soát — ghi decisions.md.
1. Discovery: FB Groups, subreddit, LinkedIn Groups, Threads, Indie Hackers, PH; keyword EN+VI (Figma, UI/UX, design system, AI design, AI agents, Claude Code, Codex, MCP, build in public, "cộng đồng UI/UX Việt Nam"…). Chấm điểm liên quan/size/hoạt động/ngôn ngữ/cho promo.
2. Join: chỉ điểm ≥ ngưỡng; cap 3 request/account/ngày, 15/tuần; trả lời câu hỏi membership trung thực theo hồ sơ account; theo dõi pending/approved.
3. Rule: `promo_ok` / `promo_thread_only` / `no_promo` / `unclear` (unclear = không promo).
4. Nội dung theo loại; warm-up ≥ 7 ngày + vài tương tác thật trước khi promo.
5. Cap promo 3/account/ngày tính chung các group, mỗi group copy khác, giãn vài giờ.
6. Bảng cộng đồng trên dashboard; learning dồn vào group hiệu quả.

### W4 — Live end-to-end
LinkedIn 1 account → permalink → mở rộng Facebook (Page qua Graph API nếu có token; Group qua Camoufox), Threads, Reddit, PH/IH. Kiểm tra upload video từng adapter. UNKNOWN quarantine, không retry mù.

### W5 — Đo lường + học
Metrics 1h/24h/72h (API chính thức nơi có, observer read-only còn lại). Comment: phân loại, nháp reply grounded; tự gửi chỉ trong scope authorization. Learning đề xuất đổi strategy.

### W6 — Overview + 24/7
Overview 6 câu: release/video; bài hôm nay + permalink; metrics; comment/lead; việc chỉ Nam làm được (nhập credential, MFA/CAPTCHA) + trạng thái login từng account; kill switch + ô định hướng chiến lược. LaunchAgents cho dashboard, coordinator, release watcher, schedule, metrics.

---

## 5. Nguyên tắc

- Account onboarding: Nam chỉ nhập username/password trên dashboard (`POST /api/account-credentials` → Keychain → Camoufox agent tự login, discover + verify identity, persistent profile). Không bắt Nam login tay. Tự re-login khi hết hạn.
- Chỉ escalate: credential, CAPTCHA/MFA/OTP/checkpoint, token API, nhạc có license.
- Lane kẹt thì lane khác chạy. Done = bằng chứng thật.
- Account an toàn: chỉ account trong pool; danh tính thật; ghi rõ liên quan sản phẩm; không tương tác chéo giữa các account trong pool; không persona giả; không né CAPTCHA; tôn trọng rule; cap + giãn cách + chống trùng.
- Không commit secret. Không push `jangtrinh/*`.
