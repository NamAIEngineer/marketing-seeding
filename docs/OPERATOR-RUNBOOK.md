# Runbook vận hành

## Khởi động và kiểm tra

```powershell
cd D:\build-agentic-AI
.\Invoke-Agentic.cmd -Action status
.\Invoke-Agentic.cmd -Action seeding-test
.\Invoke-Agentic.cmd -Action seeding-start
.\Invoke-Agentic.cmd -Action seeding-status
```

Dashboard: `http://127.0.0.1:4318`.

## Luồng mỗi ngày

1. Orca automation tạo artifact Blender trong productRepo và kiểm chứng/hash file.
2. Đăng ký artifact vào campaign.
3. AI tạo story có grounding; người vận hành đọc disclosure/claim.
4. Tạo biến thể riêng theo từng target ở trạng thái `draft`.
5. Người vận hành duyệt target rules, consent và nội dung.
6. Dashboard chỉ sao chép nội dung và mở composer allowlisted; người vận hành tự submit.
7. Sau submit, ghi permalink cụ thể và bằng chứng; nếu không có thì trạng thái không được là `published`.
8. 23:30 mỗi ngày theo giờ Asia/Saigon, Orca chỉ theo dõi bài có `status=published` và `publicationUrl`, mở đúng permalink trong Chrome đã đăng nhập, đọc mọi counter hiển thị rõ cho impressions/views, reactions, comments/replies, shares/reposts, clicks và leads, rồi lưu screenshot/hash. Counter thiếu hoặc mơ hồ phải giữ `UNKNOWN`, không suy ra 0. Comment/reply chỉ được ghi khi có `externalId` ổn định và không tự soạn hoặc gửi phản hồi. Login wall và CAPTCHA không được vượt qua; API chính thức là tùy chọn, không phải điều kiện vận hành.

## Email

Chỉ active email target khi có nguồn audience opt-in, căn cứ đồng ý nhận tin và cơ chế unsubscribe. Không nhập danh sách mua ngoài, không dùng tài khoản cũ để né spam filter, không tự động gửi từ browser session.

## Recovery

Windows task `Jang Global Seeding Dashboard` chạy supervisor từ `D:\project-all\marketing-seeding`. Runtime state không nằm trong project source nên việc cập nhật/rebuild source không làm mất campaign history.

## PR1: campaign authorization

Với campaign đã có bản ghi authorization, người vận hành phê duyệt phạm vi một lần qua API operator; các job con chỉ được đưa vào hàng đợi khi đánh giá lại thấy platform, account/profile, target, nội dung, asset, audience, lịch, readiness và giới hạn đều hợp lệ. Job cũ không được tự nhận quyền từ `approvedAt`; campaign chưa có authorization tiếp tục dùng gate duyệt từng bài hiện hành.

- Tạo authorization: `POST /api/campaigns/{campaignId}/authorization` bằng operator token và payload phạm vi campaign.
- Tạm dừng/tiếp tục: `POST /api/campaigns/{campaignId}/authorization/pause` hoặc `/resume` bằng operator token.
- Đánh giá lại job đủ điều kiện: `POST /api/campaigns/{campaignId}/queue-ready-jobs`; endpoint này chỉ đánh giá/queue, không đăng bài.
- Job fan-out được kiểm tra trùng theo campaign, content, platform, account và target. Một job thành công ở platform này không chặn platform khác; lặp cùng nội dung trên cùng platform/account cần `allowRepeatSameContent` trong phạm vi authorization.

`queued` chỉ có nghĩa là đủ điều kiện trong queue. PR1 không thêm publisher, readiness collector hoặc xác minh bài đăng trực tiếp; không coi `queued` là `published`.

## Diễn tập vận hành macOS — 2026-11-02 (E3, local-only)

### Phạm vi và điều kiện đầu vào

- **FACT:** diễn tập này chạy trên macOS, Node `>=22` (ràng buộc trong `package.json`), checkout đã commit và sạch, loopback only (`127.0.0.1`), không ghi credential/token/cookie/session vào file. Repo dùng `npm` cho package scripts (`npm test`); `pnpm-lock.yaml` tồn tại và `pnpm` chỉ dành cho script tùy chọn `setup:cloakbrowser`, không cần cho diễn tập này.
- Trước khi chạy, xác nhận điều kiện đọc-only:

  ```sh
  test "$(uname -s)" = "Darwin"
  node --version
  npm --version
  git rev-parse HEAD
  test "$(git status --porcelain)" = ""
  test "$(git rev-parse HEAD)" = "9dff92b8462b3ffff98255f9632d7f79c57ed791"
  ```

  `test` khác 0 là **STOP**. Không chạy tiếp từ checkout bẩn hoặc khác head; không `reset`, stash, clean, login hay sửa remote.

### Lệnh diễn tập bounded E3

Các lệnh dưới đây chỉ dùng fixture/store tạm của test, không dùng credential, không gọi mạng để publish và không chạm canonical runtime. Chạy từng nhóm; lưu stdout/stderr nguyên văn vào thư mục evidence ngoài product repo nếu cần.

1. **Standing authorization, account/profile isolation, quota/cadence, idempotency, kill switch, UNKNOWN quarantine:**

   ```sh
   node --test \
     test/standing-autonomous-delegation-proof.test.mjs \
     test/standing-campaign-delegation.test.mjs \
     test/campaign-authorization.test.mjs \
     test/one-time-execution-window.test.mjs \
     test/live-execution-grant.test.mjs
   ```

2. **Dry-run worker, audit receipt, restart/idempotency, no publication, UNKNOWN remains quarantined:**

   ```sh
   node --test \
     test/readiness-execution.test.mjs \
     test/jev-execution-worker.test.mjs \
     test/dry-run-restart-soak.test.mjs
   ```

3. **Fixture handoff and no-publication boundary:**

   ```sh
   node --test test/distribution-handoff.test.mjs test/product-content-pipeline.test.mjs
   node scripts/product-content-pipeline-fixture.mjs
   node scripts/content-runtime-preflight.mjs --mode LOCAL
   ```

4. **Read-only module/provider seams:**

   ```sh
   node --test \
     test/execution-binding-governance.test.mjs \
     test/auto-gtm-feed.test.mjs \
     test/camoufox-runtime-probe.test.mjs \
     test/provision-9router.test.mjs
   ```

Do not substitute `npm run start`, live execution endpoints, browser commands, or `npm test` for this bounded rehearsal. This section does not authorize creating an authorization, window, grant, lease, submit intent, publication, permalink, metric, deployment, or external write.

### Result interpretation and evidence

- Exit `0` with the test summary showing zero failures: local fixture seam **PASS**. Expected terminal statuses include `DRY_RUN_COMPLETE`, `DRY_RUN_FAILED` (no submit), `REQUEST_READY`, `NOT_STARTED`, `UNKNOWN` (quarantined), `BLOCKED`, `UNAVAILABLE`, and explicit `feed_not_generated`; these are evidence values, not live readiness.
- Exit non-zero, an assertion failure, unexpected status, missing report, or a command that touches a non-temporary path: **STOP**, preserve output, and classify **UNKNOWN**. Do not rerun as a retry of an execution.
- Evidence pointers: `plans/autonomous-build/reports/verify-20261018-dry-run-rehearsal.md`; `plans/autonomous-build/dry-run-rehearsal/{acceptance.md,report.md,test-results.md}`; `plans/autonomous-build/reports/standing-authorization-isolated-proof-20261019.md`; `plans/autonomous-build/reports/fresh-standing-proof-audit-20261019.md`; `plans/autonomous-build/reports/verify-standing-authority-review-20261019.md`; `plans/autonomous-build/acceptance.md`.
- **FACT (local):** isolated fixtures prove control bindings, quotas/rate/cadence, idempotency, kill fencing, dry-run audit and no publication attempt. **INFERENCE:** repeated local pass means the bounded seam is repeatable under the same fixture inputs. **UNKNOWN:** live account/session authorization, provider or platform acceptance, permalink/metrics, deployment, legal approval, and package/runtime provenance.

### Stop, rollback, and reconciliation

Stop the rehearsal immediately for an `UNKNOWN` result, active kill switch, missing or expired authorization/readiness/grant, quota/rate/cadence failure, unavailable provider/Camoufox/9Router, dirty checkout, changed remote head, or any login/CAPTCHA/OTP prompt. Preserve the receipt, audit output and exact command; make no second dispatch, no blind retry, and no mutation of historical `UNKNOWN`. Roll back by deleting only the temporary fixture directory created by the command; retain durable evidence outside the product repo. A live `UNKNOWN` requires the existing read-only reconciliation path and owner decision; it must not be marked `published`.

### Module boundaries

- **Auto-GTM:** read-only JSON feed input through the existing `src/auto-gtm-feed.mjs` boundary; unavailable or malformed feed stays `UNKNOWN`/unavailable and never grants execution.
- **Camoufox:** canonical standalone runtime/session boundary for supported browser execution; local runtime installation or fixture probe does not prove an authenticated session or publication.
- **GPM:** excluded from this rehearsal and from default social execution.
- **9Router:** optional tooling only; disabled by default for social execution and never an authority or publication provider.
- **Design/content-intelligence:** advisory/read-only inputs through existing supported interfaces; they cannot create authorization, grant, dispatch, publication, or metrics evidence.
