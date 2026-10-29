import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import {
  DEFAULT_PAGE_SIZE,
  clampPage,
  pageCountFor,
  paginateRows,
} from "./pagination.mjs"

type R = Record<string, any>
type MetricRow = [string, any, string]
type RankedRow = [string, any, number]

function usePagedRows<T>(
  rows: T[],
  identity: (row: T) => string,
  resetKey = "",
) {
  const [page, setPage] = useState(1)
  const rowIdentity = rows.map(identity).join("\u0000")
  const pageCount = pageCountFor(rows.length)
  useEffect(() => setPage(1), [resetKey, rowIdentity])
  useEffect(
    () => setPage((current) => clampPage(current, rows.length)),
    [pageCount, rows.length],
  )
  return { page, pageCount, rows: paginateRows(rows, page), setPage }
}

function Pagination({
  page,
  pageCount,
  total,
  setPage,
}: {
  page: number
  pageCount: number
  total: number
  setPage: (page: number) => void
}) {
  return (
    <nav className="table-pagination" aria-label="Phân trang bảng">
      <button
        type="button"
        onClick={() => setPage(page - 1)}
        disabled={page <= 1}
      >
        Trước
      </button>
      <span>
        Trang {page}/{pageCount}{" "}
        <small>
          · {total} mục · {DEFAULT_PAGE_SIZE} mỗi trang
        </small>
      </span>
      <button
        type="button"
        onClick={() => setPage(page + 1)}
        disabled={page >= pageCount}
      >
        Sau
      </button>
    </nav>
  )
}

const numberFormat = new Intl.NumberFormat("vi-VN")
const dateFormat = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
})
const platformTone: Record<string, string> = {
  "Facebook Groups": "#4f8cff",
  Reddit: "#ff6934",
  Threads: "#e9e9ee",
  "Product Hunt": "#ef7869",
  "Indie Hackers": "#78a6ff",
  LinkedIn: "#41a6e8",
  Email: "#ab8cff",
}

const channelLabels: Record<string, string> = {
  facebook_group: "Facebook Groups",
  threads: "Threads",
  reddit: "Reddit",
  product_hunt: "Product Hunt",
  indie_hackers: "Indie Hackers",
  linkedin: "LinkedIn",
  email: "Email",
}

const statusLabels: Record<string, string> = {
  draft: "Bản nháp",
  approved: "Đã duyệt",
  published: "Đã đăng",
  removed: "Đã gỡ",
  needs_review: "Cần xem lại",
  active: "Đang hoạt động",
  paused: "Tạm dừng",
  ready: "Sẵn sàng",
  checking: "Đang kiểm tra",
  blocked: "Bị chặn",
  pending: "Đang chờ",
  reviewed: "Đã rà soát",
  not_required: "Không yêu cầu",
  verified: "Đã xác minh",
  connected: "Đã kết nối",
  running: "Đang chạy",
  succeeded: "Thành công",
  failed: "Thất bại",
  publishing: "Đang đăng",
  processing: "Đang xử lý",
  queued: "Đang xếp hàng",
  measured: "Đã đo",
  unsupported: "Nền tảng không hỗ trợ",
}
const uiLabels: Record<string, string> = {
  "Growth intelligence": "Tăng trưởng thông minh",
  "Traffic Analytics": "Phân tích lưu lượng truy cập",
  "Engagement Analytics": "Phân tích tương tác",
  "Action Analytics": "Phân tích hành động",
  "Conversion Analytics": "Phân tích chuyển đổi",
  "Content Performance": "Hiệu quả nội dung",
  Platforms: "Nền tảng",
  Campaigns: "Chiến dịch",
  "Posts & Seeds": "Bài đăng & Seeds",
  Markets: "Thị trường",
  Audience: "Đối tượng",
  "Intelligence Center": "Trung tâm phân tích",
  Reports: "Báo cáo",
  Integrations: "Tích hợp",
  Settings: "Cài đặt",
  "Export data": "Xuất dữ liệu",
  "New seed": "Tạo bài seeding",
  "Create seed": "Tạo bài seeding",
  "New campaign": "Tạo chiến dịch",
  "Connect platform": "Kết nối nền tảng",
  "Configure signals": "Cấu hình tín hiệu",
  "Create report": "Tạo báo cáo",
  "Request integration": "Thêm tích hợp",
  "Save changes": "Lưu thay đổi",
  "No measured value": "Chưa có số liệu đo",
  "Measured state": "Trạng thái đã đo",
  "Published state": "Trạng thái đã đăng",
  "Dashboard state": "Trạng thái dashboard",
  "Snapshot evidence": "Bằng chứng snapshot",
  "Configured state": "Trạng thái cấu hình",
  "All posts": "Tất cả bài đăng",
  "Published posts": "Bài đã đăng",
  Approved: "Đã duyệt",
  "Measured posts": "Bài có số liệu",
  "All content": "Tất cả nội dung",
  "All platforms": "Tất cả nền tảng",
  "Community directory": "Danh bạ cộng đồng",
  "Audience growth": "Tăng trưởng đối tượng",
  "Audience attributes": "Đặc điểm đối tượng",
  "Known visitors": "Lượt truy cập đã nhận diện",
  "Returning visitors": "Lượt truy cập quay lại",
  "Device share": "Tỷ lệ theo thiết bị",
  "Channel reach": "Lượt hiển thị theo nền tảng",
  "Market performance": "Hiệu quả theo thị trường",
  "Platform × Market heatmap": "Bản đồ nhiệt nền tảng × thị trường",
  "Platform × measured performance": "Hiệu quả đo được theo nền tảng",
  "No measured values": "Chưa có số liệu đo",
  "No content": "Chưa có nội dung",
  "No permalink yet": "Chưa có liên kết bài đăng",
  "Unassigned target": "Chưa gán kênh",
  "Unknown channel": "Kênh chưa xác định",
  Unknown: "Chưa xác định",
  "Understand where measured visitors come from and which seeds are discoverable.":
    "Xem lượt hiển thị, lượt nhấp và bài seeding đang tiếp cận người xem.",
  "Measure reactions, comments and shares that platforms actually expose.":
    "Tổng hợp lượt cảm xúc, bình luận và chia sẻ mà nền tảng có cung cấp.",
  "Track high-intent behavior generated by the distribution activity.":
    "Theo dõi lượt nhấp và khách hàng tiềm năng được ghi nhận.",
  "Connect seeded content to measurable product outcomes without inventing attribution.":
    "Đối chiếu kết quả nội dung với chỉ số sản phẩm có dữ liệu xác thực.",
  "Latest measured snapshots from the local dashboard API":
    "Các số đo mới nhất được lưu từ dashboard.",
  "Ranked from measured dashboard data":
    "Xếp hạng theo số liệu dashboard đã đo.",
  "Open a channel for its measured post and readiness detail.":
    "Mở một nền tảng để xem bài đăng, số liệu và trạng thái sẵn sàng.",
  "Current distribution campaigns from the local registry.":
    "Chiến dịch phân phối hiện có trong dữ liệu dashboard.",
  "Measure every seeded post by reach, evidence and downstream outcomes.":
    "Theo dõi lượt tiếp cận, bằng chứng số liệu và kết quả của từng bài seeding.",
  "Scheduled and on-demand growth intelligence derived from the local state.":
    "Báo cáo theo lịch hoặc tạo theo yêu cầu từ dữ liệu dashboard hiện có.",
  "Inspect configured distribution targets and their readiness state.":
    "Kiểm tra các kênh phân phối đã cấu hình và trạng thái hoạt động.",
  "Inspect local runtime configuration and data coverage.":
    "Xem cấu hình dashboard và những chỉ số đang có dữ liệu.",
  "Read-only values from the connected dashboard state.":
    "Thông tin chỉ đọc lấy từ dashboard đang kết nối.",
  "Runtime value": "Giá trị vận hành",
  "Read-only runtime state": "Trạng thái vận hành · chỉ đọc",
  "API dashboard": "Dữ liệu dashboard",
  "state records": "bản ghi trạng thái",
  "published state": "trạng thái đã đăng",
  configured: "đã cấu hình",
  "snapshot evidence": "bài có snapshot số liệu",
  "All signals": "Tất cả tín hiệu",
  Due: "Đến hạn rà soát",
  Engage: "Cần tương tác",
  "Active signals": "Tín hiệu đang hoạt động",
  "Open interactions": "Tương tác đang mở",
  "Pending replies": "Phản hồi đang chờ",
  "Runtime state": "Trạng thái vận hành",
  Signal: "Tín hiệu",
  "Evidence signal": "Tín hiệu từ dữ liệu",
  "No additional description": "Chưa có mô tả bổ sung",
  "Inspect evidence →": "Xem bằng chứng →",
  Review: "Cần rà soát",
  "No active signals are present in the current dashboard state.":
    "Chưa có tín hiệu đang hoạt động trong dữ liệu dashboard hiện tại.",
  "Configured schedules": "Lịch đã cấu hình",
  "Active schedules": "Lịch đang hoạt động",
  "Verified artifacts": "Tệp đầu ra đã xác minh",
  "Last update": "Cập nhật gần nhất",
  "Schedule state": "Trạng thái lịch",
  "Artifact registry": "Danh mục tệp đầu ra",
  "Dashboard API": "API dashboard",
  Connected: "Đã kết nối",
  Manage: "Quản lý",
  Inspect: "Kiểm tra",
  "No mode": "Chưa có chế độ",
  "Open runtime settings": "Mở cài đặt vận hành",
  "Recent output registry entries associated with production runs.":
    "Các tệp đầu ra gần đây được tạo trong những lượt chạy sản phẩm.",
  Timezone: "Múi giờ",
  "Dashboard revision": "Phiên bản dữ liệu dashboard",
  "Updated at": "Cập nhật lúc",
  Targets: "Kênh phân phối",
  Posts: "Bài đăng",
  Snapshots: "Bản ghi số liệu",
  Automation: "Tự động hóa",
  Coverage: "Mức độ bao phủ dữ liệu",
  Production: "Tạo sản phẩm",
  "Browser tracking": "Theo dõi bằng trình duyệt",
  Schedules: "Lịch chạy",
  Impressions: "Lượt hiển thị",
  Engagements: "Lượt tương tác",
  Clicks: "Lượt nhấp",
  Leads: "Khách hàng tiềm năng",
  "Posts with clicks": "Bài có lượt nhấp",
  "Posts with leads": "Bài có khách hàng tiềm năng",
  "Posts with impressions": "Bài có lượt hiển thị",
  "Posts with engagements": "Bài có tương tác",
  Reactions: "Lượt cảm xúc",
  Comments: "Bình luận",
  Shares: "Lượt chia sẻ",
  Published: "Đã đăng",
  "Approved state": "Trạng thái đã duyệt",
  "State records": "Bản ghi trạng thái",
  "No measured market field": "Nguồn chưa cung cấp dữ liệu thị trường",
  "No measured audience field": "Nguồn chưa cung cấp dữ liệu đối tượng",
  "No measured audience series available.":
    "Chưa có chuỗi số liệu về đối tượng theo thời gian.",
  "No audience snapshots are present in the dashboard API.":
    "API dashboard hiện chưa có bản ghi đo lường đối tượng.",
  "No country, device or cohort data available.":
    "Chưa có dữ liệu theo quốc gia, thiết bị hoặc nhóm người xem.",
  "These fields are intentionally not guessed from post or platform metadata.":
    "Các thông tin này không được suy đoán từ bài đăng hoặc tên nền tảng.",
  "Compare distribution performance across regions when the connected sources provide market dimensions.":
    "So sánh hiệu quả phân phối theo khu vực nếu nguồn kết nối có cung cấp dữ liệu thị trường.",
  "The current local API does not expose market or country dimensions, so this view stays truthful.":
    "API hiện chưa có trường quốc gia hoặc khu vực, vì vậy dashboard không tự tạo số liệu thay thế.",
  "No market dimension was inferred from platform names.":
    "Không suy đoán thị trường dựa trên tên nền tảng.",
  "No measured market breakdown available.":
    "Chưa có số liệu thị trường để phân tích.",
  "Awaiting source field": "Đang chờ dữ liệu từ nguồn",
  "Connect a traffic source with market-level evidence to populate this Figma section.":
    "Khu vực này sẽ có dữ liệu khi nguồn lưu lượng cung cấp số liệu theo thị trường.",
  "Understand who visits, returns and converts when audience attributes are measured.":
    "Xem đặc điểm người xem và lượt quay lại khi nền tảng cung cấp các chỉ số này.",
  "Detected opportunities, anomalies and distribution risks from real evidence.":
    "Cơ hội, bất thường và rủi ro phân phối được phát hiện từ dữ liệu thực.",
  "Platform performance": "Hiệu quả theo nền tảng",
  "Campaign list": "Danh sách chiến dịch",
  "Campaign → Target → Post → Evidence":
    "Chiến dịch → Kênh → Bài đăng → Số liệu",
  "Operational lifecycle from the real local dashboard state":
    "Quy trình vận hành từ dữ liệu dashboard thực tế.",
  Measured: "Có số liệu",
  "Top measured content": "Nội dung có số liệu cao nhất",
  "Channels by impressions": "Nền tảng theo lượt hiển thị",
  "Measured snapshots only": "Chỉ gồm snapshot đã đo",
  "All statuses": "Tất cả trạng thái",
  "All products": "Tất cả sản phẩm",
  "Newest first": "Mới nhất trước",
  "Most engagement": "Nhiều tương tác nhất",
  "Most clicks": "Nhiều lượt nhấp nhất",
  "Most leads": "Nhiều khách hàng tiềm năng nhất",
  "Search platforms...": "Tìm nền tảng...",
  "Search posts, accounts, communities...":
    "Tìm bài đăng, tài khoản, cộng đồng...",
  "Open post ↗": "Mở bài đăng ↗",
  "Copy link": "Sao chép liên kết",
  Join: "Tham gia",
  Post: "Bài đăng",
  Platform: "Nền tảng",
  Status: "Trạng thái",
  Updated: "Cập nhật",
  Campaign: "Chiến dịch",
  Objective: "Mục tiêu",
  "Channel detail from the local dashboard state.":
    "Chi tiết nền tảng từ dữ liệu dashboard hiện tại.",
  "No readiness summary is available.": "Chưa có mô tả trạng thái sẵn sàng.",
  "Measured if available": "Hiển thị khi nguồn có cung cấp số liệu",
  "Channel measurements": "Số liệu theo nền tảng",
  "Snapshots associated with this configured target":
    "Các snapshot thuộc kênh đã cấu hình này",
  "Channel contribution": "Đóng góp theo nền tảng",
  "Channel posts": "Bài đăng trên nền tảng",
  "All campaigns": "Tất cả chiến dịch",
  "Edit campaign": "Chỉnh sửa chiến dịch",
  "No objective recorded": "Chưa ghi nhận mục tiêu",
  "Campaign measurements": "Số liệu chiến dịch",
  "Snapshots associated with this campaign":
    "Các snapshot thuộc chiến dịch này",
  "Campaign posts": "Bài đăng của chiến dịch",
  "Plan, monitor and compare real distribution initiatives.":
    "Lập kế hoạch, theo dõi và so sánh các hoạt động phân phối.",
  Active: "Đang hoạt động",
  "Campaign state": "Trạng thái chiến dịch",
  Readiness: "Mức độ sẵn sàng",
  "Post / seed": "Bài đăng / seeding",
  "No asset path": "Chưa có đường dẫn tệp",
  "Chrome / verified": "Đã xác minh trên trình duyệt",
  "Crawl registry": "Danh sách đã thu thập",
  "Configured channels": "Nền tảng đã cấu hình",
  "Measured impressions": "Lượt hiển thị đã đo",
  impressions: "lượt hiển thị",
  "Most impressions": "Nhiều lượt hiển thị nhất",
  "Target not recorded": "Chưa ghi nhận kênh",
  "Open ↗": "Mở ↗",
  "All channels": "Tất cả nền tảng",
  Workspace: "Không gian làm việc",
  Data: "Dữ liệu",
  Asset: "Tệp sản phẩm",
}
function uiText(value: any) {
  return uiLabels[String(value)] || String(value ?? "")
}

function labelChannel(value: any) {
  return (
    channelLabels[String(value || "")] || String(value || "Kênh chưa xác định")
  )
}
function labelStatus(value: any) {
  return statusLabels[String(value || "")] || String(value || "Unknown")
}
function boundedDisplayText(value: any, fallback = "UNKNOWN", max = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return fallback
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
function asNumber(value: any): number | null {
  const parsed = Number(value)
  return value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(parsed)
    ? null
    : parsed
}
function formatValue(value: any, suffix = "") {
  const parsed = asNumber(value)
  return parsed === null ? "—" : `${numberFormat.format(parsed)}${suffix}`
}
function formatDate(value: any) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date)
}
function slug(value: any) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
}
function validUrl(value: any) {
  try {
    const url = new URL(String(value))
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""
  } catch {
    return ""
  }
}
function postTimestamp(post: R) {
  const value =
    post?.updatedAt ||
    post?.publishedAt ||
    post?.createdAt ||
    post?.queuedAt ||
    post?.approvedAt
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}
function targetLabel(target: R | undefined) {
  return (
    target?.name ||
    target?.account ||
    (target?.channel ? labelChannel(target.channel) : "Chưa gán kênh")
  )
}
const productTracks = [
  {
    id: "3d",
    label: "Sản phẩm 3D",
    repo: "design-os-3d-blender",
    accent: "#7c9cff",
  },
  {
    id: "vibe",
    label: "Sản phẩm Vibe Code",
    repo: "design-os-code2flow",
    accent: "#75e0ba",
  },
  {
    id: "svg",
    label: "Sản phẩm SVG Animation",
    repo: "design-os-svg-animation",
    accent: "#ffb86b",
  },
]
function productTrackFor(data: R, post: R) {
  const campaign = (data.campaigns || []).find(
    (item: R) => item.id === post.campaignId,
  )
  const source = `${campaign?.name || ""} ${post.content || ""}`.toLowerCase()
  if (
    source.includes("vibe-code") ||
    source.includes("code2flow") ||
    source.includes("signalops")
  )
    return productTracks[1]
  if (
    source.includes("svg animation") ||
    source.includes("svg-animation") ||
    source.includes("sentinel camera in svg") ||
    source.includes("svganimation")
  )
    return productTracks[2]
  return productTracks[0]
}
function productRepoLabel(data: R, post: R) {
  return productTrackFor(data, post).repo
}
function postsFor(data: R, targetId?: string) {
  return (data.posts || []).filter(
    (post: R) => !targetId || post.targetId === targetId,
  )
}
function targetFor(data: R, targetId?: string) {
  return (data.targets || []).find((target: R) => target.id === targetId)
}
function snapshotsFor(data: R, postId?: string) {
  return (data.latestMetricSnapshots || []).filter(
    (snapshot: R) => !postId || snapshot.postId === postId,
  )
}
function sumMeasured(rows: R[], key: string) {
  const values = rows
    .map((row) => asNumber(row[key]))
    .filter((value): value is number => value !== null)
  return values.length
    ? values.reduce((total, value) => total + value, 0)
    : null
}
function metricForPost(data: R, post: R, key: string) {
  const rows = snapshotsFor(data, post.id)
  if (key === "engagements") {
    const values = ["reactions", "comments", "shares"]
      .map((part) => sumMeasured(rows, part))
      .filter((value): value is number => value !== null)
    return values.length
      ? values.reduce((total, value) => total + value, 0)
      : null
  }
  return sumMeasured(rows, key)
}
function metricForTarget(data: R, targetId: string, key: string) {
  return sumMeasured(
    postsFor(data, targetId).map((post: R) => ({
      value: metricForPost(data, post, key),
    })),
    "value",
  )
}
function metricForChannel(data: R, channel: string, key: string) {
  const targetIds = (data.targets || [])
    .filter((target: R) => target.channel === channel)
    .map((target: R) => target.id)
  const rows = (data.posts || [])
    .filter((post: R) => targetIds.includes(post.targetId))
    .map((post: R) => ({ value: metricForPost(data, post, key) }))
  return sumMeasured(rows, "value")
}
function engagementTotal(data: R) {
  const values = [
    data.totals?.reactions,
    data.totals?.comments,
    data.totals?.shares,
  ]
    .map(asNumber)
    .filter((value): value is number => value !== null)
  return values.length
    ? values.reduce((total, value) => total + value, 0)
    : null
}
function metricStatus(data: R, key: string) {
  const coverage = data.metricCoverage?.[key]
  return coverage?.measured
    ? `${coverage.measured} measured`
    : "No measured value"
}
const trackingFields = [
  "impressions",
  "reactions",
  "comments",
  "shares",
  "clicks",
  "leads",
]
const trackingLabels: Record<string, string> = {
  impressions: "Impressions / views",
  reactions: "Reactions / likes",
  comments: "Comments / replies",
  shares: "Shares / reposts",
  clicks: "Clicks",
  leads: "Leads",
}
function coverageForPost(data: R, post: R, key: string) {
  return snapshotsFor(data, post.id)[0]?.coverage?.[key] || "unknown"
}
function trackingState(data: R, post: R) {
  const snapshot = snapshotsFor(data, post.id)[0]
  if (!snapshot) return { label: "Chưa chạy checkpoint", tone: "pending" }
  const missing = trackingFields.filter(
    (field) =>
      !["measured", "unknown", "unsupported"].includes(
        snapshot.coverage?.[field] || "unknown",
      ),
  )
  if (missing.length)
    return { label: `Thiếu coverage ${missing.length} field`, tone: "blocked" }
  const unmeasured = trackingFields.filter(
    (field) => snapshot.coverage?.[field] !== "measured",
  )
  return unmeasured.length
    ? {
        label: `Đã kiểm tra · ${unmeasured.length} field chưa đo`,
        tone: "unknown",
      }
    : { label: "Đã đo đủ 6 field", tone: "ready" }
}
function rowMetric(data: R, key: string) {
  if (key === "engagements") return engagementTotal(data)
  return asNumber(data.totals?.[key])
}
function measuredPosts(data: R) {
  return (data.posts || []).filter((post: R) =>
    snapshotsFor(data, post.id).some((snapshot: R) =>
      [
        "impressions",
        "reactions",
        "comments",
        "shares",
        "clicks",
        "leads",
      ].some((key) => asNumber(snapshot[key]) !== null),
    ),
  ).length
}
function channelStats(data: R) {
  return (data.channels || []).map((channel: R) => {
    const target = (data.targets || []).find(
      (item: R) => item.channel === channel.id,
    )
    return {
      ...channel,
      label: labelChannel(channel.id),
      target,
      impressions: metricForChannel(data, channel.id, "impressions"),
      engagements: metricForChannel(data, channel.id, "engagements"),
      clicks: metricForChannel(data, channel.id, "clicks"),
      leads: metricForChannel(data, channel.id, "leads"),
    }
  })
}

export function Mark({ name }: { name: string }) {
  const label = String(name || "?")
  const normalized = label.toLowerCase().replace(/[^a-z]/g, "")
  const file = normalized.includes("facebook")
    ? "facebook"
    : normalized.includes("threads")
      ? "threads"
      : normalized.includes("reddit")
        ? "reddit"
        : normalized.includes("producthunt")
          ? "product-hunt"
          : normalized.includes("indiehackers")
            ? "indie-hackers"
            : normalized.includes("linkedin")
              ? "linkedin"
              : normalized.includes("email")
                ? "email"
                : ""
  const [failed, setFailed] = useState(false)
  const initial =
    label === "Product Hunt"
      ? "P"
      : label === "Indie Hackers"
        ? "I"
        : label === "Facebook Groups"
          ? "F"
          : label[0]
  return (
    <span
      className="platform-mark"
      style={
        { "--platform": platformTone[label] || "#8c8c9a" } as CSSProperties
      }
      aria-label={label}
      title={label}
    >
      {file && !failed ? (
        <img
          src={`/platforms/${file}.svg`}
          alt=""
          aria-hidden="true"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  )
}

function downloadDashboard(data: R) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `growth-dashboard-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function PageHeader({
  data,
  title,
  subtitle,
  action = "Export data",
}: {
  data: R
  title: string
  subtitle: string
  action?: string
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const scopeLabel =
    ({
      today: "Hôm nay",
      "7d": "7 ngày",
      "30d": "30 ngày",
      all: "Toàn bộ",
    } as Record<string, string>)[data.scope?.period] || "Phạm vi hiện tại"
  const actionKey = action.toLowerCase()
  const onAction = () => {
    if (actionKey.includes("export") || actionKey.includes("save"))
      return downloadDashboard(data)
    if (actionKey.includes("seed")) return navigate("/posts")
    if (actionKey.includes("campaign")) return navigate("/campaigns")
    if (actionKey.includes("integration")) return navigate("/integrations")
    if (actionKey.includes("report")) return navigate("/reports")
    if (actionKey.includes("signal")) return navigate("/signals")
    return navigate(location.pathname)
  }
  return (
    <>
      <header className="topbar routed-head">
        <div>
          <h1>{uiText(title)}</h1>
          <p>{uiText(subtitle)}</p>
        </div>
        <div className="header-actions">
          <span className="sync-text">
            <span className="live-dot" />
            Cập nhật {formatDate(data.updatedAt)}
          </span>
          <span className="status ready">{scopeLabel}</span>
          <button type="button" className="primary-button" onClick={onAction}>
            {uiText(action)}
          </button>
        </div>
      </header>
      <div className="subpage-filters">
        <button
          type="button"
          className={
            location.pathname === "/posts" && !location.search ? "active" : ""
          }
          onClick={() => navigate("/posts")}
        >
          Tất cả bài
        </button>
        <button
          type="button"
          onClick={() => navigate("/posts?status=published")}
        >
          Bài đã đăng
        </button>
        <button type="button" onClick={() => navigate("/platforms")}>
          Nền tảng & cộng đồng
        </button>
        <span />
        <small>Bộ lọc chung nằm phía trên toàn dashboard</small>
      </div>
    </>
  )
}

function MetricTiles({ metrics }: { metrics: MetricRow[] }) {
  const navigate = useNavigate()
  const destination = (name: string) => {
    const label = name.toLowerCase()
    if (label.includes("impression") || label.includes("traffic"))
      return "/traffic"
    if (
      label.includes("engagement") ||
      label.includes("reaction") ||
      label.includes("comment") ||
      label.includes("share")
    )
      return "/engagement"
    if (label.includes("click") || label.includes("action")) return "/actions"
    if (label.includes("lead") || label.includes("conversion"))
      return "/conversions"
    if (
      label.includes("market") ||
      label.includes("country") ||
      label.includes("regional")
    )
      return "/markets"
    if (
      label.includes("audience") ||
      label.includes("visitor") ||
      label.includes("device")
    )
      return "/audience"
    if (
      label.includes("signal") ||
      label.includes("interaction") ||
      label.includes("reply")
    )
      return "/signals"
    if (
      label.includes("schedule") ||
      label.includes("artifact") ||
      label.includes("report")
    )
      return "/reports"
    if (label.includes("approved")) return "/posts?status=approved"
    if (label.includes("draft")) return "/posts?status=draft"
    if (label.includes("campaign")) return "/campaigns"
    if (label.includes("platform") || label.includes("target"))
      return "/platforms"
    if (label.includes("published")) return "/posts?status=published"
    return "/posts"
  }
  return (
    <div className={`route-metrics ${metrics.length > 6 ? "many" : ""}`}>
      {metrics.map(([name, value, meta]) => (
        <button
          type="button"
          className="kpi-card kpi-action"
          key={name}
          onClick={() => navigate(destination(name))}
        >
          <div className="kpi-label">
            {uiText(name)}
            <span>Chi tiết ↗</span>
          </div>
          <div className="kpi-main">
            <strong>
              {typeof value === "string" ? value : formatValue(value)}
            </strong>
          </div>
          <div className="kpi-meta">
            <span
              className={
                meta === "No measured value" || meta === "Chưa đo"
                  ? "negative"
                  : "positive"
              }
            >
              {uiText(meta)}
            </span>
            <span>Dữ liệu dashboard</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function TrendPanel({
  data,
  title,
  subtitle,
  primaryKey = "impressions",
  secondaryKey = "clicks",
  labels = ["Impressions", "Clicks"],
}: {
  data: R
  title: string
  subtitle: string
  primaryKey?: string
  secondaryKey?: string
  labels?: string[]
}) {
  const primary = (data.posts || [])
    .map((post: R) => ({
      post,
      value: asNumber(metricForPost(data, post, primaryKey)),
      secondary: asNumber(metricForPost(data, post, secondaryKey)),
      target: targetFor(data, post.targetId),
    }))
    .filter((item: R) => item.value !== null)
    .sort((a: R, b: R) => b.value - a.value)
    .slice(0, 8)
  const max = Math.max(1, ...primary.map((item: R) => item.value))
  const safeTitle = title
    .replace(/\s+over time/gi, " · theo bài")
    .replace(/\s+trend/gi, " · số đo mới nhất")
  return (
    <section className="panel route-trend">
      <div className="panel-head">
        <div>
          <h2>{uiText(safeTitle)}</h2>
          <p>
            {primary.length} bài có chỉ số đo · {uiText(subtitle)} · snapshot
            mới nhất theo bài, không phải chuỗi lịch sử
          </p>
        </div>
        <span className="status ready">Dữ liệu đo</span>
      </div>
      {primary.length ? (
        <div className="traffic-bars">
          {primary.map(({ post, value, secondary: other, target }: R) => (
            <div className="traffic-bar-row" key={post.id}>
              <span className="traffic-bar-label">
                <b>
                  {String(post.content || "Bài không có nội dung")
                    .split("\n")[0]
                    .slice(0, 76)}
                </b>
                <small>
                  <Mark name={labelChannel(target?.channel)} />{" "}
                  {labelChannel(target?.channel)}
                </small>
              </span>
              <span className="traffic-bar-track">
                <i style={{ width: `${Math.max(3, (value / max) * 100)}%` }} />
              </span>
              <strong>{formatValue(value)}</strong>
              {other !== null ? (
                <small className="traffic-secondary">
                  {uiText(labels[1])} {formatValue(other)}
                </small>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          Chưa có {labels[0].toLowerCase()} được đo trong phạm vi này.
        </div>
      )}
    </section>
  )
}

function RankedPanel({
  data,
  title,
  metric = "impressions",
  empty = "No measured values",
}: {
  data: R
  title: string
  metric?: string
  empty?: string
}) {
  const rows: RankedRow[] = channelStats(data)
    .map((item: R) => [item.label, item[metric], 0])
    .filter((item: RankedRow) => asNumber(item[1]) !== null)
    .sort(
      (a: RankedRow, b: RankedRow) =>
        (asNumber(b[1]) || 0) - (asNumber(a[1]) || 0),
    )
    .slice(0, 6)
  const max = Math.max(1, ...rows.map((row) => asNumber(row[1]) || 0))
  return (
    <section className="panel ranked-panel">
      <div className="panel-head">
        <div>
          <h2>{uiText(title)}</h2>
          <p>Xếp hạng theo số liệu dashboard đã đo.</p>
        </div>
        <span className="status ready">
          {rows.length ? `${rows.length} mục` : "Chưa có số liệu"}
        </span>
      </div>
      {rows.length ? (
        <div className="rank-bars">
          {rows.map(([name, value], index) => (
            <div key={name}>
              <span>{index + 1}</span>
              <b>{name}</b>
              <i>
                <em
                  style={{ width: `${((asNumber(value) || 0) / max) * 100}%` }}
                />
              </i>
              <strong>{formatValue(value)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">{empty}</div>
      )}
    </section>
  )
}

export function TrafficSourcesPanel({ data }: { data: R }) {
  const colors = [
    "#8173e8",
    "#35a7df",
    "#f06b43",
    "#35c99a",
    "#e5a84c",
    "#d46bb3",
    "#8394a8",
  ]
  const measuredRows = (source: R) =>
    channelStats(source)
      .map((item: R) => ({ ...item, value: asNumber(item.impressions) }))
      .filter((item: R) => item.value !== null && item.value > 0)
      .sort((a: R, b: R) => b.value - a.value)
  const scopedRows = measuredRows(data)
  const fallbackRows = scopedRows.length
    ? []
    : measuredRows(data.trafficSourceFallback || {})
  const rows = scopedRows.length ? scopedRows : fallbackRows
  const showingFallback = scopedRows.length === 0 && fallbackRows.length > 0
  const total = rows.reduce((sum: number, item: R) => sum + item.value, 0)
  const [hoveredSource, setHoveredSource] = useState<R | "all" | null>(null)
  let cursor = 0
  const gradient = rows
    .map((item: R, index: number) => {
      const from = cursor
      cursor += (item.value / total) * 100
      return `${colors[index % colors.length]} ${from.toFixed(2)}% ${cursor.toFixed(2)}%`
    })
    .join(", ")
  return (
    <section
      className={`panel traffic-sources${
        showingFallback ? " has-fallback" : ""
      }`}
    >
      <div className="panel-head">
        <div>
          <h2>Nguồn lưu lượng truy cập</h2>
          <p>
            {showingFallback
              ? "Bộ lọc hiện tại chưa có lượt hiển thị; đang dùng số liệu tất cả nền tảng trong cùng khoảng thời gian để tham khảo."
              : "Tỷ trọng lượt hiển thị đã đo theo nền tảng trong phạm vi đang chọn."}
          </p>
        </div>
        <span className="status ready">
          {showingFallback
            ? "Dữ liệu tham khảo"
            : `${rows.length} nguồn có số đo`}
        </span>
      </div>
      {total > 0 ? (
        <div
          className="traffic-sources-body"
          onMouseLeave={() => setHoveredSource(null)}
        >
          <div
            className="traffic-donut"
            role="img"
            aria-label={`Phân bố ${formatValue(total)} impressions đã đo theo nền tảng`}
            tabIndex={0}
            onMouseEnter={() => setHoveredSource("all")}
            onBlur={() => setHoveredSource(null)}
            onFocus={() => setHoveredSource("all")}
            style={{ background: `conic-gradient(${gradient})` }}
          >
            <div>
              <strong>{formatValue(total)}</strong>
              <small>lượt hiển thị</small>
            </div>
          </div>
          <div className="traffic-source-legend">
            {rows.map((item: R, index: number) => (
              <div
                key={item.id}
                tabIndex={0}
                aria-label={`${item.label}: ${formatValue(item.value)} lượt hiển thị, ${((item.value / total) * 100).toFixed(1)} phần trăm`}
                onMouseEnter={() => setHoveredSource(item)}
                onMouseLeave={() => setHoveredSource(null)}
                onFocus={() => setHoveredSource(item)}
                onBlur={() => setHoveredSource(null)}
              >
                <Mark name={item.label} />
                <span>
                  <b>{item.label}</b>
                  <small>
                    {((item.value / total) * 100).toFixed(1)}% ·{" "}
                    {formatValue(item.value)}
                  </small>
                </span>
                <i style={{ background: colors[index % colors.length] }} />
              </div>
            ))}
          </div>
          {hoveredSource ? (
            <div className="traffic-hover-tooltip" role="tooltip">
              {hoveredSource === "all" ? (
                <>
                  <b>
                    {showingFallback
                      ? "Số liệu tham khảo"
                      : "Phân bổ lượt hiển thị"}
                  </b>
                  {rows.map((item: R) => (
                    <span key={item.id}>
                      <i
                        style={{
                          background:
                            colors[rows.indexOf(item) % colors.length],
                        }}
                      />
                      <strong>{item.label}</strong>
                      <small>
                        {formatValue(item.value)} lượt ·{" "}
                        {((item.value / total) * 100).toFixed(1)}%
                      </small>
                    </span>
                  ))}
                </>
              ) : (
                <>
                  <b>{hoveredSource.label}</b>
                  <span>
                    <strong>
                      {formatValue(hoveredSource.value)} lượt hiển thị
                    </strong>
                    <small>
                      {((hoveredSource.value / total) * 100).toFixed(1)}% tổng
                      lưu lượng trong phạm vi này
                    </small>
                  </span>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-state">
          Chưa có lượt hiển thị được đo theo nền tảng trong phạm vi này.
        </div>
      )}
      <p className="traffic-source-note">
        Chỉ cộng lượt hiển thị có bộ đếm; đây không phải số người xem duy nhất
        hoặc nguồn truy cập referral/UTM.
      </p>
    </section>
  )
}

type SeedRow = {
  post: R
  target: R | undefined
  impressions: any
  engagements: any
  clicks: any
  leads: any
}
function metricCell(value: any, label: string) {
  return asNumber(value) === null ? (
    <span
      className="metric-unknown"
      title={`${label}: chưa có snapshot đo lường từ nền tảng`}
    >
      Chưa đo
    </span>
  ) : (
    formatValue(value)
  )
}

function SeedsTable({
  data,
  title = "Top measured content",
  onRow,
}: {
  data: R
  title?: string
  onRow?: (post: R) => void
}) {
  const rows: SeedRow[] = [...(data.posts || [])]
    .map((post: R) => ({
      post,
      target: targetFor(data, post.targetId),
      impressions: metricForPost(data, post, "impressions"),
      engagements: metricForPost(data, post, "engagements"),
      clicks: metricForPost(data, post, "clicks"),
      leads: metricForPost(data, post, "leads"),
    }))
    .sort(
      (a: SeedRow, b: SeedRow) => postTimestamp(b.post) - postTimestamp(a.post),
    )
  const paged = usePagedRows(rows, (row) => row.post.id, title)
  const [showColumns, setShowColumns] = useState(false)
  return (
    <section className="panel route-full">
      <div className="panel-head">
        <div>
          <h2>{uiText(title)}</h2>
          <p>
            Nhấp vào một dòng để xem bài, repo, link gốc và bằng chứng đo lường.
            “Chưa đo” nghĩa là nền tảng chưa cung cấp counter.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setShowColumns((visible) => !visible)}
        >
          {showColumns ? "Ẩn danh sách cột" : "Cột đang hiển thị"}
        </button>
      </div>
      {showColumns && (
        <div className="column-hint">
          Nền tảng · Bài đăng / seeding · Trạng thái · Lượt hiển thị · Lượt
          tương tác · Lượt nhấp · Khách hàng tiềm năng · Cập nhật
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "Platform",
                "Post / seed",
                "Status",
                "Impressions",
                "Engagements",
                "Clicks",
                "Leads",
                "Updated",
              ].map((head) => (
                <th key={head}>{uiText(head)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.rows.map(
              ({ post, target, impressions, engagements, clicks, leads }) => (
                <tr
                  key={post.id}
                  onClick={() => onRow?.(post)}
                  className={onRow ? "clickable" : ""}
                >
                  <td>
                    <span className="platform-cell">
                      <Mark name={labelChannel(target?.channel)} />
                      <b>{labelChannel(target?.channel)}</b>
                    </span>
                  </td>
                  <td>
                    <span className="post-title">
                      {String(post.content || "No content")
                        .split("\n")[0]
                        .slice(0, 90)}
                      <small>{post.assetPath || "Chưa có đường dẫn tệp"}</small>
                    </span>
                  </td>
                  <td>
                    <span className={`status ${slug(post.status)}`}>
                      {labelStatus(post.status)}
                    </span>
                  </td>
                  <td>{metricCell(impressions, "Impressions")}</td>
                  <td>{metricCell(engagements, "Engagements")}</td>
                  <td>{metricCell(clicks, "Clicks")}</td>
                  <td>{metricCell(leads, "Leads")}</td>
                  <td>{formatDate(post.updatedAt || post.publishedAt)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={paged.page}
        pageCount={paged.pageCount}
        total={rows.length}
        setPage={paged.setPage}
      />
    </section>
  )
}

function MetricPage({
  data,
  type,
  onRow,
}: {
  data: R
  type: "traffic" | "engagement" | "actions" | "conversions"
  onRow?: (post: R) => void
}) {
  const definitions: Record<string, {
    title: string
    subtitle: string
    metrics: MetricRow[]
    primary: string
    secondary: string
    labels: string[]
    ranked: string
  }> = {
    traffic: {
      title: "Traffic Analytics",
      subtitle:
        "Xem lượt hiển thị, lượt nhấp và bài seeding đang tiếp cận người xem.",
      metrics: [
        [
          "Impressions",
          rowMetric(data, "impressions"),
          metricStatus(data, "impressions"),
        ],
        ["Clicks", rowMetric(data, "clicks"), metricStatus(data, "clicks")],
        ["Published posts", data.statuses?.published, "Published state"],
        ["Measured posts", measuredPosts(data), "Measured state"],
        ["Tracked channels", data.channels?.length, "Configured state"],
      ],
      primary: "impressions",
      secondary: "clicks",
      labels: ["Impressions", "Clicks"],
      ranked: "impressions",
    },
    engagement: {
      title: "Engagement Analytics",
      subtitle:
        "Tổng hợp lượt cảm xúc, bình luận và chia sẻ mà nền tảng có cung cấp.",
      metrics: [
        ["Engagements", engagementTotal(data), metricStatus(data, "reactions")],
        ["Reactions", data.totals?.reactions, metricStatus(data, "reactions")],
        ["Comments", data.totals?.comments, metricStatus(data, "comments")],
        ["Shares", data.totals?.shares, metricStatus(data, "shares")],
        ["Published posts", data.statuses?.published, "Published state"],
      ],
      primary: "reactions",
      secondary: "comments",
      labels: ["Reactions", "Comments"],
      ranked: "engagements",
    },
    actions: {
      title: "Action Analytics",
      subtitle: "Theo dõi lượt nhấp và khách hàng tiềm năng được ghi nhận.",
      metrics: [
        ["Clicks", data.totals?.clicks, metricStatus(data, "clicks")],
        ["Leads", data.totals?.leads, metricStatus(data, "leads")],
        [
          "Posts with clicks",
          (data.latestMetricSnapshots || []).filter(
            (item: R) => asNumber(item.clicks) !== null,
          ).length,
          "Measured state",
        ],
        [
          "Posts with leads",
          (data.latestMetricSnapshots || []).filter(
            (item: R) => asNumber(item.leads) !== null,
          ).length,
          "Measured state",
        ],
      ],
      primary: "clicks",
      secondary: "leads",
      labels: ["Clicks", "Leads"],
      ranked: "clicks",
    },
    conversions: {
      title: "Conversion Analytics",
      subtitle:
        "Đối chiếu kết quả nội dung với chỉ số sản phẩm có dữ liệu xác thực.",
      metrics: [
        ["Leads", data.totals?.leads, metricStatus(data, "leads")],
        ["Clicks", data.totals?.clicks, metricStatus(data, "clicks")],
        ["Campaigns", data.campaignCount, "Configured state"],
        ["Published posts", data.statuses?.published, "Published state"],
      ],
      primary: "leads",
      secondary: "clicks",
      labels: ["Leads", "Clicks"],
      ranked: "leads",
    },
  }
  const definition = definitions[type]
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title={definition.title}
        subtitle={definition.subtitle}
      />
      <MetricTiles metrics={definition.metrics} />
      {(type === "actions" || type === "conversions") && (
        <MetricAvailabilityPanel data={data} />
      )}
      <div className="route-grid">
        <TrendPanel
          data={data}
          title={`${uiText(definition.title.replace(" Analytics", ""))} · theo bài`}
          subtitle="Latest measured snapshots from the local dashboard API"
          primaryKey={definition.primary}
          secondaryKey={definition.secondary}
          labels={definition.labels}
        />
        <RankedPanel
          data={data}
          title="Hiệu quả theo nền tảng"
          metric={definition.ranked}
        />
        {type === "traffic" ? (
          <TrafficSourcesPanel data={data} />
        ) : (
          <RankedPanel
            data={data}
            title="Đóng góp đo được theo kênh"
            metric={definition.ranked}
          />
        )}
        <FunnelStrip data={data} />
        <SeedsTable
          data={data}
          title={`${definition.title.replace(" Analytics", "")} content`}
          onRow={onRow}
        />
      </div>
    </div>
  )
}

function FunnelStrip({ data }: { data: R }) {
  const steps: Array<[string, any, string]> = [
    ["Campaigns", data.campaignCount, "configured"],
    ["Targets", data.targetCount, "configured"],
    ["Posts", data.postCount, "state records"],
    ["Published", data.statuses?.published, "published state"],
    ["Measured posts", measuredPosts(data), "snapshot evidence"],
  ]
  return (
    <section className="panel route-full seed-funnel">
      <div className="panel-head">
        <div>
          <h2>Chiến dịch → Kênh → Bài đăng → Số liệu</h2>
          <p>Quy trình vận hành từ dữ liệu dashboard thực tế.</p>
        </div>
      </div>
      <div>
        {steps.map(([name, value, detail], index) => (
          <span key={name}>
            <em>{index + 1}</em>
            <small>{name}</small>
            <strong>{formatValue(value)}</strong>
            <b>{detail}</b>
            {index < steps.length - 1 && <i>→</i>}
          </span>
        ))}
      </div>
    </section>
  )
}

function MetricAvailabilityPanel({ data }: { data: R }) {
  const snapshots = data.latestMetricSnapshots || []
  const cards = [
    ["Published posts", data.statuses?.published, "Tổng số bài cần checkpoint"],
    [
      "Posts with clicks",
      snapshots.filter((item: R) => item.coverage?.clicks === "measured")
        .length,
      "Có click counter nhìn thấy",
    ],
    [
      "Posts with leads",
      snapshots.filter((item: R) => item.coverage?.leads === "measured").length,
      "Có lead counter nhìn thấy",
    ],
    ["Next checkpoint", "23:30", "Asia/Saigon · browser read-only"],
  ]
  return (
    <section className="panel route-full metric-availability">
      <div className="panel-head">
        <div>
          <h2>Trạng thái dữ liệu hành động</h2>
          <p>
            Click và lead chỉ hiện khi nguồn cung cấp counter rõ ràng; chưa có
            dữ liệu không được suy diễn thành 0.
          </p>
        </div>
        <span
          className={`status ${
            data.browserCoverage?.complete ? "ready" : "pending"
          }`}
        >
          {data.browserCoverage?.complete
            ? "Đủ observation"
            : "Đang chờ checkpoint"}
        </span>
      </div>
      <div className="metric-availability-grid">
        {cards.map(([label, value, detail]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>
              {typeof value === "string" ? value : formatValue(value)}
            </strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function ContentPage({ data }: { data: R }) {
  const [tab, setTab] = useState("All content")
  const posts =
    tab === "Published"
      ? (data.posts || []).filter((post: R) => post.status === "published")
      : tab === "Measured"
        ? (data.posts || []).filter(
            (post: R) => metricForPost(data, post, "impressions") !== null,
          )
        : data.posts || []
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Content Performance"
        subtitle="Measure every seeded post by reach, evidence and downstream outcomes."
        action="Create seed"
      />
      <MetricTiles
        metrics={[
          ["All posts", data.postCount, "State records"],
          ["Published", data.statuses?.published, "Published state"],
          ["Approved", data.statuses?.approved, "Approved state"],
          ["Measured posts", measuredPosts(data), "Snapshot evidence"],
          [
            "Impressions",
            data.totals?.impressions,
            metricStatus(data, "impressions"),
          ],
          ["Leads", data.totals?.leads, metricStatus(data, "leads")],
        ]}
      />
      <div className="content-tabs">
        {["All content", "Published", "Measured"].map((value) => (
          <button
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
            key={value}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="route-grid">
        <TrendPanel
          data={data}
          title={`${uiText(tab)} · xu hướng`}
          subtitle="Chỉ gồm snapshot đã đo"
        />
        <RankedPanel
          data={data}
          title="Channels by impressions"
          metric="impressions"
        />
        <SeedsTable data={{ ...data, posts }} title={tab} />
      </div>
    </div>
  )
}

const communityMembershipLabels: Record<string, string> = {
  joined: "Đã tham gia",
  pending: "Chờ duyệt tham gia",
  rejected: "Bị từ chối",
  blocked: "Bị chặn",
  not_applicable: "Không áp dụng",
  unknown: "Chưa xác minh",
}
const communityPostLabels: Record<string, string> = {
  allowed: "Được phép đăng",
  manual_review: "Bài chờ duyệt",
  blocked: "Bị chặn đăng",
  not_applicable: "Không áp dụng",
  unknown: "Chưa rõ quyền đăng",
}
const communityRepoLabels: Record<string, string> = {
  "design-os-3d-blender": "3D / Blender",
  "design-os-code2flow": "Vibe Code",
  "design-os-svg-animation": "SVG Animation",
}
function communityUrlKey(value: any) {
  return String(value || "")
    .replace(/\/+$/, "")
    .toLowerCase()
}
function communityRows(data: R) {
  const targets = data.targets || []
  const posts = data.posts || []
  return (data.communityMemberships || [])
    .map((membership: R) => {
      const targetIds = targets
        .filter(
          (target: R) =>
            communityUrlKey(target.url) ===
              communityUrlKey(membership.communityUrl) ||
            (target.name && target.name === membership.communityName),
        )
        .map((target: R) => target.id)
      const scopedPosts = posts.filter((post: R) =>
        targetIds.includes(post.targetId),
      )
      const latestPublished = scopedPosts
        .filter((post: R) => post.status === "published" && post.publicationUrl)
        .sort((a: R, b: R) =>
          String(b.publishedAt || b.updatedAt || "").localeCompare(
            String(a.publishedAt || a.updatedAt || ""),
          ),
        )
        .at(0)
      const latestPending = scopedPosts
        .filter((post: R) =>
          [
            "approved",
            "queued",
            "publishing",
            "processing",
            "needs_review",
          ].includes(post.status),
        )
        .sort((a: R, b: R) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
        )
        .at(0)
      return {
        ...membership,
        targetIds,
        postCount: scopedPosts.length,
        publishedCount: scopedPosts.filter(
          (post: R) => post.status === "published",
        ).length,
        pendingCount: scopedPosts.filter((post: R) =>
          [
            "approved",
            "queued",
            "publishing",
            "processing",
            "needs_review",
          ].includes(post.status),
        ).length,
        removedCount: scopedPosts.filter((post: R) =>
          ["removed", "failed", "rejected"].includes(post.status),
        ).length,
        latestPublishedUrl: latestPublished?.publicationUrl || "",
        latestPendingUrl: latestPending?.publicationUrl || "",
      }
    })
    .sort((a: R, b: R) =>
      String(b.updatedAt || b.checkedAt || "").localeCompare(
        String(a.updatedAt || a.checkedAt || ""),
      ),
    )
}
function CommunityDirectory({ data }: { data: R }) {
  const [query, setQuery] = useState("")
  const [platform, setPlatform] = useState("all")
  const [membership, setMembership] = useState("all")
  const [copied, setCopied] = useState("")
  const allRows = useMemo(() => communityRows(data), [data])
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allRows.filter((row: R) => {
      const text =
        `${row.communityName} ${row.communityUrl} ${row.productRepo} ${row.platform} ${row.notes || ""}`.toLowerCase()
      return (
        (!needle || text.includes(needle)) &&
        (platform === "all" || row.platform === platform) &&
        (membership === "all" ||
          row.membershipStatus === membership ||
          row.postStatus === membership)
      )
    })
  }, [allRows, membership, platform, query])
  const paged = usePagedRows<R>(
    rows,
    (row: R) => row.id,
    `${query}\u0000${platform}\u0000${membership}`,
  )
  const copy = async (row: R) => {
    if (!row.communityUrl) return
    try {
      await navigator.clipboard.writeText(row.communityUrl)
      setCopied(row.id)
      window.setTimeout(() => setCopied(""), 1400)
    } catch {
      setCopied("")
    }
  }
  const joined = allRows.filter(
    (row: R) => row.membershipStatus === "joined",
  ).length
  const pending = allRows.filter(
    (row: R) =>
      row.membershipStatus === "pending" || row.postStatus === "manual_review",
  ).length
  const unknown = allRows.filter(
    (row: R) =>
      row.membershipStatus === "unknown" || row.postStatus === "unknown",
  ).length
  return (
    <section className="panel community-directory route-full">
      <div className="panel-head">
        <div>
          <h2>Danh bạ cộng đồng</h2>
          <p>
            Danh sách đã tìm thấy, liên kết trực tiếp, trạng thái tham gia,
            quyền đăng và lịch sử bài theo từng repo.
          </p>
        </div>
        <span className="status ready">{allRows.length} cộng đồng</span>
      </div>
      <div className="community-kpis">
        <span>
          <b>{joined}</b> đã tham gia
        </span>
        <span>
          <b>{pending}</b> chờ duyệt tham gia hoặc bài đăng
        </span>
        <span>
          <b>{unknown}</b> cần xác minh trên trình duyệt
        </span>
      </div>
      <div className="community-directory-tools">
        <label className="route-search">
          ⌕{" "}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm nhóm, repo, nền tảng..."
          />
        </label>
        <select
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
        >
          <option value="all">Tất cả nền tảng</option>
          {(data.channels || []).map((item: R) => (
            <option value={item.id} key={item.id}>
              {labelChannel(item.id)}
            </option>
          ))}
        </select>
        <select
          value={membership}
          onChange={(event) => setMembership(event.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="joined">Đã tham gia</option>
          <option value="pending">Chờ duyệt</option>
          <option value="unknown">Chưa xác minh</option>
          <option value="blocked">Bị chặn</option>
        </select>
      </div>
      <div className="table-scroll">
        <table className="community-directory-table">
          <thead>
            <tr>
              {[
                "Nền tảng",
                "Cộng đồng / link",
                "Repo",
                "Join",
                "Quyền đăng",
                "Đã đăng",
                "Chờ duyệt",
                "Kiểm tra",
                "Thao tác",
              ].map((head) => (
                <th key={head}>{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              paged.rows.map((row: R) => (
                <tr key={row.id}>
                  <td>
                    <span className="platform-cell">
                      <Mark name={labelChannel(row.platform)} />
                      <b>{labelChannel(row.platform)}</b>
                    </span>
                  </td>
                  <td>
                    <span className="community-directory-name">
                      <b>{row.communityName}</b>
                      <small>{row.communityUrl || "Không có link"}</small>
                    </span>
                  </td>
                  <td>
                    <span className="product-repo-cell">
                      <b>
                        {communityRepoLabels[row.productRepo] ||
                          row.productRepo}
                      </b>
                      <small>{row.productRepo}</small>
                    </span>
                  </td>
                  <td>
                    <span className={`status ${slug(row.membershipStatus)}`}>
                      {communityMembershipLabels[row.membershipStatus] ||
                        row.membershipStatus}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`community-post-status ${slug(row.postStatus)}`}
                    >
                      {communityPostLabels[row.postStatus] || row.postStatus}
                    </span>
                  </td>
                  <td>
                    <strong>{formatValue(row.publishedCount)}</strong>
                    <small>{row.postCount} bài ghi nhận</small>
                    {row.latestPublishedUrl && (
                      <a
                        className="community-post-link"
                        href={row.latestPublishedUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Mở bài gần nhất ↗
                      </a>
                    )}
                  </td>
                  <td>
                    <strong>{formatValue(row.pendingCount)}</strong>
                    <small>
                      {row.removedCount
                        ? `${row.removedCount} lỗi/gỡ`
                        : "Không có"}
                    </small>
                    {row.pendingCount > 0 && (
                      <span className="community-pending-note">
                        Bài chờ group duyệt
                      </span>
                    )}
                  </td>
                  <td>
                    <time>{formatDate(row.checkedAt || row.updatedAt)}</time>
                  </td>
                  <td>
                    <div className="community-row-actions">
                      {row.communityUrl ? (
                        <>
                          <a
                            className="post-permalink"
                            href={row.communityUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Mở ↗
                          </a>
                          <button
                            className="copy-link-button"
                            onClick={() => copy(row)}
                          >
                            {copied === row.id
                              ? "Đã sao chép"
                              : "Sao chép liên kết"}
                          </button>
                        </>
                      ) : (
                        <span className="unknown-link">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">
                    Không có cộng đồng khớp bộ lọc hiện tại.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={paged.page}
        pageCount={paged.pageCount}
        total={rows.length}
        setPage={paged.setPage}
      />
    </section>
  )
}

function PlatformsPage({ data }: { data: R }) {
  const navigate = useNavigate()
  const stats = channelStats(data)
  const channelCapabilities = Array.isArray(data.channelCapabilities)
    ? data.channelCapabilities.slice(0, 64)
    : []
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Platforms"
        subtitle="Nền tảng, cộng đồng, link trực tiếp và trạng thái phân phối theo repo."
        action="Connect platform"
      />
      <MetricTiles
        metrics={[
          ["Configured channels", data.channels?.length, "Dashboard state"],
          ["Targets", data.targetCount, "Dashboard state"],
          [
            "Cộng đồng",
            (data.communityMemberships || []).length,
            "Crawl registry",
          ],
          [
            "Đã tham gia",
            (data.communityMemberships || []).filter(
              (item: R) => item.membershipStatus === "joined",
            ).length,
            "Chrome / verified",
          ],
          ["Published", data.statuses?.published, "Published state"],
          [
            "Measured impressions",
            data.totals?.impressions,
            metricStatus(data, "impressions"),
          ],
        ]}
      />
      <section className="panel platform-table">
        <div className="panel-head">
          <div>
            <h2>Hiệu quả theo nền tảng</h2>
            <p>
              Mở nền tảng để xem bài đăng có số liệu và trạng thái hoạt động.
            </p>
          </div>
          <label className="route-search">
            ⌕ <input placeholder="Tìm nền tảng..." />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Platform",
                  "Targets",
                  "Posts",
                  "Impressions",
                  "Engagements",
                  "Clicks",
                  "Leads",
                  "Published",
                  "Readiness",
                ].map((head) => (
                  <th key={head}>{uiText(head)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((item: R) => (
                <tr
                  key={item.id}
                  className="clickable"
                  onClick={() => navigate(`/platforms/${slug(item.id)}`)}
                >
                  <td>
                    <span className="platform-cell">
                      <Mark name={item.label} />
                      <b>{item.label}</b>
                    </span>
                  </td>
                  <td>{formatValue(item.targets)}</td>
                  <td>{formatValue(item.posts)}</td>
                  <td>{formatValue(item.impressions)}</td>
                  <td>{formatValue(item.engagements)}</td>
                  <td>{formatValue(item.clicks)}</td>
                  <td>{formatValue(item.leads)}</td>
                  <td>
                    {formatValue(
                      (data.posts || []).filter(
                        (post: R) =>
                          post.status === "published" &&
                          item.target?.id === post.targetId,
                      ).length,
                    )}
                  </td>
                  <td>
                    <span
                      className={`status ${slug(item.target?.readiness?.state || "checking")}`}
                    >
                      {labelStatus(item.target?.readiness?.state || "checking")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel platform-capability-panel" aria-label="Channel capability readiness">
        <div className="panel-head">
          <div>
            <h2>Channel capability readiness</h2>
            <p>
              Projection chỉ đọc từ runtime; status không cấp quyền và không
              chứng minh platform đã được publish.
            </p>
          </div>
          <span className="status">{channelCapabilities.length ? `${channelCapabilities.length} channel` : "UNKNOWN"}</span>
        </div>
        {channelCapabilities.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Targets</th>
                  <th>Fresh ready</th>
                  <th>Policy</th>
                </tr>
              </thead>
              <tbody>
                {channelCapabilities.map((capability: R, index: number) => {
                  const channel = String(capability?.channel || `channel-${index}`)
                  const status = String(capability?.status || "UNKNOWN")
                  const policy = [
                    capability?.requiresRulesReview === true ? "rules review" : null,
                    capability?.publishMode === "AUTONOMOUS_WHEN_AUTHORIZED"
                      ? "autonomous when authorized"
                      : capability?.requiresHumanApproval === true ? "human approval" : null,
                  ].filter(Boolean).join(" · ") || "bounded policy"
                  return (
                    <tr key={channel}>
                      <td>
                        <span className="platform-cell">
                          <Mark name={capability?.label || channel} />
                          <b>{boundedDisplayText(capability?.label || labelChannel(channel), "UNKNOWN", 80)}</b>
                        </span>
                      </td>
                      <td><span className={`status ${slug(status)}`}>{boundedDisplayText(status, "UNKNOWN", 40)}</span></td>
                      <td>{boundedDisplayText(capability?.reason)}</td>
                      <td>{formatValue(capability?.targetCount)}</td>
                      <td>{formatValue(capability?.freshReadyTargetCount)}</td>
                      <td>{boundedDisplayText(policy, "bounded policy", 100)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Chưa có channel capability projection.</div>
        )}
      </section>
      <CommunityDirectory data={data} />
    </div>
  )
}

function PlatformDetailPage({
  data,
  channelId,
}: {
  data: R
  channelId: string
}) {
  const navigate = useNavigate()
  const channel = (data.channels || []).find(
    (item: R) =>
      slug(item.id) === channelId || slug(labelChannel(item.id)) === channelId,
  )
  const target = (data.targets || []).find(
    (item: R) => item.channel === channel?.id,
  )
  const scoped = channel
    ? (data.posts || []).filter((post: R) => post.targetId === target?.id)
    : []
  return (
    <div className="page-shell route-page">
      <button className="back-button" onClick={() => navigate("/platforms")}>
        ← Tất cả nền tảng
      </button>
      <PageHeader
        data={data}
        title={labelChannel(channel?.id)}
        subtitle="Chi tiết nền tảng từ dữ liệu dashboard hiện tại."
      />
      <div className="detail-banner">
        <span
          className={`status ${slug(target?.readiness?.state || "checking")}`}
        >
          {labelStatus(target?.readiness?.state || "checking")}
        </span>
        <p>
          {target?.readiness?.summary || "Chưa có mô tả trạng thái sẵn sàng."}
        </p>
      </div>
      <MetricTiles
        metrics={[
          ["Posts", scoped.length, "State records"],
          [
            "Published",
            scoped.filter((post: R) => post.status === "published").length,
            "Published state",
          ],
          [
            "Impressions",
            metricForTarget(data, target?.id || "", "impressions"),
            metricStatus(data, "impressions"),
          ],
          [
            "Engagements",
            metricForTarget(data, target?.id || "", "engagements"),
            "Measured if available",
          ],
          [
            "Clicks",
            metricForTarget(data, target?.id || "", "clicks"),
            metricStatus(data, "clicks"),
          ],
          [
            "Leads",
            metricForTarget(data, target?.id || "", "leads"),
            metricStatus(data, "leads"),
          ],
        ]}
      />
      <div className="route-grid">
        <TrendPanel
          data={{
            ...data,
            latestMetricSnapshots: snapshotsFor(data).filter((snapshot: R) =>
              scoped.some((post: R) => post.id === snapshot.postId),
            ),
          }}
          title="Channel measurements"
          subtitle="Snapshots associated with this configured target"
        />
        <RankedPanel
          data={{ ...data, channels: channel ? [channel] : [] }}
          title="Channel contribution"
          metric="impressions"
        />
        <SeedsTable data={{ ...data, posts: scoped }} title="Channel posts" />
      </div>
    </div>
  )
}

function CampaignsPage({ data, detail }: { data: R; detail?: string }) {
  const navigate = useNavigate()
  const campaign = (data.campaigns || []).find(
    (item: R) => slug(item.id) === detail || slug(item.name) === detail,
  )
  if (detail && campaign) {
    const posts = (data.posts || []).filter(
      (post: R) => post.campaignId === campaign.id,
    )
    return (
      <div className="page-shell route-page">
        <button className="back-button" onClick={() => navigate("/campaigns")}>
          ← All campaigns
        </button>
        <PageHeader
          data={data}
          title={campaign.name}
          subtitle={`${labelStatus(campaign.status)} campaign · ${campaign.objective || "No objective recorded"}`}
          action="Edit campaign"
        />
        <MetricTiles
          metrics={[
            ["Posts", posts.length, "State records"],
            [
              "Published",
              posts.filter((post: R) => post.status === "published").length,
              "Published state",
            ],
            [
              "Impressions",
              sumMeasured(
                posts.map((post: R) => ({
                  value: metricForPost(data, post, "impressions"),
                })),
                "value",
              ),
              "Measured if available",
            ],
            [
              "Leads",
              sumMeasured(
                posts.map((post: R) => ({
                  value: metricForPost(data, post, "leads"),
                })),
                "value",
              ),
              "Measured if available",
            ],
          ]}
        />
        <div className="route-grid">
          <TrendPanel
            data={{
              ...data,
              latestMetricSnapshots: snapshotsFor(data).filter((snapshot: R) =>
                posts.some((post: R) => post.id === snapshot.postId),
              ),
            }}
            title="Campaign measurements"
            subtitle="Snapshots associated with this campaign"
          />
          <SeedsTable data={{ ...data, posts }} title="Campaign posts" />
        </div>
      </div>
    )
  }
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Campaigns"
        subtitle="Lập kế hoạch, theo dõi và so sánh các hoạt động phân phối."
        action="New campaign"
      />
      <MetricTiles
        metrics={[
          ["Campaigns", data.campaignCount, "Dashboard state"],
          [
            "Active",
            (data.campaigns || []).filter((item: R) => item.status === "active")
              .length,
            "Campaign state",
          ],
          ["Posts", data.postCount, "Dashboard state"],
          ["Published", data.statuses?.published, "Published state"],
          [
            "Measured impressions",
            data.totals?.impressions,
            metricStatus(data, "impressions"),
          ],
        ]}
      />
      <section className="panel campaign-list">
        <div className="panel-head">
          <div>
            <h2>Danh sách chiến dịch</h2>
            <p>Chiến dịch phân phối hiện có trong dữ liệu dashboard.</p>
          </div>
          <span className="status ready">
            {data.campaigns?.length || 0} campaigns
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Campaign",
                  "Status",
                  "Objective",
                  "Audience",
                  "Posts",
                  "Published",
                  "Updated",
                ].map((head) => (
                  <th key={head}>{uiText(head)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.campaigns || []).map((item: R) => {
                const posts = (data.posts || []).filter(
                  (post: R) => post.campaignId === item.id,
                )
                return (
                  <tr
                    className="clickable"
                    key={item.id}
                    onClick={() =>
                      navigate(`/campaigns/${slug(item.id || item.name)}`)
                    }
                  >
                    <td>
                      <b>{item.name}</b>
                      <small>{item.productRepo || item.assetPath || ""}</small>
                    </td>
                    <td>
                      <span className={`status ${slug(item.status)}`}>
                        {labelStatus(item.status)}
                      </span>
                    </td>
                    <td>{item.objective || "—"}</td>
                    <td>{item.audience || "—"}</td>
                    <td>{formatValue(posts.length)}</td>
                    <td>
                      {formatValue(
                        posts.filter((post: R) => post.status === "published")
                          .length,
                      )}
                    </td>
                    <td>{formatDate(item.updatedAt || item.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function PostsPageV2({ data, onRow }: { data: R; onRow: (post: R) => void }) {
  const [query, setQuery] = useState("")
  const [searchParams] = useSearchParams()
  const queryStatus =
    searchParams.get("status") === "published" ? "published" : "All statuses"
  const [status, setStatus] = useState(queryStatus)
  const [platform, setPlatform] = useState("All platforms")
  const [product, setProduct] = useState("All products")
  const [sort, setSort] = useState("Newest first")
  useEffect(() => setStatus(queryStatus), [queryStatus])
  const latestPosts = useMemo(
    () =>
      [...(data.posts || [])]
        .sort((a: R, b: R) => postTimestamp(b) - postTimestamp(a))
        .slice(0, 2),
    [data],
  )
  const productCounts = useMemo(
    () =>
      productTracks.map((track) => ({
        ...track,
        total: (data.posts || []).filter(
          (post: R) => productTrackFor(data, post).id === track.id,
        ).length,
        published: (data.posts || []).filter(
          (post: R) =>
            productTrackFor(data, post).id === track.id &&
            post.status === "published",
        ).length,
      })),
    [data],
  )
  const shown = useMemo(() => {
    const filtered = (data.posts || []).filter((post: R) => {
      const target = targetFor(data, post.targetId)
      const track = productTrackFor(data, post)
      const text =
        `${post.content || ""} ${track.label} ${track.repo} ${labelChannel(target?.channel)} ${targetLabel(target)} ${target?.url || ""} ${post.status}`.toLowerCase()
      return (
        text.includes(query.toLowerCase()) &&
        (status === "All statuses" || post.status === status) &&
        (platform === "All platforms" ||
          labelChannel(target?.channel) === platform) &&
        (product === "All products" || track.id === product)
      )
    })
    const metricKey =
      sort === "Most engagement"
        ? "engagements"
        : sort === "Most clicks"
          ? "clicks"
          : sort === "Most leads"
            ? "leads"
            : "impressions"
    return filtered.sort((a: R, b: R) =>
      sort === "Newest first"
        ? postTimestamp(b) - postTimestamp(a)
        : (asNumber(metricForPost(data, b, metricKey)) ?? -1) -
          (asNumber(metricForPost(data, a, metricKey)) ?? -1),
    )
  }, [data, platform, product, query, sort, status])
  const paged = usePagedRows<R>(
    shown,
    (post: R) => post.id,
    `${query}-${product}-${status}-${platform}-${sort}`,
  )
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Bài đăng & Seeds"
        subtitle="Hoạt động phân phối mới nhất, repo sản phẩm, cộng đồng và permalink trên từng dòng."
        action="Tạo seed"
      />
      <section className="product-track-strip" aria-label="Các repo sản phẩm">
        {productCounts.map((track) => (
          <button
            type="button"
            className={`product-track-chip ${
              product === track.id ? "active" : ""
            }`}
            key={track.id}
            onClick={() =>
              setProduct(product === track.id ? "All products" : track.id)
            }
          >
            <span className="track-dot" style={{ background: track.accent }} />
            <span>
              <b>{track.label}</b>
              <small>{track.repo}</small>
            </span>
            <strong>
              {track.published}/{track.total} đã đăng
            </strong>
          </button>
        ))}
      </section>
      <section className="latest-posts">
        <div className="latest-posts-head">
          <div>
            <span className="eyebrow">HOẠT ĐỘNG MỚI NHẤT</span>
            <h2>2 bài mới nhất</h2>
            <p>Kiểm tra nhanh bài nào đã đăng, đăng ở đâu và mở bài gốc.</p>
          </div>
          <span className="status ready">
            {formatValue((data.posts || []).length)} bài tổng cộng
          </span>
        </div>
        <div className="latest-posts-grid">
          {latestPosts.map((post: R) => {
            const target = targetFor(data, post.targetId)
            const track = productTrackFor(data, post)
            const url = validUrl(post.publicationUrl)
            const tracking = trackingState(data, post)
            return (
              <article className="latest-post-card" key={post.id}>
                <div className="latest-card-top">
                  <span className="platform-cell">
                    <Mark name={labelChannel(target?.channel)} />
                    <b>{labelChannel(target?.channel)}</b>
                  </span>
                  <span className={`status ${slug(post.status)}`}>
                    {labelStatus(post.status)}
                    <small className={`tracking-state ${tracking.tone}`}>
                      {tracking.label}
                    </small>
                  </span>
                </div>
                <h3>
                  {String(post.content || "Chưa có nội dung")
                    .split("\n")[0]
                    .slice(0, 108)}
                </h3>
                <p className="product-repo-line">
                  <span
                    className="track-dot"
                    style={{ background: track.accent }}
                  />
                  <b>{track.repo}</b>
                  <small>{track.label}</small>
                </p>
                <p className="post-community">
                  <b>{targetLabel(target)}</b>
                  <small>
                    {formatDate(
                      post.updatedAt || post.publishedAt || post.createdAt,
                    )}
                  </small>
                </p>
                <div className="latest-card-foot">
                  <span>
                    Lượt hiển thị{" "}
                    <strong>
                      {metricCell(
                        metricForPost(data, post, "impressions"),
                        "Impressions",
                      )}
                    </strong>
                  </span>
                  {url ? (
                    <a
                      className="post-permalink"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Mở bài đăng ↗
                    </a>
                  ) : (
                    <span className="unknown-link">
                      Chưa có liên kết bài đăng
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
      <div className="operations-tools">
        <label className="route-search">
          ⌕{" "}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm bài, repo, tài khoản, cộng đồng..."
          />
        </label>
        <select
          value={product}
          onChange={(event) => setProduct(event.target.value)}
        >
          <option value="All products">Tất cả repo sản phẩm</option>
          {productTracks.map((track) => (
            <option value={track.id} key={track.id}>
              {track.repo}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="All statuses">Tất cả trạng thái</option>
          {Object.keys(statusLabels)
            .filter((key) =>
              ["draft", "approved", "published", "removed"].includes(key),
            )
            .map((key) => (
              <option value={key} key={key}>
                {labelStatus(key)}
              </option>
            ))}
        </select>
        <select
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
        >
          <option value="All platforms">Tất cả nền tảng</option>
          {(data.channels || []).map((item: R) => (
            <option key={item.id}>{labelChannel(item.id)}</option>
          ))}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="Newest first">Mới nhất</option>
          <option value="Most impressions">Nhiều lượt hiển thị nhất</option>
          <option value="Most engagement">Nhiều tương tác nhất</option>
          <option value="Most clicks">Nhiều lượt nhấp nhất</option>
          <option value="Most leads">Nhiều khách hàng tiềm năng nhất</option>
        </select>
      </div>
      <section className="panel posts-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Bài / seed",
                  "Repo sản phẩm",
                  "Nền tảng",
                  "Đăng tại",
                  "Chiến dịch",
                  "Trạng thái",
                  "Impressions",
                  "Tương tác",
                  "Clicks",
                  "Leads",
                  "Cập nhật",
                  "Link",
                ].map((head) => (
                  <th key={head}>{uiText(head)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((post: R) => {
                const target = targetFor(data, post.targetId)
                const campaign = (data.campaigns || []).find(
                  (item: R) => item.id === post.campaignId,
                )
                const track = productTrackFor(data, post)
                const url = validUrl(post.publicationUrl)
                const tracking = trackingState(data, post)
                return (
                  <tr
                    className="clickable"
                    onClick={() => onRow(post)}
                    key={post.id}
                  >
                    <td>
                      <span className="post-title">
                        {String(post.content || "No content")
                          .split("\n")[0]
                          .slice(0, 105)}
                        <small>{post.id}</small>
                      </span>
                    </td>
                    <td>
                      <span className="product-repo-cell">
                        <b>{track.repo}</b>
                        <small>{track.label}</small>
                      </span>
                    </td>
                    <td>
                      <span className="platform-cell">
                        <Mark name={labelChannel(target?.channel)} />
                        <b>{labelChannel(target?.channel)}</b>
                      </span>
                    </td>
                    <td>
                      <span className="post-community">
                        <b>{targetLabel(target)}</b>
                        <small>
                          {target?.account ||
                            target?.url ||
                            "Chưa ghi nhận kênh"}
                        </small>
                      </span>
                    </td>
                    <td>{campaign?.name || "—"}</td>
                    <td>
                      <span className={`status ${slug(post.status)}`}>
                        {labelStatus(post.status)}
                        <small className={`tracking-state ${tracking.tone}`}>
                          {tracking.label}
                        </small>
                      </span>
                    </td>
                    <td>
                      {metricCell(
                        metricForPost(data, post, "impressions"),
                        "Impressions",
                      )}
                    </td>
                    <td>
                      {metricCell(
                        metricForPost(data, post, "engagements"),
                        "Engagements",
                      )}
                    </td>
                    <td>
                      {metricCell(
                        metricForPost(data, post, "clicks"),
                        "Clicks",
                      )}
                    </td>
                    <td>
                      {metricCell(metricForPost(data, post, "leads"), "Leads")}
                    </td>
                    <td>
                      {formatDate(
                        post.updatedAt || post.publishedAt || post.createdAt,
                      )}
                    </td>
                    <td>
                      {url ? (
                        <a
                          className="post-permalink"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          Mở ↗
                        </a>
                      ) : (
                        <span className="unknown-link">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={paged.page}
          pageCount={paged.pageCount}
          total={shown.length}
          setPage={paged.setPage}
        />
      </section>
    </div>
  )
}

function PostsPage({ data, onRow }: { data: R; onRow: (post: R) => void }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("All statuses")
  const [platform, setPlatform] = useState("All platforms")
  const [sort, setSort] = useState("Newest first")
  const latestPosts = useMemo(
    () =>
      [...(data.posts || [])]
        .sort((a: R, b: R) => postTimestamp(b) - postTimestamp(a))
        .slice(0, 2),
    [data],
  )
  const shown = useMemo(() => {
    const filtered = (data.posts || []).filter((post: R) => {
      const target = targetFor(data, post.targetId)
      const text =
        `${post.content || ""} ${labelChannel(target?.channel)} ${targetLabel(target)} ${target?.url || ""} ${post.status}`.toLowerCase()
      return (
        text.includes(query.toLowerCase()) &&
        (status === "All statuses" || post.status === status) &&
        (platform === "All platforms" ||
          labelChannel(target?.channel) === platform)
      )
    })
    const metricKey =
      sort === "Most engagement"
        ? "engagements"
        : sort === "Most clicks"
          ? "clicks"
          : sort === "Most leads"
            ? "leads"
            : "impressions"
    return filtered.sort((a: R, b: R) =>
      sort === "Newest first"
        ? postTimestamp(b) - postTimestamp(a)
        : (asNumber(metricForPost(data, b, metricKey)) ?? -1) -
          (asNumber(metricForPost(data, a, metricKey)) ?? -1),
    )
  }, [data, platform, query, sort, status])
  const paged = usePagedRows<R>(
    shown as R[],
    (post: R) => post.id,
    `${query}\u0000${status}\u0000${platform}\u0000${sort}`,
  )
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Posts & Seeds"
        subtitle="Operate, track and inspect every distributed content item."
        action="New seed"
      />
      <div className="operations-tools">
        <label className="route-search">
          ⌕{" "}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts, accounts, communities..."
          />
        </label>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option>All statuses</option>
          {Object.keys(statusLabels)
            .filter((key) =>
              ["draft", "approved", "published", "removed"].includes(key),
            )
            .map((key) => (
              <option value={key} key={key}>
                {labelStatus(key)}
              </option>
            ))}
        </select>
        <select
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
        >
          <option>All platforms</option>
          {(data.channels || []).map((item: R) => (
            <option key={item.id}>{labelChannel(item.id)}</option>
          ))}
        </select>
      </div>
      <section className="panel posts-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Post / seed",
                  "Platform",
                  "Campaign",
                  "Status",
                  "Impressions",
                  "Engagements",
                  "Clicks",
                  "Leads",
                  "Updated",
                ].map((head) => (
                  <th key={head}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((post: R) => {
                const target = targetFor(data, post.targetId)
                const campaign = (data.campaigns || []).find(
                  (item: R) => item.id === post.campaignId,
                )
                return (
                  <tr
                    className="clickable"
                    onClick={() => onRow(post)}
                    key={post.id}
                  >
                    <td>
                      <span className="post-title">
                        {String(post.content || "No content")
                          .split("\n")[0]
                          .slice(0, 105)}
                        <small>{post.id}</small>
                      </span>
                    </td>
                    <td>
                      <span className="platform-cell">
                        <Mark name={labelChannel(target?.channel)} />
                        <b>{labelChannel(target?.channel)}</b>
                      </span>
                    </td>
                    <td>{campaign?.name || "—"}</td>
                    <td>
                      <span className={`status ${slug(post.status)}`}>
                        {labelStatus(post.status)}
                      </span>
                    </td>
                    <td>
                      {formatValue(metricForPost(data, post, "impressions"))}
                    </td>
                    <td>
                      {formatValue(metricForPost(data, post, "engagements"))}
                    </td>
                    <td>{formatValue(metricForPost(data, post, "clicks"))}</td>
                    <td>{formatValue(metricForPost(data, post, "leads"))}</td>
                    <td>{formatDate(post.updatedAt || post.publishedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={paged.page}
          pageCount={paged.pageCount}
          total={shown.length}
          setPage={paged.setPage}
        />
      </section>
    </div>
  )
}

function MarketsPage({ data }: { data: R }) {
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Markets"
        subtitle="Compare distribution performance across regions when the connected sources provide market dimensions."
      />
      <MetricTiles
        metrics={[
          ["Configured targets", data.targetCount, "Dashboard state"],
          ["Audience dimension", "—", "No measured market field"],
          ["Countries", "—", "No measured market field"],
          ["Regional conversion", "—", "No measured market field"],
        ]}
      />
      <section className="panel route-full">
        <div className="panel-head">
          <div>
            <h2>Hiệu quả theo thị trường</h2>
            <p>
              API hiện chưa có dữ liệu quốc gia hoặc khu vực; dashboard không tự
              tạo số liệu thay thế.
            </p>
          </div>
          <span className="status draft">Đang chờ dữ liệu từ nguồn</span>
        </div>
        <div className="empty-state">
          Khu vực này sẽ có số liệu khi nguồn lưu lượng cung cấp dữ liệu theo
          từng thị trường.
        </div>
      </section>
      <section className="panel route-full">
        <div className="panel-head">
          <div>
            <h2>Bản đồ nhiệt nền tảng × thị trường</h2>
            <p>Không suy đoán thị trường dựa trên tên nền tảng.</p>
          </div>
        </div>
        <div className="empty-state">
          Chưa có số liệu thị trường để phân tích.
        </div>
      </section>
    </div>
  )
}

function AudiencePage({ data }: { data: R }) {
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Audience"
        subtitle="Xem đặc điểm người xem và lượt quay lại khi nền tảng cung cấp các chỉ số này."
      />
      <MetricTiles
        metrics={[
          ["Known visitors", "—", "No measured audience field"],
          ["Returning visitors", "—", "No measured audience field"],
          ["Device share", "—", "No measured audience field"],
          ["Audience growth", "—", "No measured audience field"],
        ]}
      />
      <div className="route-grid">
        <section className="panel route-trend">
          <div className="panel-head">
            <div>
              <h2>Audience growth</h2>
              <p>API dashboard hiện chưa có bản ghi đo lường đối tượng.</p>
            </div>
          </div>
          <div className="empty-state">
            Chưa có chuỗi số liệu về đối tượng theo thời gian.
          </div>
        </section>
        <RankedPanel data={data} title="Channel reach" metric="impressions" />
        <section className="panel route-full">
          <div className="panel-head">
            <div>
              <h2>Audience attributes</h2>
              <p>
                Các thông tin này không được suy đoán từ bài đăng hoặc tên nền
                tảng.
              </p>
            </div>
          </div>
          <div className="empty-state">
            Chưa có dữ liệu theo quốc gia, thiết bị hoặc nhóm người xem.
          </div>
        </section>
      </div>
    </div>
  )
}

function SignalsPage({ data }: { data: R }) {
  const items = data.trafficPulse || data.signals || []
  const [filter, setFilter] = useState("all")
  const visible =
    filter === "all"
      ? items
      : items.filter((item: R) => item.priority === filter)
  const navigate = useNavigate()
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Intelligence Center"
        subtitle="Cơ hội, bất thường và rủi ro phân phối được phát hiện từ dữ liệu thực."
        action="Configure signals"
      />
      <MetricTiles
        metrics={[
          ["Active signals", visible.length, "Runtime state"],
          ["Open interactions", data.openInteractions, "Dashboard state"],
          ["Pending replies", data.pendingReplies, "Dashboard state"],
          ["Measured posts", measuredPosts(data), "Snapshot evidence"],
        ]}
      />
      <div className="signal-filter">
        {[
          ["all", "Tất cả tín hiệu"],
          ["due", "Đến hạn rà soát"],
          ["engage", "Cần tương tác"],
        ].map(([key, label]) => (
          <button
            type="button"
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
            key={key}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="intelligence-list">
        {visible.length ? (
          visible.map((item: R, index: number) => (
            <article key={`${item.postId || item.id || "signal"}-${index}`}>
              <span
                className={`intel-icon ${
                  item.priority === "due" ? "warn" : ""
                }`}
              >
                {item.priority === "due" ? "↓" : "↑"}
              </span>
              <div>
                <em>{item.priority || "Signal"}</em>
                <h3>
                  {item.recommendation || item.title || "Evidence signal"}
                </h3>
                <p>
                  {item.publicationUrl ||
                    item.reason ||
                    "No additional description"}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    item.publicationUrl
                      ? window.open(
                          item.publicationUrl,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      : navigate("/posts")
                  }
                >
                  Xem bằng chứng →
                </button>
              </div>
              <aside>
                <span
                  className={`signal-priority ${
                    item.priority === "due" ? "review" : "opportunity"
                  }`}
                >
                  {item.priority || "Review"}
                </span>
                <time>{formatDate(item.nextReviewAt || item.updatedAt)}</time>
              </aside>
            </article>
          ))
        ) : (
          <div className="empty-state">
            Chưa có tín hiệu đang hoạt động trong dữ liệu dashboard hiện tại.
          </div>
        )}
      </div>
    </div>
  )
}

function ReportsPage({ data }: { data: R }) {
  const navigate = useNavigate()
  const schedules = data.schedules || []
  const artifacts = data.recentArtifacts || []
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Reports"
        subtitle="Báo cáo theo lịch hoặc tạo theo yêu cầu từ dữ liệu dashboard hiện có."
        action="Create report"
      />
      <MetricTiles
        metrics={[
          ["Configured schedules", schedules.length, "Runtime state"],
          [
            "Active schedules",
            schedules.filter((item: R) => item.status === "active").length,
            "Schedule state",
          ],
          [
            "Verified artifacts",
            artifacts.filter((item: R) => item.status === "verified").length,
            "Artifact registry",
          ],
          ["Last update", formatDate(data.updatedAt), "Dashboard state"],
        ]}
      />
      <div className="report-grid">
        {schedules.map((schedule: R) => (
          <article className="panel" key={schedule.id || schedule.name}>
            <span className="report-icon">▤</span>
            <div>
              <h2>{schedule.name}</h2>
              <p>{schedule.mode || "Chưa có chế độ"}</p>
              <small>
                {schedule.localTime || "—"} · {schedule.timezone || "—"}
              </small>
            </div>
            <span className={`status ${slug(schedule.status)}`}>
              {labelStatus(schedule.status)}
            </span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate("/settings")}
            >
              Kiểm tra
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Mở cài đặt vận hành"
              onClick={() => navigate("/settings")}
            >
              •••
            </button>
          </article>
        ))}
      </div>
      <section className="panel export-panel">
        <div>
          <h2>Tệp đầu ra đã xác minh</h2>
          <p>Các tệp gần đây được tạo trong những lượt chạy sản phẩm.</p>
        </div>
        {artifacts.slice(0, 3).map((artifact: R) => (
          <span
            className="status ready"
            key={artifact.relativePath || artifact.name}
          >
            {artifact.status}: {artifact.name}
          </span>
        ))}
      </section>
    </div>
  )
}

function IntegrationsPage({ data }: { data: R }) {
  const navigate = useNavigate()
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Integrations"
        subtitle="Kiểm tra các kênh phân phối đã cấu hình và trạng thái hoạt động."
        action="Request integration"
      />
      <div className="integration-grid">
        <article className="panel">
          <Mark name="Dashboard API" />
          <div>
            <h2>Dashboard API</h2>
            <p>http://127.0.0.1:4318/api/dashboard</p>
          </div>
          <span className="status connected">Đã kết nối</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate("/settings")}
          >
            Quản lý
          </button>
        </article>
        {(data.targets || []).map((target: R) => (
          <article className="panel" key={target.id}>
            <Mark name={labelChannel(target.channel)} />
            <div>
              <h2>{labelChannel(target.channel)}</h2>
              <p>{target.name || target.account || target.id}</p>
            </div>
            <span
              className={`status ${slug(target.readiness?.state || target.status || "checking")}`}
            >
              {labelStatus(
                target.readiness?.state || target.status || "checking",
              )}
            </span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate(`/platforms/${slug(target.channel)}`)}
            >
              Kiểm tra
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}

function SettingsPage({ data }: { data: R }) {
  const [section, setSection] = useState("Workspace")
  const sections: Record<string, Array<[string, string]>> = {
    Workspace: [
      ["Timezone", "Asia/Saigon"],
      ["Dashboard revision", String(data.revision ?? "—")],
      ["Updated at", formatDate(data.updatedAt)],
    ],
    Data: [
      ["Campaigns", formatValue(data.campaignCount)],
      ["Targets", formatValue(data.targetCount)],
      ["Posts", formatValue(data.postCount)],
      ["Snapshots", formatValue((data.latestMetricSnapshots || []).length)],
    ],
    Automation: [
      ["Production", data.automation?.dailyProduction?.status || "—"],
      ["Browser tracking", data.automation?.browserTracking?.status || "—"],
      ["Schedules", formatValue((data.schedules || []).length)],
    ],
    Coverage: [
      ["Impressions", metricStatus(data, "impressions")],
      ["Clicks", metricStatus(data, "clicks")],
      ["Leads", metricStatus(data, "leads")],
    ],
  }
  return (
    <div className="page-shell route-page">
      <PageHeader
        data={data}
        title="Settings"
        subtitle="Xem cấu hình dashboard và những chỉ số đang có dữ liệu."
        action="Save changes"
      />
      <div className="settings-layout">
        <nav>
          {Object.keys(sections).map((key) => (
            <button
              type="button"
              className={section === key ? "active" : ""}
              onClick={() => setSection(key)}
              key={key}
            >
              {uiText(key)}
            </button>
          ))}
        </nav>
        <section className="panel settings-panel">
          <div className="panel-head">
            <div>
              <h2>{uiText(section)}</h2>
              <p>Thông tin chỉ đọc lấy từ dashboard đang kết nối.</p>
            </div>
          </div>
          {sections[section].map(([key, value]) => (
            <div className="setting-row" key={key}>
              <div>
                <b>{uiText(key)}</b>
                <span>Giá trị vận hành</span>
              </div>
              <span className="status ready">{value}</span>
            </div>
          ))}
          <div className="setting-save">
            <span className="status ready">Trạng thái vận hành · chỉ đọc</span>
          </div>
        </section>
      </div>
    </div>
  )
}

function PostDrawer({
  data,
  post,
  close,
}: {
  data: R
  post: R | null
  close: () => void
}) {
  if (!post) return null
  const target = targetFor(data, post.targetId)
  const url = validUrl(post.publicationUrl)
  const content = String(post.content || "Chưa có nội dung").trim()
  const [firstLine = "", ...bodyLines] = content.split("\n")
  const headline =
    firstLine.length > 160 ? `${firstLine.slice(0, 157).trimEnd()}…` : firstLine
  const body = (
    bodyLines.length ? bodyLines.join("\n") : firstLine.slice(headline.length)
  ).trim()
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" aria-label="Chi tiết bài đăng">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">CHI TIẾT SEED</span>
            <h2>{labelChannel(target?.channel)}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Đóng chi tiết"
            onClick={close}
          >
            ×
          </button>
        </div>
        <div className="drawer-content">
          <article className="drawer-post">
            <div className="drawer-post-meta">
              <Mark name={labelChannel(target?.channel)} />
              <span>
                <b>{labelStatus(post.status)}</b>
                <small>{formatDate(post.publishedAt || post.updatedAt)}</small>
              </span>
            </div>
            <h3>{headline || "Bài đăng"}</h3>
            {body && (
              <p>
                {body.slice(0, 1200)}
                {body.length > 1200 ? "…" : ""}
              </p>
            )}
            {url ? (
              <a
                className="secondary-button"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                Mở bài gốc ↗
              </a>
            ) : (
              <span className="status draft">Chưa có liên kết bài đăng</span>
            )}
          </article>
          <section className="drawer-metrics">
            <div className="drawer-section-heading">
              <h3>Số liệu bài đăng</h3>
              <span>Giá trị chưa có hiển thị “—”</span>
            </div>
            <div className="drawer-kpis">
              {trackingFields.map((key) => {
                const value = metricForPost(data, post, key)
                const coverage = coverageForPost(data, post, key)
                const detail =
                  coverage === "measured" && asNumber(value) !== null
                    ? "Đã đo"
                    : coverage === "unsupported"
                      ? "Nền tảng không cung cấp"
                      : "Chưa có số liệu"
                return (
                  <div key={key} className={`tracking-kpi ${coverage}`}>
                    <span>{trackingLabels[key]}</span>
                    <strong>{metricCell(value, trackingLabels[key])}</strong>
                    <em>{detail}</em>
                  </div>
                )
              })}
            </div>
          </section>
          <details className="drawer-evidence">
            <summary>Asset và bằng chứng</summary>
            <div className="drawer-section">
              <b>Asset</b>
              <p>{post.assetPath || "Chưa có đường dẫn tệp"}</p>
            </div>
            <div className="drawer-section">
              <b>Bằng chứng</b>
              <p>{post.evidence || "Chưa có ghi chú bằng chứng"}</p>
            </div>
          </details>
        </div>
      </aside>
    </>
  )
}

export default function RoutedPage({
  path,
  data,
  onSelect,
}: {
  path: string
  data: R
  onSelect: (post: R) => void
}) {
  const clean = path.split("/").filter(Boolean)
  if (clean[0] === "traffic")
    return <MetricPage data={data} type="traffic" onRow={onSelect} />
  if (clean[0] === "engagement")
    return <MetricPage data={data} type="engagement" onRow={onSelect} />
  if (clean[0] === "actions")
    return <MetricPage data={data} type="actions" onRow={onSelect} />
  if (clean[0] === "conversions")
    return <MetricPage data={data} type="conversions" onRow={onSelect} />
  if (clean[0] === "content-performance") return <ContentPage data={data} />
  if (clean[0] === "platforms" && clean[1])
    return <PlatformDetailPage data={data} channelId={clean[1]} />
  if (clean[0] === "platforms") return <PlatformsPage data={data} />
  if (clean[0] === "campaigns")
    return <CampaignsPage data={data} detail={clean[1]} />
  if (clean[0] === "posts") return <PostsPageV2 data={data} onRow={onSelect} />
  if (clean[0] === "markets") return <MarketsPage data={data} />
  if (clean[0] === "audience") return <AudiencePage data={data} />
  if (clean[0] === "signals") return <SignalsPage data={data} />
  if (clean[0] === "reports") return <ReportsPage data={data} />
  if (clean[0] === "integrations") return <IntegrationsPage data={data} />
  if (clean[0] === "settings") return <SettingsPage data={data} />
  return <MetricPage data={data} type="traffic" onRow={onSelect} />
}

export {
  PostDrawer,
  Pagination,
  usePagedRows,
  labelChannel,
  labelStatus,
  formatValue,
  formatDate,
  metricForPost,
  channelStats,
  asNumber,
  engagementTotal,
  downloadDashboard,
}
