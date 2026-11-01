import { canPreparePublication, parseMetricInput } from "./workflow.js";

const number = new Intl.NumberFormat("vi-VN");
let dashboardData = null;

const SCREEN_META = Object.freeze({
  overview: { title: "Growth Intelligence", subtitle: "Sản phẩm, lịch phân phối và tín hiệu cần xử lý hôm nay." },
  queue: { title: "Hàng đợi nội dung", subtitle: "Duyệt bài, kiểm tra permalink và xử lý phản hồi theo thứ tự ưu tiên." },
  traffic: { title: "Traffic và bằng chứng", subtitle: "Theo dõi checkpoint traffic hằng ngày lúc 23:30, nguồn dữ liệu và những bài đang thiếu xác minh." },
  campaigns: { title: "Chiến dịch và quy trình", subtitle: "Sản phẩm, nội dung theo kênh và lịch phân phối đã được kiểm chứng." },
  settings: { title: "Cài đặt dashboard", subtitle: "Giao diện, quyền điều hành local và nguyên tắc an toàn của hệ thống." }
});

function setScreen(screen, { updateHash = true } = {}) {
  const next = SCREEN_META[screen] ? screen : "overview";
  document.body.dataset.screen = next;
  document.querySelectorAll(".sidebar nav a[data-screen]").forEach((link) => {
    link.classList.toggle("active", link.dataset.screen === next);
    link.setAttribute("aria-current", link.dataset.screen === next ? "page" : "false");
  });
  document.querySelectorAll("main > [data-screen-section]").forEach((section) => {
    section.classList.toggle("screen-visible", section.dataset.screenSection === next);
  });
  const advanced = document.querySelector("#advancedShell");
  if (advanced) advanced.open = next === "campaigns";
  const meta = SCREEN_META[next];
  document.querySelector("#screenTitle").textContent = meta.title;
  document.querySelector("#screenSubtitle").textContent = meta.subtitle;
  if (updateHash) history.replaceState(null, "", `#${next}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupTheme() {
  const button = document.querySelector("#themeToggle");
  const stored = localStorage.getItem("seedingTheme");
  const theme = stored === "light" || stored === "dark" ? stored : "dark";
  const render = () => {
    const dark = document.body.dataset.theme === "dark";
    button.textContent = dark ? "☀ Sáng" : "☾ Tối";
    button.setAttribute("aria-pressed", String(dark));
  };
  document.body.dataset.theme = theme;
  render();
  button.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    localStorage.setItem("seedingTheme", next);
    render();
  });
}

function setupNavigation() {
  document.querySelectorAll(".sidebar nav a[data-screen]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setScreen(link.dataset.screen);
    });
  });
  const requested = window.location.hash.slice(1);
  setScreen(SCREEN_META[requested] ? requested : "overview", { updateHash: false });
}

const STATUS_LABELS = Object.freeze({
  draft: "Bản nháp",
  needs_review: "Cần duyệt",
  approved: "Đã duyệt",
  queued: "Đang chờ",
  publishing: "Đang đăng",
  processing: "Đang xử lý",
  published: "Đã xuất bản",
  removed: "Bị nền tảng gỡ",
  failed: "Thất bại",
  paused: "Tạm dừng",
  rejected: "Bị từ chối",
  open: "Đang mở",
  replied: "Đã trả lời",
  sent: "Đã gửi",
  active: "Đang hoạt động"
});

const READINESS_LABELS = Object.freeze({
  ready: "Sẵn sàng",
  checking: "Đang kiểm tra",
  warming_up: "Đang xây dựng uy tín",
  blocked: "Đang bị chặn"
});

const INTEGRATION_MODES = Object.freeze({
  read_only: "Chỉ đọc chỉ số",
  manual_only: "Thủ công có bằng chứng"
});

const CHANNEL_LABELS = Object.freeze({
  facebook_group: "Nhóm Facebook",
  threads: "Threads",
  reddit: "Reddit",
  product_hunt: "Product Hunt",
  indie_hackers: "Indie Hackers",
  linkedin: "LinkedIn",
  email: "Email opt-in"
});

const FLOW_KIND_LABELS = Object.freeze({
  artifact: "Sản phẩm", campaign: "Chiến dịch", story: "Câu chuyện", target: "Đối tượng",
  post: "Bản theo kênh", publication_attempt: "Lần mở composer", publication_evidence: "Bằng chứng đăng", metric_snapshot: "Snapshot",
  interaction: "Tương tác", reply: "Phản hồi", schedule: "Lịch", schedule_run: "Lượt chạy lịch",
  keyword_snapshot: "Snapshot từ khóa", conversion: "Chuyển đổi", collector_run: "Lượt thu thập", audit_event: "Kiểm toán"
});

const METRIC_LABELS = Object.freeze({
  impressions: "Lượt hiển thị",
  reactions: "Lượt cảm xúc",
  comments: "Bình luận",
  shares: "Lượt chia sẻ",
  clicks: "Lượt nhấp",
  leads: "Khách hàng tiềm năng"
});

const EVENT_LABELS = Object.freeze({
  bootstrap_r19: "Khởi tạo chiến dịch R19",
  campaign_created: "Tạo chiến dịch",
  campaign_updated: "Cập nhật chiến dịch / từ khóa",
  target_created: "Tạo đối tượng",
  target_updated: "Cập nhật đối tượng",
  post_created: "Tạo bài đăng",
  post_updated: "Cập nhật bài đăng",
  post_approved: "Phê duyệt bài đăng",
  metrics_recorded: "Ghi nhận chỉ số",
  keyword_metrics_recorded: "Ghi nhận hiệu suất từ khóa",
  interaction_added: "Thêm tương tác",
  reply_drafted: "Tạo bản nháp trả lời",
  reply_approved: "Phê duyệt trả lời",
  reply_sent: "Đánh dấu trả lời đã gửi",
  conversion_recorded: "Ghi nhận chuyển đổi",
  collector_succeeded: "API traffic hoàn tất",
  collector_failed: "API traffic thất bại",
  artifact_registered: "Đăng ký sản phẩm đã kiểm chứng",
  story_created: "Tạo câu chuyện có căn cứ",
  channel_drafts_created: "Tạo bản nháp theo kênh",
  schedule_created: "Tạo lịch bản nháp",
  schedule_run_recorded: "Ghi nhận lượt chạy lịch",
  state_schema_migrated_v2: "Nâng cấp state lên v2"
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || "Không xác định";
}

function eventLabel(event) {
  if (EVENT_LABELS[event]) return EVENT_LABELS[event];
  if (event?.startsWith("post_transition_")) {
    return `Chuyển bài sang “${statusLabel(event.slice("post_transition_".length))}”`;
  }
  return event || "Không xác định";
}

function kpi(label, value) {
  return `<article class="kpi"><strong>${number.format(value || 0)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function emptyRow(columns, label = "Chưa có dữ liệu") {
  return `<tr><td colspan="${columns}" class="empty">${escapeHtml(label)}</td></tr>`;
}

function date(value) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

function operatorToken() {
  return sessionStorage.getItem("seedingOperatorToken") || "";
}

function updateOperatorStatus() {
  const connected = Boolean(operatorToken());
  document.querySelector("#operatorStatus").textContent = connected ? "Đã kết nối trong session" : "Chưa kết nối";
  document.querySelector("#operatorStatus").classList.toggle("connected", connected);
}

async function operatorFetch(path, options = {}) {
  const token = operatorToken();
  if (!token) throw new Error("Hãy kết nối token vận hành trước");
  const response = await fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-agentic-actor": "dashboard-operator",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function showToast(message, isError = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 5000);
}

function postActions(post, target) {
  const id = escapeHtml(post.id);
  if (["draft", "needs_review", "paused"].includes(post.status)) {
    return `<button class="button compact" data-action="approve" data-post-id="${id}">Duyệt bài</button>`;
  }
  if (["approved", "queued"].includes(post.status)) {
    const plan = canPreparePublication(post, target);
    return `<button class="button compact primary" data-action="prepare" data-post-id="${id}" ${plan.allowed ? "" : "disabled"}>Mở Chrome và sao chép</button><small>${escapeHtml(plan.allowed ? "Dán nội dung rồi xác nhận trên nền tảng" : plan.reason)}</small>`;
  }
  if (["publishing", "processing"].includes(post.status)) {
    return `<button class="button compact primary" data-action="publish" data-post-id="${id}">Ghi permalink đã đăng</button>`;
  }
  if (post.status === "published") {
    return `<div class="action-row"><a class="button compact" href="${escapeHtml(post.publicationUrl)}" target="_blank" rel="noreferrer">Mở bài</a><button class="button compact" data-action="collect" data-post-id="${id}">Lấy từ API</button><button class="button compact" data-action="metrics" data-post-id="${id}">Ghi thủ công</button></div>`;
  }
  if (["failed", "removed"].includes(post.status)) {
    return `<button class="button compact" data-action="review" data-post-id="${id}">Đưa về cần duyệt</button>`;
  }
  return "-";
}

function deltaText(pulse) {
  const parts = [
    ["reactions", "cảm xúc"], ["comments", "bình luận"], ["clicks", "lượt nhấp"], ["leads", "lead"]
  ].filter(([key]) => pulse.delta?.[key]).map(([key, label]) => `+${number.format(pulse.delta[key])} ${label}`);
  return parts.length ? parts.join(" · ") : "Chưa có tăng trưởng giữa hai snapshot";
}

function readinessLabel(readiness) {
  return READINESS_LABELS[readiness?.state] || "Chưa kiểm tra";
}

function renderSimpleOverview(data, targetById, campaignById) {
  const blockedTargets = data.targets.filter((target) => target.readiness?.state && target.readiness.state !== "ready");
  const reviewPosts = data.posts.filter((post) => ["draft", "needs_review", "failed", "removed"].includes(post.status));
  const dueTraffic = (data.trafficPulse || []).filter((pulse) => ["due", "engage"].includes(pulse.priority));
  const actions = [];
  if (blockedTargets.length) actions.push({
    tone: "warning", title: `${blockedTargets.length} kênh chưa thể đăng`,
    text: "Mở mục Kênh & lỗi, xử lý từng bước rồi mới duyệt bài."
  });
  if (reviewPosts.length) actions.push({
    tone: "info", title: `${reviewPosts.length} bài cần xem lại`,
    text: "Đọc nội dung, kiểm tra đúng cộng đồng và bấm Duyệt bài khi đã chắc chắn."
  });
  if (dueTraffic.length) actions.push({
    tone: "success", title: `${dueTraffic.length} bài cần kiểm tra traffic`,
    text: "Mở bài đã đăng, đọc tương tác mới và ghi snapshot có bằng chứng."
  });
  if (data.pendingReplies) actions.push({
    tone: "info", title: `${data.pendingReplies} phản hồi đang chờ`,
    text: "Bản nháp được tạo từ dữ liệu dự án; phản hồi chỉ gửi khi có căn cứ và đúng quy tắc kênh."
  });
  if (!actions.length) actions.push({ tone: "success", title: "Không có việc gấp", text: "Hệ thống đang theo dõi các bài đã đăng." });
  document.querySelector("#nextActions").innerHTML = actions.map((item, index) => `<article class="next-action ${item.tone}">
    <span>${index + 1}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div>
  </article>`).join("");

  const visibleTargets = [...data.targets].sort((left, right) => {
    const rank = { blocked: 0, checking: 1, warming_up: 2, ready: 3 };
    return (rank[left.readiness?.state] ?? 1) - (rank[right.readiness?.state] ?? 1);
  }).slice(0, 5);
  document.querySelector("#readinessCards").innerHTML = visibleTargets.length ? visibleTargets.map((target) => {
    const readiness = target.readiness || {};
    const steps = (readiness.nextSteps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    return `<article class="readiness-card ${escapeHtml(readiness.state || "checking")}">
      <div class="readiness-head"><div><strong>${escapeHtml(target.name)}</strong><small>${escapeHtml(CHANNEL_LABELS[target.channel] || target.channel)}</small></div><span>${escapeHtml(readinessLabel(readiness))}</span></div>
      <p>${escapeHtml(readiness.summary || "Chưa có kết quả kiểm tra điều kiện đăng")}</p>
      ${steps ? `<ol>${steps}</ol>` : ""}
      ${readiness.checkedAt ? `<small>Kiểm tra gần nhất: ${escapeHtml(date(readiness.checkedAt))}</small>` : ""}
    </article>`;
  }).join("") : '<p class="empty-card">Chưa có kênh phân phối.</p>';

  document.querySelector("#postCards").innerHTML = data.posts.length ? data.posts.slice(0, 6).map((post) => {
    const target = targetById[post.targetId] || {};
    const campaign = campaignById[post.campaignId] || {};
    return `<article class="post-card">
      <div class="post-card-main"><span class="status-pill ${escapeHtml(post.status)}">${escapeHtml(statusLabel(post.status))}</span><div><strong>${escapeHtml(target.name || post.targetId)}</strong><small>${escapeHtml(CHANNEL_LABELS[target.channel] || target.channel || "Không xác định")} · ${escapeHtml(campaign.name || post.campaignId)}</small></div></div>
      <div class="post-card-actions">${postActions(post, target)}</div>
    </article>`;
  }).join("") : '<p class="empty-card">Chưa có bài đăng.</p>';
}

async function load() {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được dashboard: HTTP ${response.status}`);
  const data = await response.json();
  dashboardData = data;
  const router = data.nineRouter || {};
  const routerNode = document.querySelector("#nineRouterStatus");
  if (routerNode) {
    const modelText = router.selection?.model ? `Mô hình: ${router.selection.model} · ${router.selection.reason}` : "Chưa chọn mô hình";
    routerNode.innerHTML = `<strong>9Router ${escapeHtml(router.binary?.version || "chưa cài")}</strong><span>${escapeHtml(router.catalogStatus || "UNKNOWN")} · ${router.models?.length || 0} model live · ${escapeHtml(modelText)}</span><small>${router.connectRequired ? "Cần kết nối một lần trong dashboard 9Router; không tự lấy credential nhà cung cấp." : "Catalog xác thực đã sẵn sàng."}</small>`;
    routerNode.className = `integration-status ${router.authenticated ? "ready" : "warning"}`;
  }
  document.querySelector("#updatedAt").textContent = `Phiên bản ${data.revision} · ${date(data.updatedAt)}`;
  document.querySelector("#kpis").innerHTML = [
    kpi("Đã xuất bản", data.statuses.published),
    kpi("Cần duyệt", data.statuses.needs_review),
    kpi("Kênh chưa sẵn sàng", data.targets.filter((target) => target.readiness?.state !== "ready").length),
    kpi("Tương tác đang mở", data.openInteractions)
  ].join("");
  document.querySelector("#channels").innerHTML = data.channels.map((channel) => `
    <div class="channel"><div><strong>${escapeHtml(CHANNEL_LABELS[channel.id] || channel.label)}</strong><small>${number.format(channel.targets)} đối tượng</small></div><span class="channel-count">${number.format(channel.posts)}</span><small>bài đăng</small></div>
  `).join("");
  document.querySelector("#metrics").innerHTML = Object.keys(METRIC_LABELS).map((key) => `
    <div class="metric"><strong>${data.metricCoverage?.[key]?.measured === 0 && (data.metricCoverage?.[key]?.unknown || data.metricCoverage?.[key]?.unsupported) ? "—" : number.format(data.totals[key])}</strong><span>${escapeHtml(METRIC_LABELS[key])}</span><small>${number.format(data.metricCoverage?.[key]?.measured || 0)} đo được · ${number.format(data.metricCoverage?.[key]?.unknown || 0)} chưa rõ · ${number.format(data.metricCoverage?.[key]?.unsupported || 0)} không hỗ trợ</small></div>
  `).join("");
  const collector = data.automation?.trafficCollector || {};
  const dailyProduction = data.automation?.dailyProduction || {};
  const browserTracking = data.automation?.browserTracking || {};
  const browserCoverage = data.browserCoverage || {};
  const fixtureWorker = data.automation?.fixtureWorker || {};
  document.querySelector("#dailyProductionStatus").textContent = dailyProduction.configured
    ? `${dailyProduction.enabled ? "Sản xuất hằng ngày đang bật" : "Sản xuất hằng ngày đang tắt"} · lần kế tiếp ${date(dailyProduction.nextRunAt)}`
    : "Chưa cài lịch sản xuất hằng ngày";
  document.querySelector("#collectorStatus").textContent = collector.enabled
    ? `API tùy chọn đang bật · mỗi ${number.format(collector.intervalMinutes)} phút · lần kế tiếp ${date(collector.nextRunAt)}`
    : "API tùy chọn đang tắt";
  document.querySelector("#browserTrackingStatus").textContent = browserTracking.configured
    ? `${browserTracking.enabled ? "Chrome read-only đang bật" : "Chrome read-only đang tắt"} · ${number.format(browserCoverage.observed || 0)}/${number.format(browserCoverage.totalPublished || 0)} bài trong checkpoint 24h · ${number.format(browserCoverage.verified || 0)} xác minh · ${number.format(browserCoverage.unknown || 0)} chưa rõ · ${number.format(browserCoverage.missing || 0)} còn thiếu · lần kế tiếp ${date(browserTracking.nextRunAt)}`
    : "Chưa cài lịch Chrome read-only";
  document.querySelector("#browserTrackingStatus").className = `badge ${browserCoverage.complete ? "confidence-high" : "confidence-low"}`;
  if (fixtureWorker.enabled) {
    document.querySelector("#browserTrackingStatus").textContent += ` \u00b7 Worker local (${fixtureWorker.cdpEndpointConfigured ? "CDP CloakBrowser \u0111\u00e3 c\u1ea5u h\u00ecnh" : "ch\u1ec9 MockPage"})`;
  }
  const targetById = Object.fromEntries(data.targets.map((target) => [target.id, target]));
  const campaignById = Object.fromEntries(data.campaigns.map((campaign) => [campaign.id, campaign]));
  const postById = Object.fromEntries(data.posts.map((post) => [post.id, post]));
  const recentInteractions = data.recentInteractions || [];
  const recentReplies = data.recentReplies || [];
  const latestMetricSnapshots = data.latestMetricSnapshots || [];
  const recentAudit = data.recentAudit || [];
  const integrations = data.integrations || [];
  const conversions = data.recentConversions || [];
  const graph = data.flowGraph || { nodes: [], counters: { confidence: {}, unresolvedReferences: 0 } };
  const schedules = data.schedules || [];
  const interactionById = Object.fromEntries(recentInteractions.map((interaction) => [interaction.id, interaction]));
  renderSimpleOverview(data, targetById, campaignById);
  document.querySelector("#flowSummary").innerHTML = `
    <span class="badge neutral">${number.format(graph.counters.nodes || 0)} node</span>
    <span class="badge confidence-high">${number.format(graph.counters.confidence?.high || 0)} tin cậy cao</span>
    <span class="badge ${graph.counters.unresolvedReferences ? "confidence-low" : "confidence-high"}">${number.format(graph.counters.unresolvedReferences || 0)} tham chiếu thiếu</span>`;
  const laneOrder = ["artifact", "campaign", "story", "target", "post", "publication_attempt", "publication_evidence", "metric_snapshot", "keyword_snapshot", "interaction", "reply", "conversion", "schedule", "schedule_run", "collector_run", "audit_event"];
  document.querySelector("#flowLanes").innerHTML = laneOrder.map((kind) => {
    const nodes = graph.nodes.filter((entry) => entry.kind === kind);
    return `<section class="flow-lane"><header><strong>${escapeHtml(FLOW_KIND_LABELS[kind])}</strong><span>${number.format(nodes.length)}</span></header>
      <div>${nodes.slice(0, 8).map((entry) => `<article class="flow-node confidence-${escapeHtml(entry.confidence)}"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(statusLabel(entry.status))} · ${escapeHtml(entry.confidence)}</small></article>`).join("") || '<p class="flow-empty">Chưa có</p>'}${nodes.length > 8 ? `<p class="flow-empty">+${number.format(nodes.length - 8)} node chưa hiển thị</p>` : ""}</div>
    </section>`;
  }).join("");
  document.querySelector("#schedules").innerHTML = schedules.length ? schedules.map((schedule) => `<tr>
    <td><strong>${escapeHtml(schedule.name)}</strong></td>
    <td>${escapeHtml(campaignById[schedule.campaignId]?.name || schedule.campaignId)}</td>
    <td>${escapeHtml(schedule.localTime)}<small>${escapeHtml(schedule.timezone)}</small></td>
    <td>${escapeHtml((schedule.channels || []).map((channel) => CHANNEL_LABELS[channel] || channel).join(" · "))}</td>
    <td>${schedule.mode === "publish_with_standing_approval" ? "Đăng theo ủy quyền chủ sở hữu" : "Bản nháp có duyệt"}</td>
    <td><span class="status-pill ${escapeHtml(schedule.status)}">${escapeHtml(statusLabel(schedule.status))}</span></td>
  </tr>`).join("") : emptyRow(6, "Chưa có lịch campaign trong state; lịch Orca hằng ngày vẫn hiển thị ở Nguồn dữ liệu");
  document.querySelector("#artifacts").innerHTML = data.recentArtifacts?.length ? data.recentArtifacts.map((artifact) => `<tr>
    <td><strong>${escapeHtml(artifact.name)}</strong><small>${escapeHtml(artifact.mediaType)}</small></td>
    <td>${escapeHtml(artifact.relativePath)}<small>${number.format(artifact.bytes || 0)} byte</small></td>
    <td><code>${escapeHtml(String(artifact.sha256 || "").slice(0, 16))}</code></td>
    <td>${escapeHtml(artifact.evidence)}</td>
  </tr>`).join("") : emptyRow(4, "Chưa đăng ký artifact đã kiểm chứng");
  document.querySelector("#stories").innerHTML = data.recentStories?.length ? data.recentStories.map((story) => `<tr>
    <td><strong>${escapeHtml(story.title)}</strong><small>${escapeHtml(story.audience)}</small></td>
    <td>${escapeHtml(story.angle)}<small>CTA: ${escapeHtml(story.callToAction)}</small></td>
    <td>${escapeHtml((story.groundingSources || []).map((source) => source.relativePath).join(" · "))}</td>
    <td><button class="button compact" data-action="channel-draft" data-story-id="${escapeHtml(story.id)}">Tạo bản theo kênh</button></td>
  </tr>`).join("") : emptyRow(4, "Chưa có story có căn cứ");
  document.querySelector("#campaignsManager").innerHTML = data.campaigns.length
    ? data.campaigns.map((campaign) => {
      const campaignPosts = data.posts.filter((post) => post.campaignId === campaign.id);
      const published = campaignPosts.filter((post) => post.status === "published").length;
      return `<tr>
        <td><strong>${escapeHtml(campaign.name)}</strong><small><span class="status-pill ${escapeHtml(campaign.status)}">${escapeHtml(statusLabel(campaign.status))}</span></small></td>
        <td>${escapeHtml(campaign.objective)}${campaign.landingUrl ? `<small><a href="${escapeHtml(campaign.landingUrl)}" target="_blank" rel="noreferrer">Landing page</a></small>` : ""}</td>
        <td>${number.format((campaign.keywords || []).length)}<small>${escapeHtml((campaign.keywords || []).slice(0, 3).map((item) => item.phrase).join(" · ") || "Chưa cấu hình")}</small></td>
        <td>${number.format(published)}/${number.format(campaignPosts.length)}<small>đã xuất bản / tổng</small></td>
        <td><div class="action-row"><button class="button compact" data-action="keywords" data-campaign-id="${escapeHtml(campaign.id)}">Quản lý từ khóa</button><button class="button compact" data-action="artifact" data-campaign-id="${escapeHtml(campaign.id)}">Nhập sản phẩm</button><button class="button compact" data-action="story" data-campaign-id="${escapeHtml(campaign.id)}">Tạo story</button><button class="button compact" data-action="schedule" data-campaign-id="${escapeHtml(campaign.id)}">Tạo lịch</button></div></td>
      </tr>`;
    }).join("")
    : emptyRow(5, "Chưa có chiến dịch");
  document.querySelector("#keywordPerformance").innerHTML = data.keywordPerformance?.length
    ? data.keywordPerformance.map((keyword) => {
      const metric = keyword.latest || {};
      const ctr = metric.impressions ? `${((metric.clicks || 0) / metric.impressions * 100).toFixed(1)}%` : "-";
      return `<tr>
        <td><strong>${escapeHtml(keyword.phrase)}</strong><small>${escapeHtml(keyword.intent)} · ${escapeHtml(keyword.locale)} · ${escapeHtml(campaignById[keyword.campaignId]?.name || keyword.campaignId)}</small></td>
        <td>${number.format(metric.impressions || 0)}</td>
        <td>${number.format(metric.clicks || 0)}<small>CTR ${ctr}</small></td>
        <td>${number.format(metric.leads || 0)}</td>
        <td>${metric.rank || "-"}</td>
        <td><button class="button compact" data-action="keyword-metrics" data-campaign-id="${escapeHtml(keyword.campaignId)}" data-keyword="${escapeHtml(keyword.phrase)}">Ghi hiệu suất</button></td>
      </tr>`;
    }).join("")
    : emptyRow(6, "Chưa có từ khóa; mở Quản lý từ khóa trong chiến dịch");
  document.querySelector("#integrations").innerHTML = integrations.length
    ? integrations.map((item) => {
      const browserReady = browserTracking.configured && item.id !== "email";
      return `<tr>
      <td><strong>${escapeHtml(item.label)}</strong></td>
      <td>${browserReady ? "Chrome read-only" : escapeHtml(INTEGRATION_MODES[item.mode] || item.mode)}</td>
      <td><span class="status-pill ${item.configured || browserReady ? "active" : "needs_review"}">${browserReady ? "Sẵn sàng qua Chrome" : item.configured ? "Đã cấu hình API" : "Chưa sẵn sàng"}</span></td>
      <td>${escapeHtml(item.missing?.join(", ") || "-")}</td>
      <td>${escapeHtml(item.note)}</td>
    </tr>`;
    }).join("")
    : emptyRow(5, "Chưa có nguồn thu thập traffic");
  document.querySelector("#conversions").innerHTML = conversions.length
    ? conversions.map((item) => `<tr>
      <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.eventId)}</small></td>
      <td>${escapeHtml(item.source)}</td>
      <td>${number.format(item.valueMinor)} ${escapeHtml(item.currency)}</td>
      <td>${escapeHtml(date(item.occurredAt))}</td>
    </tr>`).join("")
    : emptyRow(4, "Chưa có chuyển đổi đã xác minh");
  document.querySelector("#trafficPulse").innerHTML = data.trafficPulse?.length
    ? data.trafficPulse.map((pulse) => {
      const post = postById[pulse.postId] || {};
      const target = targetById[post.targetId] || {};
      return `<article class="traffic-card ${escapeHtml(pulse.priority)}">
        <div><strong>${escapeHtml(target.name || pulse.postId)}</strong><small>${escapeHtml(CHANNEL_LABELS[target.channel] || target.channel || "Không xác định")}</small></div>
        <p>${escapeHtml(pulse.recommendation)}</p>
        <small>${escapeHtml(deltaText(pulse))}</small>
        <small>Snapshot mới nhất: ${escapeHtml(date(pulse.latest?.capturedAt))} · Mốc tiếp theo: ${escapeHtml(date(pulse.nextReviewAt))}</small>
      </article>`;
    }).join("")
    : '<p class="empty-card">Chưa có bài đã xuất bản để theo dõi traffic.</p>';
  document.querySelector("#posts").innerHTML = data.posts.length ? data.posts.map((post) => {
    const target = targetById[post.targetId] || {};
    const campaign = campaignById[post.campaignId] || {};
    return `<tr>
      <td><strong>${escapeHtml(target.name || post.targetId)}</strong><small>${escapeHtml(CHANNEL_LABELS[target.channel] || target.channel || "Không xác định")}</small></td>
      <td>${escapeHtml(campaign.name || post.campaignId)}</td>
      <td><span class="status-pill ${escapeHtml(post.status)}">${escapeHtml(statusLabel(post.status))}</span></td>
      <td>${post.approvedAt ? "Đã duyệt" : "Cần phê duyệt"}<small>${post.approvedBy ? escapeHtml(post.approvedBy) : ""}</small></td>
      <td>${post.publicationUrl ? `<a href="${escapeHtml(post.publicationUrl)}" target="_blank" rel="noreferrer">Mở bài đăng</a>` : "-"}<small>${escapeHtml(post.evidence || "")}</small></td>
      <td class="actions">${postActions(post, target)}</td>
    </tr>`;
  }).join("") : emptyRow(6, "Chưa có bài đăng");
  document.querySelector("#interactions").innerHTML = recentInteractions.length
    ? recentInteractions.map((interaction) => `<tr>
      <td>${escapeHtml(interaction.postId)}</td>
      <td>${escapeHtml(interaction.authorLabel)}<small>${escapeHtml(interaction.kind === "comment" ? "Bình luận" : interaction.kind)}</small></td>
      <td>${escapeHtml(interaction.text)}</td>
      <td><span class="status-pill ${escapeHtml(interaction.status)}">${escapeHtml(statusLabel(interaction.status))}</span><small>${escapeHtml(date(interaction.capturedAt))}</small></td>
    </tr>`).join("")
    : emptyRow(4, "Chưa ghi nhận tương tác");
  document.querySelector("#replies").innerHTML = recentReplies.length
    ? recentReplies.map((reply) => {
      const sources = (reply.groundingSources || []).map((source) => {
        const label = source.relativePath || source.path || source;
        const hash = source.sha256 ? ` · SHA-256 ${source.sha256.slice(0, 12)}` : "";
        return `${escapeHtml(label)}${escapeHtml(hash)}`;
      }).join("<br>");
      const interaction = interactionById[reply.interactionId];
      return `<tr>
        <td>${escapeHtml(interaction?.text || reply.interactionId)}</td>
        <td>${escapeHtml(reply.text)}</td>
        <td>${sources || "-"}<small>${escapeHtml(reply.groundingSummary || "")}</small></td>
        <td><span class="status-pill ${escapeHtml(reply.status)}">${escapeHtml(statusLabel(reply.status))}</span><small>${escapeHtml(date(reply.createdAt))}</small></td>
      </tr>`;
    }).join("")
    : emptyRow(4, "Chưa có bản nháp trả lời");
  document.querySelector("#metricSnapshots").innerHTML = latestMetricSnapshots.length
    ? latestMetricSnapshots.map((metric) => `<tr>
      <td>${escapeHtml(postById[metric.postId]?.id || metric.postId)}</td>
      <td>${escapeHtml(date(metric.capturedAt))}</td>
      <td>${number.format(metric.impressions)}</td><td>${number.format(metric.reactions)}</td>
      <td>${number.format(metric.comments)}</td><td>${number.format(metric.leads)}</td>
    </tr>`).join("")
    : emptyRow(6, "Chưa có snapshot chỉ số");
  document.querySelector("#audit").innerHTML = recentAudit.length
    ? recentAudit.map((event) => `<tr>
      <td>${number.format(event.revision)}</td><td>${escapeHtml(date(event.at))}</td>
      <td>${escapeHtml(event.actor)}</td><td>${escapeHtml(eventLabel(event.event))}</td>
    </tr>`).join("")
    : emptyRow(4, "Chưa có sự kiện kiểm toán");
}

document.querySelector("#refreshButton").addEventListener("click", () => load().catch(showError));
document.querySelector("#refreshButtonTop").addEventListener("click", () => load().catch(showError));
document.querySelector("#collectAllButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const results = await operatorFetch("/api/automation/collect-now", { method: "POST", body: "{}" });
    const succeeded = results.filter((item) => item.ok).length;
    showToast(`Đã kiểm tra ${results.length} bài: ${succeeded} thành công, ${results.length - succeeded} chưa cấu hình/không lấy được`);
    await load();
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector("#operatorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#operatorToken");
  const token = input.value.trim();
  if (!token) return showToast("Token vận hành đang trống", true);
  try {
    const response = await fetch("/api/operator/session", { headers: { authorization: `Bearer ${token}`, "x-agentic-actor": "dashboard-operator" } });
    if (!response.ok) throw new Error("Token không hợp lệ");
    sessionStorage.setItem("seedingOperatorToken", token);
    input.value = "";
    updateOperatorStatus();
    showToast("Đã kết nối phiên vận hành cục bộ");
  } catch (error) { showToast(error.message, true); }
});
document.querySelector("#disconnectButton").addEventListener("click", () => {
  sessionStorage.removeItem("seedingOperatorToken");
  updateOperatorStatus();
  showToast("Đã ngắt token khỏi session");
});
document.querySelector("#campaignsManager").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !dashboardData) return;
  const campaign = dashboardData.campaigns.find((item) => item.id === button.dataset.campaignId);
  if (!campaign) return;
  button.disabled = true;
  try {
    if (button.dataset.action === "keywords") {
      const keywords = window.prompt("Nhập danh sách từ khóa, cách nhau bằng dấu phẩy:", (campaign.keywords || []).map((item) => item.phrase).join(", "));
      if (keywords === null) return;
      const landingUrl = window.prompt("Landing page nhận traffic (có thể để trống):", campaign.landingUrl || "");
      if (landingUrl === null) return;
      await operatorFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: "PATCH", body: JSON.stringify({ keywords: keywords.split(","), landingUrl })
      });
      showToast("Đã cập nhật keyword engine cho chiến dịch");
    } else if (button.dataset.action === "artifact") {
      const name = window.prompt("Tên artifact/sản phẩm đã kiểm chứng:", "Artifact hằng ngày");
      if (name === null) return;
      const artifactPath = window.prompt("Đường dẫn file bên trong productRepo:", "");
      if (artifactPath === null) return;
      const evidence = window.prompt("Bằng chứng kiểm chứng (decode/frame/receipt):", "");
      if (evidence === null) return;
      await operatorFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/artifacts`, {
        method: "POST", body: JSON.stringify({ name, path: artifactPath, mediaType: "video/mp4", evidence })
      });
      showToast("Đã resolve, hash và đăng ký artifact");
    } else if (button.dataset.action === "story") {
      const artifacts = (dashboardData.recentArtifacts || []).filter((item) => item.campaignId === campaign.id);
      const artifactId = window.prompt("Artifact ID (có thể để trống):", artifacts[0]?.id || "");
      if (artifactId === null) return;
      const title = window.prompt("Tiêu đề story:", "Một workflow có bằng chứng");
      if (title === null) return;
      const angle = window.prompt("Góc nội dung:", "Từ sản phẩm thật đến quy trình có thể lặp lại");
      if (angle === null) return;
      const audience = window.prompt("Đối tượng:", "Builders và creators");
      if (audience === null) return;
      const callToAction = window.prompt("CTA:", "Bạn muốn xem phần nào được phân tích sâu?");
      if (callToAction === null) return;
      const sources = window.prompt("Các file grounding trong productRepo, cách nhau bằng dấu phẩy:", "README.md");
      if (sources === null) return;
      await operatorFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/stories`, {
        method: "POST", body: JSON.stringify({ artifactId: artifactId.trim() || null, title, angle, audience, callToAction, groundingSources: sources.split(",").map((value) => value.trim()).filter(Boolean) })
      });
      showToast("Đã tạo story và hash nguồn grounding");
    } else if (button.dataset.action === "schedule") {
      const name = window.prompt("Tên lịch:", "Sản phẩm và bản nháp hằng ngày");
      if (name === null) return;
      const localTime = window.prompt("Giờ chạy HH:mm:", "09:00");
      if (localTime === null) return;
      const channels = window.prompt("Kênh, cách nhau bằng dấu phẩy:", "facebook_group,threads,reddit,product_hunt,indie_hackers,linkedin,email");
      if (channels === null) return;
      await operatorFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/schedules`, {
        method: "POST", body: JSON.stringify({ name, localTime, timezone: "Asia/Saigon", channels: channels.split(",").map((value) => value.trim()).filter(Boolean) })
      });
      showToast("Đã tạo lịch draft-only; không có hành động đăng/gửi tự động");
    }
    await load();
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector("#stories").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-action="channel-draft"]');
  if (!button || !dashboardData) return;
  const story = (dashboardData.recentStories || []).find((item) => item.id === button.dataset.storyId);
  if (!story) return;
  const targets = dashboardData.targets.filter((target) => target.status !== "disabled");
  const variants = [];
  for (const target of targets) {
    const content = window.prompt(`Bản nháp cho ${CHANNEL_LABELS[target.channel] || target.channel} — ${target.name} (để trống để bỏ qua):`, "");
    if (content === null) return;
    if (content.trim()) variants.push({ targetId: target.id, content: content.trim(), language: target.locale || story.language || "en" });
  }
  if (!variants.length) return showToast("Chưa nhập bản nháp cho kênh nào", true);
  button.disabled = true;
  try {
    await operatorFetch(`/api/stories/${encodeURIComponent(story.id)}/channel-drafts`, { method: "POST", body: JSON.stringify({ variants }) });
    showToast(`Đã tạo ${variants.length} bản nháp theo kênh`);
    await load();
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector("#keywordPerformance").addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-action="keyword-metrics"]');
  if (!button || !dashboardData) return;
  const keyword = button.dataset.keyword;
  const current = dashboardData.keywordPerformance.find((item) => item.campaignId === button.dataset.campaignId && item.phrase === keyword)?.latest || {};
  const prompts = [["impressions", "Lượt hiển thị"], ["clicks", "Lượt nhấp"], ["leads", "Lead"], ["rank", "Thứ hạng (để trống nếu chưa đo)"]];
  const payload = { keyword, source: "dashboard-operator" };
  for (const [key, label] of prompts) {
    const value = window.prompt(`${label}:`, current[key] ?? "");
    if (value === null) return;
    payload[key] = key === "rank" && value.trim() === "" ? null : parseMetricInput(value || "0", label);
  }
  button.disabled = true;
  try {
    await operatorFetch(`/api/campaigns/${encodeURIComponent(button.dataset.campaignId)}/keywords/metrics`, { method: "POST", body: JSON.stringify(payload) });
    showToast("Đã ghi snapshot hiệu suất từ khóa");
    await load();
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector("#posts").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !dashboardData) return;
  const post = dashboardData.posts.find((item) => item.id === button.dataset.postId);
  const target = dashboardData.targets.find((item) => item.id === post?.targetId);
  if (!post) return;
  button.disabled = true;
  try {
    if (button.dataset.action === "approve") {
      await operatorFetch(`/api/posts/${encodeURIComponent(post.id)}/approve`, { method: "POST", body: "{}" });
      showToast("Đã phê duyệt bài đăng");
    } else if (button.dataset.action === "review") {
      await operatorFetch(`/api/posts/${encodeURIComponent(post.id)}/transition`, { method: "POST", body: JSON.stringify({ status: "needs_review" }) });
      showToast("Đã đưa bài về trạng thái cần duyệt");
    } else if (button.dataset.action === "prepare") {
      const plan = canPreparePublication(post, target);
      if (!plan.allowed) throw new Error(plan.reason);
      const opened = window.open("about:blank", "_blank");
      if (!opened) throw new Error("Chrome đang chặn cửa sổ mới");
      try {
        if (post.status === "approved") {
          await operatorFetch(`/api/posts/${encodeURIComponent(post.id)}/transition`, { method: "POST", body: JSON.stringify({ status: "queued" }) });
        }
        await navigator.clipboard.writeText(post.content);
        await operatorFetch(`/api/posts/${encodeURIComponent(post.id)}/transition`, { method: "POST", body: JSON.stringify({ status: "publishing" }) });
        opened.location.assign(plan.composerUrl);
      } catch (error) {
        opened.close();
        throw error;
      }
      showToast("Đã sao chép nội dung và mở đúng trang đăng. Hãy kiểm tra rồi bấm Đăng trên nền tảng.");
    } else if (button.dataset.action === "publish") {
      const publicationUrl = window.prompt("Dán permalink cụ thể của bài đã đăng:", post.publicationUrl || "");
      if (publicationUrl === null) return;
      const evidence = window.prompt("Nhập bằng chứng xác minh (ví dụ: tiêu đề/nội dung hiển thị và thời điểm kiểm tra):", "");
      if (evidence === null) return;
      await operatorFetch(`/api/posts/${encodeURIComponent(post.id)}/transition`, {
        method: "POST", body: JSON.stringify({ status: "published", publicationUrl, evidence })
      });
      showToast("Đã ghi nhận permalink và bằng chứng xuất bản");
    } else if (button.dataset.action === "metrics") {
      const latest = dashboardData.latestMetrics?.[post.id] || {};
      const labels = { impressions: "Lượt hiển thị", reactions: "Cảm xúc", comments: "Bình luận", shares: "Chia sẻ", clicks: "Lượt nhấp", leads: "Lead" };
      const payload = {};
      for (const [key, label] of Object.entries(labels)) {
        const value = window.prompt(`${label}:`, String(latest[key] || 0));
        if (value === null) return;
        if (value.trim() !== "") payload[key] = parseMetricInput(value, label);
      }
      payload.source = "dashboard-operator";
      await operatorFetch(`/api/posts/${encodeURIComponent(post.id)}/metrics`, { method: "POST", body: JSON.stringify(payload) });
      showToast("Đã ghi snapshot traffic mới");
    } else if (button.dataset.action === "collect") {
      await operatorFetch(`/api/posts/${encodeURIComponent(post.id)}/collect-metrics`, { method: "POST", body: "{}" });
      showToast("Đã lấy snapshot từ API chính thức");
    }
    await load();
  } catch (error) {
    showToast(error.message, true);
    await load().catch(() => undefined);
  } finally {
    button.disabled = false;
  }
});
function showError(error) { document.querySelector("#updatedAt").textContent = `Lỗi: ${error.message}`; }
setupTheme();
setupNavigation();
updateOperatorStatus();
load().catch(showError);
setInterval(() => load().catch(showError), 60_000);
