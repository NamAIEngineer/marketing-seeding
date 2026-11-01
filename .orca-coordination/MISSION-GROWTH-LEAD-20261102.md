# MISSION — Growth Lead · ra bài thật từ 2026-11-02, 10 bài/ngày

Người giao: Claude (được Nam ủy quyền toàn quyền điều phối ORCA lúc 2026-11-01 18:18 ICT, không cần hỏi lại Nam).
Bạn là **Growth Lead**: coordinator cho toàn bộ marketing-seeding. Bạn tự tạo Orca orchestration Run, tự tạo worktree + worker (Codex) cho từng lane, tự tích hợp, tự verify. Claude check bạn mỗi 30 phút qua file status (mục 6) và terminal này.

Đọc kèm: `.orca-coordination/ORCA-BRIEF-autonomous-growth-os.md` (kiến trúc + wave dài hạn). File này là **ưu tiên của 24h tới**, đè lên thứ tự trong brief khi mâu thuẫn.

## 1. Đầu ra bắt buộc

- **Từ 2026-11-02, mỗi ngày 10 bài đăng thật**, có permalink xác minh, hiện trên Overview dashboard.
- Nam chỉ nhìn Overview mỗi ngày. Không bắt Nam bấm từng job.

## 2. Sự thật lúc giao việc (Claude đo lúc 18:19 ICT 2026-11-01, tự xác minh lại)

- Runtime `127.0.0.1:4318` đang chạy từ `/Users/nam/Documents/marketing-seeding-wave-13-bridge` (PID 35020, `sourceCommit=b1dc560`, `sourceDirty=true`, schema 8, state `/Users/nam/build-agentic-AI/.agentic/marketing-seeding/state.json`). Bản này **không có** `/api/account-credentials` (trả về HTML SPA) ⇒ Nam chưa thể nhập account.
- Keychain chưa có credential nào cho service `ai.marketing-seeding.account-credential`.
- Chỉ có 1 execution account: `linkedin/linkedin_primary`, Camoufox session `STALE` (`CAMOUFOX_SESSION_METADATA_EXPIRED`).
- 18 post cũ: 6 `submit_result_unknown`, 12 `blocked`. **0 bài published có permalink.**
- Code mới nhất: `origin/NamAIEngineer/marketing-seeding-desktop-integrated` = `34a62a0` (worktree này dựa trên đó). Có credential onboarding, Camoufox login adapters, publication adapters, content pipeline, desktop app.
- Workspace chuẩn bị E3 đã có: `ms-ready-rehearsal-20261102` (9dff92b), `ms-ready-builder/scout/verifier-20261102`. Run cũ `run_b718e9461847` (readiness 11-02) có 5 task completed — đọc kết quả trước, đừng làm lại.

## 3. Critical path (làm theo thứ tự, phần độc lập chạy song song)

**P0 — tối nay (trước 22:00 ICT 11-01): runtime mới để Nam nhập account**
1. Backup `state.json` (copy có timestamp + SHA-256) trước mọi thay đổi.
2. Đưa runtime production lên đúng code `desktop-integrated` (cherry-pick các fix monkfish cần thiết nếu chặn). Migrate state additive, không mất history. Chạy qua LaunchAgent, `/health` 200, `sourceDirty=false`, đúng SHA.
3. Xác nhận form/API thêm account hoạt động trên dashboard (`POST /api/account-credentials`). Viết hướng dẫn 3 dòng cho Nam vào status file mục "CẦN NAM".
4. Không phá runtime cũ khi chưa chắc: dựng bản mới, verify, rồi mới chuyển port 4318. Có rollback.

**P1 — đêm nay: nội dung cho ngày mai (không phụ thuộc account)**
- Nguồn grounding: `jangtrinh/design-os-studio` (CHANGELOG 0.7.0 → 0.7.6, README, `docs/images/v0.7/*`, `docs/videos/*`), mọi claim map về dòng nguồn.
- Chuẩn bị ≥ 14 bài (dư để dự phòng), mỗi bài khác nhau, theo kênh: LinkedIn, Facebook (profile/Page/group), Threads, Reddit, Indie Hackers, Product Hunt (comment/update), X (nếu có account). Ngôn ngữ vi + en tùy kênh/cộng đồng.
- Media: ảnh thật từ repo; video recap (W2 trong brief) chạy song song — có bản đạt QA gate thì thay vào bài video. Không chờ video mới đăng.
- Tạo campaign "Design OS Studio — daily distribution" + artifacts/stories/drafts trong store chuẩn.

**P2 — ngay khi Nam nhập account: login + readiness**
- Camoufox account agent tự login từng account, verify identity. Challenge (CAPTCHA/MFA/checkpoint) ⇒ ghi "CẦN NAM" kèm account + nền tảng, các account khác chạy tiếp.
- Re-login `linkedin_primary`.
- Reconcile 6 post `submit_result_unknown` bằng cách đọc (read-only) activity feed của account: nếu đã lên thì ghi permalink, nếu không thì đóng. Không đăng lại trùng.

**P3 — 2026-11-02: đăng 10 bài**
- Standing campaign authorization: Nam đã ủy quyền; tạo authorization cho campaign trên (scope: các account đã READY, các kênh ở trên, 10 bài/ngày, hết hạn 2026-12-01, kill switch bật được). Ghi rõ trong decisions.md: "Delegated by Nam via Claude 2026-11-01 18:18 ICT".
- Lịch 08:00–22:00 ICT, giãn đều. Cap mặc định: LinkedIn 2/account/ngày; Facebook 4/account/ngày (khác group, khác copy, cách nhau ≥ 2h); Threads 3; Reddit 1/account/ngày (subreddit cho phép, đúng flair); Indie Hackers 1; X 3.
- **Không** dồn 10 bài vào 1 account để đủ số. Thiếu account ⇒ đăng đủ trong cap, ghi rõ "thiếu N slot, cần thêm account nền tảng X" ở mục CẦN NAM và trên Overview.
- Mỗi bài: verify permalink độc lập + media hash; UNKNOWN thì quarantine, không retry mù.
- Metrics 1h/24h vào dashboard.

**P4 — Overview cho Nam**
- Panel "Hôm nay": mục tiêu 10, đã đăng/verified, mỗi bài (giờ, kênh, account, permalink, metric mới nhất), bài kế tiếp lúc mấy giờ.
- Panel "Cần Nam": account cần nhập/MFA, slot thiếu account.
- Lặp lại hằng ngày tự động (schedule + LaunchAgent), restart không đăng trùng.

**Song song (không chặn P0–P4):** W1/W2 video factory, W3b community engine theo brief.

## 4. Quy tắc

- Tự sửa lỗi kỹ thuật, tự cài runtime, tự retry an toàn. Lane kẹt thì lane khác chạy tiếp.
- Chỉ dừng chờ Nam cho: nhập credential, CAPTCHA/MFA/OTP, token API. Ghi vào status mục CẦN NAM, không hỏi qua terminal.
- Không né CAPTCHA, không persona giả, không cho account trong pool tương tác chéo bài của nhau, tôn trọng rule cộng đồng, ghi rõ liên quan sản phẩm khi quảng bá.
- Không commit secret. Không push lên `jangtrinh/*`. Push nhánh của bạn lên `NamAIEngineer/marketing-seeding` khi có checkpoint xanh.
- Done = có bằng chứng thật (permalink, hash, metric). Test xanh không phải done.

## 5. Chia lane gợi ý (bạn tự quyết)

| Lane | Việc |
|---|---|
| runtime | P0 runtime/migrate/LaunchAgent/credential API |
| content | P1 bài + media cho 11-02 |
| accounts | P2 login, readiness, reconcile UNKNOWN |
| publish | P3 authorization, lịch, adapters, verify |
| overview | P4 dashboard |
| video | W1/W2 |
| community | W3b |

## 6. Status file — Claude đọc mỗi 30 phút

Cập nhật `.orca-coordination/growth-lead-status.md` (worktree này) **ít nhất mỗi 30 phút** và mỗi khi đổi pha, dạng:

```
updated: <ISO time ICT>
phase: P0|P1|P2|P3|P4
runtime: <sha> dirty=<bool> health=<code> port=4318
accounts: <platform/accountId: READY|BLOCKED|UNKNOWN>, ...
today_posts: target=10 scheduled=<n> published_verified=<n> unknown=<n>
lanes: <lane: state, worker handle, last evidence>
CẦN NAM: <danh sách việc chỉ Nam làm được, mỗi dòng 1 việc, có hướng dẫn ngắn> | none
blockers: <code: mô tả, ai gỡ, ETA>
next_30m: <việc sẽ làm>
```

Ghi sự thật; UNKNOWN là UNKNOWN. Bắt đầu ngay.


---

## 7. BỔ SUNG 18:25 ICT — Mục tiêu North Star + luật viết content (bắt buộc cho mọi bài)

**North Star: `github.com/jangtrinh/design-os-studio` đạt 1000 star.** Lúc 18:24 ICT 2026-11-01: 81 star, 15 fork (GitHub API). Mọi bài phục vụ mục tiêu này. Đo star mỗi giờ (GitHub API, read-only) → hiện trên Overview: số star hiện tại, +star hôm nay, đường tiến tới 1000, bài nào kéo star (UTM/referrer khi có, còn lại tương quan theo giờ đăng).

**Giọng viết (Nam chốt):** "Người ta không quan tâm mấy cái tính năng đó. Người ta quan tâm cái việc mình làm nó ra được cái gì."
- Mở bài bằng **kết quả cụ thể** người đọc nhận được (vd: mở file Figma `.fig` 336 MB trên máy mình, không cần cloud; cho Claude Code/Codex sửa thẳng file thiết kế đang mở; xuất code React/SwiftUI từ layer), không mở bằng tên tính năng, version, kiến trúc, Rust/wgpu.
- Show thành quả: ảnh/video cái làm ra được, trước/sau, con số thật có nguồn (README/CHANGELOG). Không bịa số, không so sánh "nhất/duy nhất/tốt nhất" khi không có bằng chứng.
- **Mỗi bài bắt buộc có link repo đầy đủ:** `https://github.com/jangtrinh/design-os-studio` (thêm UTM khi nền tảng cho phép, vd `?utm_source=<platform>&utm_campaign=star1000`). CTA rõ: thử + star repo nếu thấy hữu ích. Bài vào cộng đồng `no_promo` thì không đăng link (theo W3b).
- Ngắn, đời thường, đúng giọng từng nền tảng. Tiếng Việt cho cộng đồng VN, tiếng Anh cho quốc tế.
- QA gate cho copy (fail ⇒ không vào queue): có link repo đúng; câu đầu là kết quả, không phải tính năng; mọi con số/claim map về dòng nguồn; bản tiếng Việt qua linter design-os-vietnamese (dưới).

**design-os-vietnamese — CHƯA được tích hợp vào marketing-seeding.** Claude đã kiểm tra: không có reference trong `desktop-integrated`, monkfish, session-c, wave-13-bridge, không có clone trên máy. Việc cần làm (lane content):
1. Clone `https://github.com/jangtrinh/design-os-vietnamese` (read-only, pin SHA) cạnh các repo khác.
2. Tích hợp vào pipeline content như một **gate + skill tiếng Việt**:
   - `shared/scripts/validate_copy.py <file> --domain <ux|biz|tech> --register <...>`: chặn calque/dịch máy, lỗi NFC, lẫn kiểu dấu, superlative không có căn cứ (Luật Quảng cáo).
   - Skills `vietnamese-landing-copy`, `vietnamese-tech-writing`, `vietnamese-media-journalism-pr`, `vietnamese-business-comms`: nạp làm hướng dẫn giọng viết cho bài tiếng Việt.
   - `shared/scripts/plain_tone.py` / `writing_context.py` nếu phù hợp.
3. Bài tiếng Việt chỉ vào queue khi validate_copy không còn lỗi mức error. Lưu report + hash vào evidence.
4. Sau này design-os-vietnamese cũng là **sản phẩm thứ hai** để quảng bá (9 star) — chỉ bật sau khi design-os-studio chạy ổn.


---

## 8. BỔ SUNG 18:32 ICT — MỖI BÀI PHẢI CÓ VIDEO MP4 (Nam chốt, bắt buộc)

**Mỗi bài đăng phải kèm 1 video MP4 cùng phong cách video mẫu** để tăng tương tác. Bài không có video đạt QA gate thì không vào queue.

- Video mẫu đã đặt sẵn: `campaigns/design-os-studio-launch/reference/release-recap-reference.mp4` (SHA-256 `a7014b242aca885b221fc6f1a8d93199176dcf4797b03f9af17b20a23ebafa95`, 1280×720, 30 fps, 30.3 s, H.264 + AAC). Đo lại template từ file này (spec trong brief W2).
- ⇒ **W2 Video Factory lên ngang P1, chặn P3.** Mở lane `video` ngay tối nay, song song P0.
- 10 bài/ngày cần 10 video **khác nhau** (không đăng cùng 1 file cho 10 bài). Gợi ý cấu trúc:
  - 1 video recap nhiều tính năng (0.7.0 → 0.7.6), ~30 s, đúng mẫu.
  - Các video ngắn 1 kết quả / 1 video (10–20 s, cùng template: pill + headline kết quả + clip quay màn hình thật + end card có link repo `github.com/jangtrinh/design-os-studio` + "⭐ Star on GitHub").
  - Mỗi video xuất đúng tỉ lệ kênh: 16:9 (LinkedIn/X/Reddit), 9:16 (Threads/Reels/Shorts), 1:1 hoặc 4:5 (Facebook feed).
  - Headline video cũng theo giọng "kết quả trước tính năng" (mục 7).
- Clip phải là **quay màn hình thật** của `designos-studio` trên máy này (bài học Jang reject slideshow). Kho video dự phòng được dùng khi factory chưa kịp: `design-os-studio/docs/videos/*.mp4` và video mẫu ở trên — chỉ dùng tạm, ghi rõ trên dashboard là video tái dùng.
- QA gate video (brief W2) + gắn SHA-256 vào post; adapter upload video từng nền tảng phải có verify media sau khi đăng.
- Buffer: luôn có sẵn ≥ 10 video đạt QA cho ngày kế tiếp trước 22:00 mỗi tối.

**Dashboard (Nam check mỗi ngày) — bắt buộc hiển thị trên Overview:**
- Panel "Hôm nay": mỗi bài 1 dòng = giờ đăng · kênh · account · **thumbnail + nút xem video MP4** · câu mở đầu · permalink · metric mới nhất. Mục tiêu 10, đã đăng/verified bao nhiêu.
- Panel "Video": video đã dựng hôm nay / ngày mai (preview, thời lượng, tỉ lệ, QA pass/fail, hash), số video còn trong buffer.
- Panel "1000★": star hiện tại của design-os-studio, +star hôm nay, đường tới 1000.
- Panel "Cần Nam".
- Video phục vụ qua route loopback của dashboard (không đẩy file ra ngoài), chỉ file đã đăng ký artifact.

Ghi tiến độ lane video vào status file (mục 6): `videos: ready=<n> qa_fail=<n> buffer_tomorrow=<n>`.


---

## 9. BỔ SUNG 18:33 ICT — PHẠM VI TRƯỚC MẮT: CHỈ LINKEDIN + FACEBOOK (Nam chốt, đè lên P3 và W3/W3b)

- Từ 2026-11-02: **10 bài/ngày chỉ trên LinkedIn + Facebook.** Threads, Reddit, Product Hunt, Indie Hackers, X: tạm dừng (giữ code, không đăng). Community join (W3b) lùi lại sau.
- **10 bài = 10 nội dung khác nhau + 10 MP4 khác nhau** (mục 7 + 8). Không tái dùng copy hay video giữa các bài.
- Phân bổ để không bị khóa account (đăng dồn là mất account):

| Bề mặt | Cap/ngày | Ghi chú |
|---|---|---|
| LinkedIn cá nhân (`linkedin_primary` + account Nam thêm) | 2 / account | cách nhau ≥ 4h, video 16:9 hoặc 1:1 |
| LinkedIn Company/Showcase Page (nếu account có quyền admin) | 2 / page | |
| Facebook cá nhân (timeline) | 1–2 / account | video 1:1 hoặc 4:5 |
| Facebook Page (nếu account có quyền admin) | 3 / page | Graph API nếu có token, không thì Camoufox |
| Facebook Group (đã là member + rule cho phép promo) | 4 / account, mỗi group 1 bài | cách nhau ≥ 2h, copy khác nhau |

- Lịch 08:00–22:00 ICT, xen kẽ LinkedIn/Facebook. Nếu account hiện có không đủ 10 slot an toàn: đăng đủ trong cap, ghi rõ trên Overview + CẦN NAM: "thiếu N slot, cần thêm: account LinkedIn / account Facebook / quyền admin Page". Không vượt cap để đủ số.
- Facebook Group: chỉ group account đã là member sẵn và rule cho phép quảng bá (đọc rule, lưu evidence). Chưa join group mới trong phạm vi này.
- Mỗi bài: link `https://github.com/jangtrinh/design-os-studio` (UTM `utm_source=linkedin|facebook&utm_campaign=star1000`), câu đầu là kết quả, video MP4 đạt QA, permalink + media verify sau khi đăng.


---

## 10. BỔ SUNG 18:35 ICT — TỰ CRAWL + TỰ JOIN GROUP, TỰ LÀM HẾT (Nam chốt, đè mục 9 phần "chưa join group mới")

- Bật lại **W3b Community Engine ngay bây giờ** cho **Facebook Groups + LinkedIn Groups** (nền tảng khác vẫn tạm dừng theo mục 9). Lane `community` chạy song song P0/P1.
- Tự làm toàn bộ, **không hỏi Nam**: crawl/discovery group mới → chấm điểm → tự gửi yêu cầu join → tự trả lời câu hỏi membership → theo dõi duyệt → đọc + phân loại rule → đưa group đạt vào lịch đăng.
- Câu hỏi membership: trả lời **trung thực** từ thông tin công khai trên profile của chính account đó + mô tả sản phẩm (design-os-studio, open source). Không bịa thông tin cá nhân. Câu hỏi không trả lời trung thực được ⇒ bỏ group đó, không hỏi Nam.
- Giữ nguyên các giới hạn W3b để không bị khóa account: ≤ 3 yêu cầu join/account/ngày, ≤ 15/tuần, giãn cách ngẫu nhiên; chỉ group điểm cao, đúng chủ đề (Figma, UI/UX, product design, design system, AI design, AI agents, Claude Code/Codex, build in public; cả group Việt Nam). Rule `unclear`/`no_promo` ⇒ không đăng link.
- Trước khi đăng promo vào group mới join: có ít nhất vài tương tác thật, giá trị (trả lời câu hỏi đúng chủ đề) từ account đó trong group. Thời gian chờ do bạn quyết dựa trên rule group; không đăng link ngay khi vừa được duyệt.
- Group đã là member sẵn: dùng ngay nếu rule cho promo.
- Facebook Group được tính vào 10 bài/ngày theo cap mục 9 (4 bài/account/ngày, mỗi group 1 bài, cách ≥ 2h).
- Overview: bảng "Cộng đồng" (group, nền tảng, điểm, trạng thái join, rule, bài đã đăng, star/click kéo về) + số join hôm nay.
- "Không cần Nam" áp dụng cho mọi quyết định vận hành. Thứ duy nhất vẫn cần Nam: nhập credential account và gõ mã khi nền tảng đòi CAPTCHA/MFA. Ghi vào CẦN NAM, các lane khác chạy tiếp.

Claude chuyển sang check **mỗi 1 giờ**. Status file vẫn cập nhật ≥ mỗi 30 phút; thêm dòng `community: discovered=<n> join_requested_today=<n> approved=<n> postable=<n>`.

---

## 11. BỔ SUNG 19:56 ICT — UI/UX Overview + app desktop (Nam chê "UI/UX nhìn xấu quá")

Overview hiện là trang dài toàn form kỹ thuật (operator token, 9Router, update, standing authorization…). Nam chỉ cần nhìn 1 màn hình mỗi ngày. Mở lane `ui` (worker riêng, dùng skill thiết kế có sẵn: design-os-system-one / design tokens của design-os-studio — nền tối, cam #E26122, font Geist), hạn: bản đầu trước 08:00 2/11.

1. **Trang Tổng quan mới cho Nam** (mặc định khi mở app), chỉ 5 khối, đọc trong 10 giây:
   - Hôm nay: 10 ô bài (giờ · LinkedIn/Facebook · account · group · thumbnail video bấm xem được · câu mở đầu · trạng thái · link bài · view/like/comment).
   - 1000★: số star hiện tại, +hôm nay, thanh tiến độ tới 1000.
   - Account: mỗi account 1 dòng với trạng thái Sẵn sàng / Cần mã xác minh / Lỗi, nút "Thêm account".
   - Cộng đồng: group đã vào / đang chờ duyệt / đã đăng, hiệu quả.
   - Cần Nam: chỉ hiện khi có việc thật; trống thì ẩn.
2. Mọi panel kỹ thuật (operator token, 9Router, cập nhật, standing authorization, lịch, flow graph…) chuyển sang tab **"Hệ thống"**, không hiện trên Tổng quan.
3. **Bỏ bắt Nam dán operator token:** app desktop chạy local, tự cấp phiên vận hành cho cửa sổ app (vd service inject token cho WKWebView qua cơ chế an toàn loopback-only), Nam không bao giờ phải thấy token.
4. **Sửa app Swift (desktop/MarketingSeedingApp.swift):** thêm main menu chuẩn (App, Edit với Cut/Copy/Paste/Select All, Window) để Cmd+C/V/A hoạt động trong WKWebView.
5. Tiếng Việt tự nhiên, không jargon (bỏ "UNKNOWN quarantine", "standing authority"… khỏi màn hình của Nam). Đi qua gate design-os-vietnamese cho chữ UI.
6. Build lại app (sh desktop/build-macos.sh từ checkout sạch), cập nhật LaunchAgent ai.marketing-seeding.packaged cổng 4321, giữ state + Keychain + Camoufox profiles. Chụp màn hình Tổng quan mới lưu vào plans/growth-lead-20261102/ui/.

---

## 12. BỔ SUNG 22:37 ICT — TỰ TRẢ LỜI COMMENT + PILOT 1 TUẦN (Nam chốt)

### 12.1 Tự trả lời comment
- Mọi bài đã đăng: làn Chrome profile của chính account đó đọc comment mới (chu kỳ ≤ 30 phút trong giờ chạy), và **tự trả lời** dưới tên account đó.
- Giọng như người thật: ngắn, tự nhiên, đúng ngôn ngữ người hỏi (vi/en), cảm ơn, trả lời đúng câu hỏi, có thể hỏi lại 1 câu. Không văn mẫu, không lặp câu giữa các reply, không emoji spam, không dán link repo ở mọi reply (chỉ khi người ta hỏi link/cách cài).
- Grounded: mọi thông tin kỹ thuật lấy từ repo design-os-studio (README/CHANGELOG/docs), có evidence hash. Không biết thì nói thật là sẽ kiểm tra, không bịa.
- Trung thực: là account của Nam trả lời về sản phẩm Nam/team làm; không giả làm người dùng khác, không phủ nhận là có dùng công cụ nếu bị hỏi thẳng.
- Không tự trả lời (để vào "Cần Nam" trên Overview): comment tiêu cực/tranh cãi, hỏi giá/hợp đồng/hợp tác, thông tin cá nhân, vấn đề pháp lý, spam/lừa đảo.
- Giới hạn: tối đa 1 reply cho mỗi comment, tối đa 20 reply/account/ngày, giãn cách tự nhiên (2–15 phút sau comment, không reply tức thì).
- Overview: số comment mới, đã trả lời, đang chờ Nam.

### 12.2 Lịch đăng
- **10 bài/ngày, khung 07:00–23:00 ICT**, giãn đều theo cap mục 9 (không dồn 1 account). Chạy hằng ngày tự động.

### 12.3 PILOT 7 NGÀY: 2026-11-02 → 2026-11-08
- Mỗi ngày đủ 10 bài (content khác + MP4 khác), theo đúng cap.
- Thiết kế thí nghiệm có chủ đích (ghi rõ biến của từng bài vào store):
  - Khung giờ: sáng 07–10 / trưa 11–14 / chiều 15–18 / tối 19–23.
  - Kiểu mở bài: kết quả cụ thể / câu hỏi / trước–sau / con số thật.
  - Video: recap nhiều tính năng vs 1 kết quả; 16:9 vs 1:1 vs 4:5; độ dài 15s vs 30s.
  - Nơi đăng: LinkedIn cá nhân / Facebook cá nhân / Facebook Group (theo loại group: VN vs quốc tế, design vs AI).
  - Ngôn ngữ: vi vs en.
- Đo cho từng bài: 1h/24h/72h view, reaction, comment, share, click (UTM), star GitHub tăng (tương quan theo giờ + referrer khi có).
- Cuối mỗi ngày (23:30): tự tạo báo cáo ngày ngắn trên Overview + điều chỉnh nhẹ (tối đa 30% số bài ngày mai đổi biến) — giữ đủ dữ liệu so sánh.
- Ngày 2026-11-09 08:00: **báo cáo pilot** trên Overview (và file plans/pilot-20261102/report.md): cái gì kéo star tốt nhất, group/khung giờ/kiểu bài/video tốt nhất, account nào bị cảnh báo hay không, đề xuất công thức tối ưu cho tuần 2 + số bài/ngày an toàn. Sau đó tự áp dụng công thức tối ưu (Nam chỉ xem).
- An toàn account trong pilot: nếu bất kỳ account nào gặp cảnh báo/giới hạn/checkpoint ⇒ tự giảm 50% tần suất account đó 48h và ghi vào Overview.

---

## 13. BỔ SUNG 22:40 ICT — PHẠM VI CRAWL (làn Camoufox + Crawl4AI, chỉ trang public)

1. Cộng đồng: tìm Facebook/LinkedIn group theo chủ đề (Figma, UI/UX, design system, AI design, AI agents, Claude Code/Codex, MCP, build in public; VN + quốc tế) → tên, link, số thành viên, độ hoạt động, nội quy, loại bài được phép → danh sách join + xếp hạng.
2. Bài đang chạy tốt trong các group đó: chủ đề, cách mở bài, định dạng video/ảnh, giờ đăng, mức tương tác → gợi ý góc content cho ngày sau.
3. Listening: các cuộc thảo luận public mà sản phẩm thật sự liên quan (vd "Figma offline", "mở file .fig không cần Figma", "AI agent sửa file thiết kế", "Figma MCP") → danh sách cơ hội trả lời có ích (chỉ đưa vào hàng chờ, đăng/trả lời vẫn theo cap + rule cộng đồng).
4. Đối thủ / repo tương tự (Penpot, các Figma MCP server, công cụ design-to-code AI…): cách họ giới thiệu, cái gì kéo star → bài học cho content.
5. Nguồn sản phẩm: release/CHANGELOG/README của design-os-studio (release watcher) → tính năng mới cho video + bài.
6. Số liệu của mình: star history design-os-studio (GitHub API), referrer/traffic nếu có quyền.

Giới hạn: chỉ trang public, tôn trọng robots/rate limit; KHÔNG thu thập danh sách thành viên, email, số điện thoại hay dữ liệu cá nhân; không đăng nhập để crawl. Kết quả ghi vào store chung (source=camoufox-public / crawl4ai) và hiện trên Overview ở khối Cộng đồng.

---

## 14. CHỐT ĐÍCH CUỐI 23:54 ICT (Nam) — đè mọi mục trước khi mâu thuẫn

- Toàn bộ là MỘT hệ thống tự động. Nam chỉ xem Overview để thấy kết quả, hệ thống tự optimize và tìm cách tối ưu.
- KHÔNG dùng API mạng xã hội nào. Mọi thao tác LinkedIn/Facebook bằng trình duyệt qua Chrome profile thật của app.
- ĐĂNG NHẬP có 2 cách, phải hỗ trợ cả hai:
  1. **Thủ công**: Tổng quan > Tài khoản > Đăng nhập thủ công → mở Chrome profile riêng của account, Nam tự đăng nhập; hệ thống tự nhận identity, chuyển READY.
  2. **Danh sách account**: Nam đưa danh sách tài khoản FB/LinkedIn (nhập qua form local trong app hoặc import file CSV local chọn bằng hộp thoại; file chỉ đọc 1 lần rồi xoá khỏi bộ nhớ, không lưu vào repo/state/log/chat) → credential vào macOS Keychain → hệ thống tự mở Chrome profile của từng account, tự điền và đăng nhập, tự nhận identity, chuyển READY. Gặp CAPTCHA/2FA/checkpoint ⇒ dừng account đó, mở cửa sổ cho Nam và ghi Cần Nam; không giải CAPTCHA tự động; account khác chạy tiếp.
  - Hỗ trợ nhiều account mỗi nền tảng (pool), mỗi account một Chrome profile riêng; lịch đăng tự chia bài theo cap từng account.
- Ranh giới giữ nguyên: không thêm biện pháp che giấu automation hay né phát hiện bot.

---

## 15. VIDEO MOTION SPEC v3 — 05:45 ICT 2/11 (Nam chê v2 "cứng nhắc, chả có gì đặc sắc") — đè W2 cũ

Claude đã phân tích video mẫu ở 4–5 fps. Cái làm nên mẫu (v2 thiếu hết):
1. **Chữ động (kinetic typography)**: headline hiện TỪNG CHỮ theo nhịp nhạc ("Edit" → "Edit grid" → "Edit grid tracks" → … → "Edit grid tracks on the canvas."). Intro: dòng "design:os studio" hiện trước, sau đó dòng cam "0.4 → 0.6" hiện thêm. Card "Next:" chữ mờ dần.
2. **Crop/zoom sát vùng tính năng**, KHÔNG quay cả cửa sổ: chỉ danh sách agent 5 dòng, chỉ hộp thoại Approve, chỉ lưới + panel Auto layout. UI to, đọc được chữ trong UI.
3. **Thao tác thật có con trỏ**: con trỏ rê qua từng agent (hover sáng từng dòng), bấm Approve (nút đổi trạng thái), thêm track lưới (Rows 2→3, ô lưới mới xuất hiện), kéo layout guide (frame co lại). Mỗi cảnh có 1 thay đổi nhìn thấy rõ.
4. **Khung viền xanh chấm góc biến hình** giữa các cảnh: co giãn/đổi vị trí theo kích thước nội dung, chuyển cảnh mượt, không cắt cứng.
5. **Nhịp nhanh**: 9 tính năng trong ~30s, mỗi cảnh 1.5–3s, cắt theo beat nhạc; nhóm theo pill version (vd "0.7 Inspector", "0.7 Agents") kể câu chuyện tiến hoá.
6. Nền tối + canvas sáng tương phản; outro "Next: …" + end card version + credit.

Cách làm v3:
- Mỗi tính năng: chuẩn bị file demo riêng (nội dung to, rõ, ít chi tiết thừa) trong designos-studio; kịch bản thao tác cụ thể; điều khiển bằng designos-mcp/CLI + con trỏ thật; quay cửa sổ bằng ScreenCaptureKit; cắt vùng ROI quanh tính năng (đúng tọa độ panel/hộp thoại) và scale lên.
- Dựng bằng HTML/SVG + Playwright với hyperframes runtime có sẵn trong design-os-studio (design/marketing/svg-animation/runtime: hyperframes-engine, motion-presets, extra-beats): kinetic text theo beat, khung viền morph, chuyển cảnh.
- Mỗi video: intro (title rồi version), 3–5 cảnh tính năng khác nhau, Next teaser, end card repo + Star on GitHub + credit. 15–30s.
- QA bắt buộc (ngoài kỹ thuật): (a) mỗi cảnh có thay đổi pixel rõ trong ROI giữa đầu/cuối cảnh; (b) chữ UI trong ROI đủ to (cao ≥ 14px ở 1280×720); (c) headline có animation từng chữ; (d) ảnh so sánh cạnh nhau với mẫu ở cùng nhịp; (e) Claude duyệt bằng mắt trước khi gắn vào slot.
- Chất lượng hơn số lượng: KHÔNG đăng video v2. Lịch hôm nay dời bài đầu cho tới khi có video v3 đã duyệt; mục tiêu ≥3 video v3 trước 10:00, đủ 10 trong ngày; slot nào chưa có video duyệt thì dời sang slot sau.

---

## 16. VIDEO DÀI 30–40s "LÀM RA SẢN PHẨM" — 05:42 ICT 2/11 (Nam chốt, đè mục 15 về cấu trúc; giữ phong cách mục 15)

Mỗi video kể **trọn quá trình làm ra một sản phẩm thật bằng DESIGN:OS Studio, và kết thúc bằng sản phẩm hoàn chỉnh**, dài 30–40s.

Cấu trúc (giữ khung + chuyển động của mẫu: pill cam, chữ hiện từng từ theo nhịp, khung viền chấm góc co giãn, zoom sát vùng thao tác, con trỏ thật):
1. **Hook 0–3s**: kết quả cuối trước (vd "Một màn hình dashboard. Từ file trống. 35 giây.") + logo design:os studio.
2. **Quá trình 3–30s** (5–7 bước, mỗi bước 3–5s, quay thật rồi tăng tốc hợp lý): ví dụ mở file trống/kit → nhờ agent (Claude Code/Codex trong Agents panel) dựng bố cục từ 1 câu yêu cầu → chỉnh auto layout/grid → dùng component + variables (đổi theme) → kiểm tra Check designs/sửa lỗi → Dev Mode xuất code React/HTML. Mỗi bước có headline ngắn ≤ 6 từ, thay đổi nhìn thấy rõ.
3. **Thành phẩm 30–36s**: reveal sản phẩm hoàn chỉnh (màn hình đẹp, có thể cả code chạy được/preview HTML), zoom chậm.
4. **End card 36–40s**: "design:os studio 0.7.6", github.com/jangtrinh/design-os-studio, "Star on GitHub", credit nhạc.

Mỗi video là một sản phẩm khác nhau (dashboard SaaS, landing page, app mobile onboarding, form đăng ký, bảng giá, profile card…) để 10 bài/ngày không trùng. Bản tiếng Việt và tiếng Anh chỉ khác chữ overlay.

Thực hiện: video worker term_a791f9b6 làm, dùng ScreenCaptureKit (đã chạy) + hyperframes runtime/Playwright để dựng. Làm **1 video hoàn chỉnh trước**, xuất contact sheet 2 fps + ảnh so sánh với video mẫu, ghi path vào video-quality-a-status.md, Claude duyệt bằng mắt rồi mới làm các video còn lại. Không đăng video nào chưa được Claude duyệt. Lịch bài dời theo video đã duyệt.
