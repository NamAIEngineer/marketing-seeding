import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocation, useNavigate } from "react-router"
import { LeadSummary, LeadsPage } from "./Leads"
import RoutedPage, {
  Mark,
  Pagination,
  PostDrawer,
  TrafficSourcesPanel,
  asNumber,
  channelStats,
  downloadDashboard,
  engagementTotal,
  formatDate,
  formatValue,
  labelChannel,
  labelStatus,
  metricForPost,
  usePagedRows,
} from "./Pages"
import { compactDisplayText } from "./display-safe.mjs"

type R = Record<string, any>
type Theme = "dark" | "light"

// Dashboard shell contract: KhÃ´ng cÃ³ dá»¯ liá»‡u mock · KhÃ´ng táº£i Ä‘Æ°á»£c dá»¯ liá»‡u · ÄÄƒng theo á»§y quyá»n chá»§ sá»Ÿ há»¯u.
// Không có dữ liệu mock · Không tải được dữ liệu · Đăng theo ủy quyền chủ sở hữu.

const iconPaths: Record<string, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  traffic: <path d="M4 19V9m6 10V5m6 14v-7m4 7V3" />,
  engagement: (
    <>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  actions: (
    <>
      <path d="m4 12 5 5L20 6" />
      <path d="M4 5h5M4 19h5" />
    </>
  ),
  conversions: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  content: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  platform: (
    <>
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="m8.6 10.5 6.8-3M8.6 13.5l6.8 3" />
    </>
  ),
  campaign: <path d="m3 11 18-5v12L3 14Zm4 4 1 6h4l-2-5" />,
  post: (
    <>
      <path d="M5 4h14v16H5zM8 8h8M8 12h6M8 16h4" />
    </>
  ),
  markets: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  audience: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 2.5-5 6-5s6 2 6 5M16 12c2.8 0 5 1.8 5 4" />
    </>
  ),
  signal: <path d="M4 17V7m4 13V4m4 13V7m4 13V4m4 13V7" />,
  report: <path d="M5 3h14v18H5zM8 15v2m4-6v6m4-9v9" />,
  integration: <path d="M8 12h8M5 9v6M19 9v6M8 6v12M16 6v12" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 15a2 2 0 0 0 .4 2l-3 3a2 2 0 0 0-2-.4 2 2 0 0 0-1.4 1.5h-4A2 2 0 0 0 7.6 19.6a2 2 0 0 0-2 .4l-3-3a2 2 0 0 0 .4-2A2 2 0 0 0 1.5 14v-4A2 2 0 0 0 3 8.9a2 2 0 0 0-.4-2l3-3a2 2 0 0 0 2 .4A2 2 0 0 0 10 2.8h4A2 2 0 0 0 15.4 4a2 2 0 0 0 2-.4l3 3a2 2 0 0 0-.4 2A2 2 0 0 0 21.5 10v4A2 2 0 0 0 19 15Z" />
    </>
  ),
}
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name] || iconPaths.overview}
    </svg>
  )
}

const navGroups = [
  { label: "", items: [["Tổng quan", "overview", "/"]] },
  {
    label: "Phân tích",
    items: [
      ["Lưu lượng truy cập", "traffic", "/traffic"],
      ["Tương tác", "engagement", "/engagement"],
      ["Hành động", "actions", "/actions"],
      ["Chuyển đổi", "conversions", "/conversions"],
      ["Hiệu quả nội dung", "content", "/content-performance"],
    ],
  },
  {
    label: "Phân phối",
    items: [
      ["Nền tảng", "platform", "/platforms"],
      ["Chiến dịch", "campaign", "/campaigns"],
      ["Bài đăng", "post", "/posts"],
    ],
  },
  {
    label: "Trí tuệ",
    items: [
      ["Thị trường", "markets", "/markets"],
      ["Đối tượng", "audience", "/audience"],
      ["Tín hiệu", "signal", "/signals"],
      ["Khách hàng tiềm năng", "audience", "/leads"],
    ],
  },
  {
    label: "",
    items: [
      ["Báo cáo", "report", "/reports"],
      ["Tích hợp", "integration", "/integrations"],
      ["Cài đặt", "settings", "/settings"],
    ],
  },
]
function Sidebar({
  path,
  signalCount,
  theme,
  onToggleTheme,
}: {
  path: string
  signalCount: number
  theme: Theme
  onToggleTheme: () => void
}) {
  const navigate = useNavigate()
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <i />
          <i />
          <i />
        </span>
        <span>Distribution OS</span>
      </div>
      <nav>
        {navGroups.map((group, index) => (
          <div className="nav-group" key={index}>
            {group.label && <div className="nav-label">{group.label}</div>}
            {group.items.map(([name, icon, href]) => (
              <button
                className={`nav-item ${
                  path === href || (href !== "/" && path.startsWith(href))
                    ? "active"
                    : ""
                }`}
                key={href}
                onClick={() => navigate(href)}
              >
                <Icon name={icon} />
                <span>{name}</span>
                {name === "Tín hiệu" && signalCount > 0 ? (
                  <em>{signalCount}</em>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={`Chuyển sang giao diện ${
            theme === "dark" ? "sáng" : "tối"
          }`}
          aria-pressed={theme === "light"}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          {theme === "dark" ? "Chế độ sáng" : "Chế độ tối"}
        </button>
        <div className="sync-card">
          <span className="live-dot" />
          <div>
            <strong>Dashboard đang hoạt động</strong>
            <small>API local đã kết nối</small>
          </div>
        </div>
      </div>
    </aside>
  )
}
function Header({
  data,
  title,
  loading,
  refresh,
}: {
  data: R
  title: string
  loading: boolean
  refresh: () => void
}) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <p>
          Hiệu quả phân phối, số đo và trạng thái vận hành từ nguồn dữ liệu
          thật.
        </p>
      </div>
      <div className="header-actions">
        <span className="sync-text">
          <span className="live-dot" />
          Cập nhật {formatDate(data.updatedAt)}
        </span>
        <button type="button" className="secondary-button" onClick={refresh}>
          {loading ? "Đang tải…" : "Làm mới"}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => downloadDashboard(data)}
        >
          Xuất dữ liệu
        </button>
      </div>
    </header>
  )
}
function KpiRow({ data }: { data: R }) {
  const navigate = useNavigate()
  const items = [
    [
      "Lượt hiển thị",
      data.totals?.impressions,
      data.metricCoverage?.impressions,
      "/traffic",
    ],
    [
      "Lượt tương tác",
      engagementTotal(data),
      data.metricCoverage?.reactions,
      "/engagement",
    ],
    ["Lượt nhấp", data.totals?.clicks, data.metricCoverage?.clicks, "/actions"],
    [
      "Khách hàng tiềm năng",
      data.totals?.leads,
      data.metricCoverage?.leads,
      "/conversions",
    ],
    ["Đã đăng", data.statuses?.published, null, "/posts?status=published"],
    ["Bản nháp", data.statuses?.draft, null, "/posts?status=draft"],
  ]
  return (
    <div className="kpi-grid">
      {items.map(([name, value, coverage, href]) => (
        <button
          type="button"
          className="kpi-card kpi-action"
          key={String(name)}
          onClick={() => navigate(String(href))}
        >
          <div className="kpi-label">
            {name}
            <span>Chi tiết ↗</span>
          </div>
          <div className="kpi-main">
            <strong>{formatValue(value)}</strong>
          </div>
          <div className="kpi-meta">
            <span
              className={asNumber(value) === null ? "negative" : "positive"}
            >
              {asNumber(value) === null
                ? "Chưa đo"
                : coverage?.measured
                  ? `${coverage.measured} bài có số đo`
                  : "Trạng thái vận hành"}
            </span>
            <span>Dữ liệu dashboard</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function TrafficChart({ data }: { data: R }) {
  const navigate = useNavigate()
  const ranked = (data.posts || [])
    .map((post: R) => ({
      post,
      value: asNumber(metricForPost(data, post, "impressions")),
      target: (data.targets || []).find((item: R) => item.id === post.targetId),
    }))
    .filter((item: R) => item.value !== null)
    .sort((a: R, b: R) => b.value - a.value)
    .slice(0, 8)
  const max = Math.max(1, ...ranked.map((item: R) => item.value))
  const latest = [...(data.latestMetricSnapshots || [])].sort(
    (a: R, b: R) =>
      Date.parse(b.capturedAt || "") - Date.parse(a.capturedAt || ""),
  )[0]
  return (
    <section className="panel chart-panel">
      <div className="panel-head">
        <div>
          <h2>Impressions theo bài</h2>
          <p>
            {ranked.length} bài có số đo trong phạm vi đang chọn · snapshot mới
            nhất {formatDate(latest?.capturedAt)}
          </p>
        </div>
        <span className="status ready">Snapshot thật</span>
      </div>
      {ranked.length ? (
        <div className="traffic-bars">
          {ranked.map(({ post, value, target }: R) => (
            <button
              type="button"
              key={post.id}
              className="traffic-bar-row"
              onClick={() => navigate("/posts")}
              title="Mở danh sách bài trong phạm vi đang chọn"
            >
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
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          Chưa có impressions được đo trong phạm vi này. Không có chuỗi lịch sử
          để vẽ xu hướng.
        </div>
      )}
    </section>
  )
}

function ReadinessPanel({ data }: { data: R }) {
  const stats = channelStats(data)
  return (
    <section className="panel market-panel">
      <div className="panel-head">
        <div>
          <h2>Mức độ sẵn sàng vận hành</h2>
          <p>Trạng thái sẵn sàng của các kênh đã cấu hình.</p>
        </div>
      </div>
      <div className="market-share">
        <div className="market-total">
          <span>
            <i className="vn" />
            Kênh sẵn sàng
          </span>
          <strong>
            {formatValue(
              stats.filter(
                (item: R) => item.target?.readiness?.state === "ready",
              ).length,
            )}
          </strong>
          <small>trạng thái vận hành</small>
        </div>
        <div className="share-bar">
          {stats.map((item: R, index: number) => (
            <i
              key={item.id}
              style={{
                width: `${100 / Math.max(1, stats.length)}%`,
                background:
                  item.target?.readiness?.state === "ready"
                    ? "var(--green)"
                    : index % 2
                      ? "var(--blue)"
                      : "var(--purple)",
              }}
            />
          ))}
        </div>
        <div className="market-total right">
          <span>
            <i className="global" />
            Kênh
          </span>
          <strong>{formatValue(data.targetCount)}</strong>
          <small>đã cấu hình</small>
        </div>
      </div>
      <div className="comparison-table">
        {stats.slice(0, 7).map((item: R) => {
          const summary =
            item.target?.readiness?.summary || "Chưa có mô tả trạng thái"
          return (
            <div className="compare-row" key={item.id}>
              <span>{item.label}</span>
              <b>{labelStatus(item.target?.readiness?.state || "checking")}</b>
              <b title={summary}>{summary}</b>
            </div>
          )
        })}
      </div>
    </section>
  )
}
function SourcesPanel({ data }: { data: R }) {
  const stats = channelStats(data)
  const navigate = useNavigate()
  return (
    <section className="panel sources-panel">
      <div className="panel-head">
        <div>
          <h2>Nguồn phân phối</h2>
          <p>Nền tảng đã cấu hình trong registry; bấm dòng để mở chi tiết.</p>
        </div>
        <span className="status ready">{stats.length} nền tảng</span>
      </div>
      <div className="source-list">
        {stats.map((item: R) => (
          <button
            type="button"
            className="source-row source-row-button"
            key={item.id}
            onClick={() =>
              navigate(`/platforms/${item.id.replaceAll("_", "-")}`)
            }
          >
            <Mark name={item.label} />
            <span>
              <b>{item.label}</b>
              <small>
                {formatValue(item.posts)} bài ·{" "}
                {labelStatus(item.target?.readiness?.state || "checking")}
              </small>
            </span>
            <strong>{formatValue(item.impressions)}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}
function LifecycleFunnel({ data }: { data: R }) {
  const values = [
    ["Chiến dịch", data.campaignCount],
    ["Kênh", data.targetCount],
    ["Bài đăng", data.postCount],
    ["Đã đăng", data.statuses?.published],
    [
      "Có số đo",
      (data.posts || []).filter(
        (post: R) => metricForPost(data, post, "impressions") !== null,
      ).length,
    ],
  ]
  return (
    <section className="panel funnel-panel full-span">
      <div className="panel-head">
        <div>
          <h2>Quy trình phân phối</h2>
          <p>Từ cấu hình chiến dịch đến bằng chứng hiệu quả.</p>
        </div>
      </div>
      <div className="funnel-steps">
        {values.map(([name, value], index) => (
          <div key={String(name)}>
            <span>{index + 1}</span>
            <small>{name}</small>
            <strong>{formatValue(value)}</strong>
            {index < values.length - 1 ? <i>→</i> : null}
          </div>
        ))}
      </div>
    </section>
  )
}
function UserActions({ data }: { data: R }) {
  const actions = [
    ["Cảm xúc", data.totals?.reactions],
    ["Bình luận", data.totals?.comments],
    ["Chia sẻ", data.totals?.shares],
    ["Lượt nhấp", data.totals?.clicks],
    ["Khách hàng tiềm năng", data.totals?.leads],
  ]
  return (
    <section className="panel actions-panel">
      <div className="panel-head">
        <div>
          <h2>Hành động người dùng</h2>
          <p>
            Chỉ hiển thị số liệu nền tảng cung cấp; dữ liệu thiếu giữ ở trạng
            thái chưa rõ.
          </p>
        </div>
      </div>
      <div className="action-grid">
        {actions.map(([name, value]) => (
          <div key={String(name)}>
            <span>{name}</span>
            <strong>{formatValue(value)}</strong>
            <small>{asNumber(value) === null ? "Chưa đo" : "Đã đo"}</small>
          </div>
        ))}
      </div>
    </section>
  )
}
function ChannelTable({ data }: { data: R }) {
  const stats = channelStats(data)
  const navigate = useNavigate()
  return (
    <section className="panel full-span">
      <div className="panel-head table-title">
        <div>
          <h2>Hiệu quả theo nền tảng</h2>
          <p>
            Số đo theo bài được nối với trạng thái cấu hình; chọn dòng để xem
            bài chi tiết.
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Nền tảng</th>
              <th>Kênh</th>
              <th>Bài đăng</th>
              <th>Đã đăng</th>
              <th>Lượt hiển thị</th>
              <th>Lượt tương tác</th>
              <th>Sẵn sàng</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((item: R) => (
              <tr
                key={item.id}
                className="clickable"
                onClick={() => navigate(`/platforms/${item.id}`)}
              >
                <td>
                  <span className="platform-cell">
                    <Mark name={item.label} />
                    <b>{item.label}</b>
                  </span>
                </td>
                <td>{formatValue(item.targets)}</td>
                <td>{formatValue(item.posts)}</td>
                <td>
                  {formatValue(
                    (data.posts || []).filter(
                      (post: R) =>
                        post.targetId === item.target?.id &&
                        post.status === "published",
                    ).length,
                  )}
                </td>
                <td>{formatValue(item.impressions)}</td>
                <td>{formatValue(item.engagements)}</td>
                <td>
                  <span
                    className={`status ${item.target?.readiness?.state || "checking"}`}
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
  )
}
function TopContent({ data, select }: { data: R; select: (post: R) => void }) {
  const rows = [...(data.posts || [])]
    .sort(
      (a: R, b: R) =>
        (asNumber(metricForPost(data, b, "impressions")) || -1) -
        (asNumber(metricForPost(data, a, "impressions")) || -1),
    )
    .slice(0, 5)
  return (
    <section className="panel content-panel full-span">
      <div className="panel-head">
        <div>
          <h2>Bài có hiệu quả cao nhất</h2>
          <p>
            Xếp theo lượt hiển thị đã đo; bài chưa có số liệu không bị xem là 0.
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Bài đăng</th>
              <th>Nền tảng</th>
              <th>Trạng thái</th>
              <th>Lượt hiển thị</th>
              <th>Lượt tương tác</th>
              <th>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((post: R) => {
              const target = (data.targets || []).find(
                (item: R) => item.id === post.targetId,
              )
              return (
                <tr
                  className="clickable"
                  onClick={() => select(post)}
                  key={post.id}
                >
                  <td>
                    <span className="post-title">
                      <b>
                        {String(post.content || "Chưa có nội dung")
                          .split("\n")[0]
                          .slice(0, 105)}
                      </b>
                      <small>{post.id}</small>
                    </span>
                  </td>
                  <td>{labelChannel(target?.channel)}</td>
                  <td>
                    <span className={`status ${post.status}`}>
                      {labelStatus(post.status)}
                    </span>
                  </td>
                  <td>
                    {formatValue(metricForPost(data, post, "impressions"))}
                  </td>
                  <td>
                    {formatValue(metricForPost(data, post, "engagements"))}
                  </td>
                  <td>{formatDate(post.updatedAt || post.publishedAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
function Intelligence({ data }: { data: R }) {
  const stats = channelStats(data)
  return (
    <section className="intelligence-grid">
      <section className="panel world-map">
        <div className="panel-head">
          <div>
            <h2>Đối tượng theo thị trường</h2>
            <p>
              Cho biết người xem đến từ thị trường nào — chỉ hiện khi nền tảng
              thực sự cung cấp dữ liệu quốc gia hoặc khu vực.
            </p>
          </div>
        </div>
        <div className="empty-state">
          API hiện chưa nhận được số liệu theo quốc gia hoặc thị trường.
          Dashboard không tự suy đoán vị trí người xem từ tên nền tảng hay nội
          dung bài.
        </div>
      </section>
      <section className="panel heatmap-panel">
        <div className="panel-head">
          <div>
            <h2>Hiệu quả đo được theo nền tảng</h2>
            <p>Đối chiếu lượt hiển thị, tương tác và hành động theo kênh.</p>
          </div>
        </div>
        <div className="heat-table">
          <div>
            <b>Nền tảng</b>
            <b>Hiển thị</b>
            <b>Tương tác</b>
            <b>Hành động</b>
          </div>
          {stats.map((item: R) => (
            <div key={item.id}>
              <span>{item.label}</span>
              <i style={{ opacity: item.impressions === null ? 0.2 : 0.9 }}>
                {formatValue(item.impressions)}
              </i>
              <i style={{ opacity: item.engagements === null ? 0.2 : 0.9 }}>
                {formatValue(item.engagements)}
              </i>
              <i style={{ opacity: item.clicks === null ? 0.2 : 0.9 }}>
                {formatValue(item.clicks)}
              </i>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
function SignalsAndLive({ data }: { data: R }) {
  const signals = (data.trafficPulse || data.signals || []).slice(0, 4)
  const snapshots: R[] = [...(data.latestMetricSnapshots || [])].sort(
    (a: R, b: R) =>
      new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  )
  const interactions: R[] = [
    ...(data.recentInteractions || data.interactions || []),
  ].sort(
    (a: R, b: R) =>
      new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  )
  const snapshotPage = usePagedRows<R>(
    snapshots,
    (item: R) => `${item.postId}-${item.capturedAt}`,
    "snapshots",
  )
  const interactionPage = usePagedRows<R>(
    interactions,
    (item: R) => item.id || `${item.postId}-${item.capturedAt}-${item.text}`,
    "interactions",
  )
  const posts: Record<string, R> = Object.fromEntries(
    (data.posts || []).map((post: R) => [post.id, post]),
  )
  return (
    <div className="bottom-grid">
      <section className="panel signals-panel">
        <div className="panel-head">
          <div>
            <h2>Tín hiệu tăng trưởng</h2>
            <p>Gợi ý trực tiếp từ dữ liệu theo dõi đã kết nối.</p>
          </div>
        </div>
        {signals.length ? (
          <div className="signal-grid">
            {signals.map((signal: R, index: number) => (
              <div
                className={`signal-card ${
                  signal.priority === "due" ? "down" : index % 2 ? "bolt" : ""
                }`}
                key={`${signal.postId || signal.id || "signal"}-${index}`}
              >
                <span className="signal-icon">
                  {signal.priority === "due" ? "↓" : "↑"}
                </span>
                <span>
                  <strong>
                    {signal.recommendation ||
                      signal.title ||
                      "Tín hiệu dữ liệu"}
                  </strong>
                  <p>
                    {signal.priority === "due" ? "Đến hạn rà soát" : "Cơ hội"} ·{" "}
                    {formatDate(signal.nextReviewAt || signal.updatedAt)}
                  </p>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">Chưa có tín hiệu mới.</div>
        )}
      </section>
      <section className="panel live-panel">
        <div className="panel-head">
          <div>
            <h2>Hoạt động gần đây</h2>
            <p>
              Nhật ký các lần đo gần nhất. Số liệu được đối soát mỗi ngày lúc
              23:30, không phải cập nhật trực tiếp.
            </p>
          </div>
          <span className="live-dot" />
        </div>
        <div className="activity-block">
          <h3>Lịch sử số liệu bài đăng</h3>
          <div className="live-list">
            {snapshotPage.rows.length ? (
              snapshotPage.rows.map((snapshot: R) => {
                const post = posts[snapshot.postId]
                const target = (data.targets || []).find(
                  (item: R) => item.id === post?.targetId,
                )
                return (
                  <div key={`${snapshot.postId}-${snapshot.capturedAt}`}>
                    <span className="live-dot" />
                    <span>
                      <b>{labelChannel(target?.channel)}</b>
                      <small>
                        {formatValue(snapshot.impressions, " lượt hiển thị")} ·{" "}
                        {formatValue(snapshot.reactions, " lượt cảm xúc")}
                      </small>
                    </span>
                    <time>
                      {formatDate(snapshot.capturedAt).split(",")[1] ||
                        formatDate(snapshot.capturedAt)}
                    </time>
                  </div>
                )
              })
            ) : (
              <div className="empty-state">Chưa có bản ghi số liệu.</div>
            )}
          </div>
          <Pagination
            page={snapshotPage.page}
            pageCount={snapshotPage.pageCount}
            total={snapshots.length}
            setPage={snapshotPage.setPage}
          />
        </div>
        <div className="activity-block">
          <h3>Bình luận và tương tác đã ghi nhận</h3>
          <div className="live-list">
            {interactionPage.rows.length ? (
              interactionPage.rows.map((interaction: R) => {
                const post = posts[interaction.postId]
                const target = (data.targets || []).find(
                  (item: R) => item.id === post?.targetId,
                )
                return (
                  <div
                    key={
                      interaction.id ||
                      `${interaction.postId}-${interaction.capturedAt}`
                    }
                  >
                    <span className="live-dot" />
                    <span>
                      <b>
                        {labelChannel(target?.channel)} ·{" "}
                        {{
                          comment: "Bình luận",
                          reply: "Phản hồi",
                          reaction: "Cảm xúc",
                          like: "Lượt thích",
                          share: "Chia sẻ",
                          click: "Lượt nhấp",
                        }[
                          String(interaction.kind || "comment").toLowerCase()
                        ] || "Tương tác"}
                      </b>
                      <small>
                        {interaction.text || "Tương tác được ghi nhận"}
                      </small>
                    </span>
                    <time>{formatDate(interaction.capturedAt)}</time>
                  </div>
                )
              })
            ) : (
              <div className="empty-state">Chưa ghi nhận tương tác.</div>
            )}
          </div>
          <Pagination
            page={interactionPage.page}
            pageCount={interactionPage.pageCount}
            total={interactions.length}
            setPage={interactionPage.setPage}
          />
        </div>
      </section>
    </div>
  )
}

const communityRepoLabels: Record<string, string> = {
  "design-os-3d-blender": "Sản phẩm 3D",
  "design-os-code2flow": "Vibe Code",
  "design-os-svg-animation": "SVG Animation",
}
const communityStatusLabels: Record<string, string> = {
  joined: "Đã tham gia",
  pending: "Chờ duyệt",
  rejected: "Bị từ chối",
  blocked: "Bị chặn",
  not_applicable: "Không áp dụng",
  unknown: "Chưa xác minh",
}
const communityPostLabels: Record<string, string> = {
  allowed: "Được đăng",
  manual_review: "Chờ kiểm duyệt bài",
  blocked: "Bị chặn đăng",
  not_applicable: "Không áp dụng",
  unknown: "Chưa rõ quyền đăng",
}
function CommunityOverviewLegacy({ data }: { data: R }) {
  const [filter, setFilter] = useState("all")
  const rows = [...(data.communityMemberships || [])].sort((a: R, b: R) =>
    String(b.updatedAt || b.checkedAt || "").localeCompare(
      String(a.updatedAt || a.checkedAt || ""),
    ),
  )
  const filtered =
    filter === "all"
      ? rows
      : rows.filter(
          (item: R) =>
            item.membershipStatus === filter || item.postStatus === filter,
        )
  const grouped = Object.entries(communityRepoLabels).map(
    ([repo, label]) =>
      [
        repo,
        label,
        filtered.filter((item: R) => item.productRepo === repo),
      ] as const,
  )
  const pending = rows.filter(
    (item: R) => item.membershipStatus === "pending",
  ).length
  const blocked = rows.filter(
    (item: R) =>
      item.membershipStatus === "blocked" ||
      item.postStatus === "blocked" ||
      item.postStatus === "manual_review",
  ).length
  return (
    <section className="panel community-panel full-span">
      <div className="panel-head">
        <div>
          <h2>Cộng đồng theo repo</h2>
          <p>
            Trạng thái tham gia và quyền đăng được kiểm chứng trên từng nền
            tảng.
          </p>
        </div>
        <div className="community-summary">
          <span className="status pending">{pending} chờ duyệt</span>
          <span className="status blocked">{blocked} cần theo dõi</span>
        </div>
      </div>
      <div className="community-tools">
        <span>{rows.length} bản ghi cộng đồng</span>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="joined">Đã tham gia</option>
          <option value="pending">Chờ duyệt</option>
          <option value="blocked">Bị chặn / kiểm duyệt</option>
          <option value="rejected">Bị từ chối</option>
        </select>
      </div>
      <div className="community-groups">
        {grouped.map(([repo, label, items]) => (
          <div className="community-repo" key={repo}>
            <div className="community-repo-head">
              <span className="track-dot" />
              <div>
                <b>{label}</b>
                <small>{repo}</small>
              </div>
              <strong>{items.length}</strong>
            </div>
            {items.length ? (
              <div
                className={`community-list${items.length > 10 ? " is-scrollable" : ""}`}
                aria-label={items.length > 10 ? `Danh sách cộng đồng ${repo}` : undefined}
                role={items.length > 10 ? "region" : undefined}
                tabIndex={items.length > 10 ? 0 : undefined}
              >
                {items.map((item: R) => (
                  <div className="community-row" key={item.id}>
                    <Mark name={labelChannel(item.platform)} />
                    <span className="community-name">
                      <b>{item.communityName}</b>
                      <small>
                        {item.platform} ·{" "}
                        {item.notes || item.evidence || "Đã kiểm tra"}
                      </small>
                    </span>
                    <span className={`status ${item.membershipStatus}`}>
                      {communityStatusLabels[item.membershipStatus] ||
                        item.membershipStatus}
                    </span>
                    <span
                      className={`community-post-status ${item.postStatus}`}
                    >
                      {communityPostLabels[item.postStatus] || item.postStatus}
                    </span>
                    <time>{formatDate(item.checkedAt || item.updatedAt)}</time>
                    {item.communityUrl ? (
                      <a
                        href={item.communityUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Mở ↗
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                Chưa có cộng đồng được ghi nhận cho repo này.
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function latestMissionRecord(data: R, key: string) {
  const rows = Array.isArray(data?.[key]) ? data[key] : []
  return [...rows]
    .sort((left: R, right: R) =>
      String(right.updatedAt || right.latest?.generatedAt || "").localeCompare(
        String(left.updatedAt || left.latest?.generatedAt || ""),
      ),
    )
    .at(0) || null
}

function advisoryAction(value: unknown) {
  const labels: Record<string, string> = {
    publish: "Chuẩn bị đăng",
    engage: "Tương tác có ngữ cảnh",
    research: "Nghiên cứu thêm",
    wait: "Chờ thêm dữ liệu",
    do_nothing: "Không hành động",
  }
  return labels[String(value || "")] || "UNKNOWN"
}

function missionValue(value: unknown, hasRecord: boolean) {
  return hasRecord && value !== null && value !== undefined ? String(value) : "UNKNOWN"
}

function MissionControlPanel({ data }: { data: R }) {
  const strategy = latestMissionRecord(data, "strategy")?.latest || null
  const learning = latestMissionRecord(data, "learning")?.latest || null
  const outcome = latestMissionRecord(data, "outcomes")?.latest || null
  const cycle = data?.automation?.controlCycle || null
  const reasons = (record: R | null) =>
    Array.isArray(record?.reasons) && record.reasons.length
      ? record.reasons.join(" · ")
      : "Chưa có lý do được ghi nhận"
  const measuredFields = outcome?.metrics?.coverage
    ? Object.entries(outcome.metrics.coverage)
        .filter(([, value]: [string, any]) => Number(value?.measured || 0) > 0)
        .map(([field]) => field)
    : []
  const cycleStatus = cycle
    ? cycle.running
      ? "Đang chạy"
      : cycle.enabled
        ? cycle.lastCompletedAt
          ? "Đã chạy theo lịch"
          : "Đã bật · chưa chạy"
        : "Đang tắt"
    : "Chưa có runtime"
  const accountRuntime = Array.isArray(data?.accountRuntime)
    ? data.accountRuntime
    : Array.isArray(data?.executionAccounts)
      ? data.executionAccounts
      : []
  const accountAgents = data?.accountAgents && typeof data.accountAgents === "object" ? data.accountAgents : null
  const accountAgentRows = Array.isArray(accountAgents?.agents) ? accountAgents.agents : []
  const accountAgentSelection = accountAgents?.selection && typeof accountAgents.selection === "object" ? accountAgents.selection : null
  const accountRows = accountRuntime.map((account: R) => ({
    id: String(account?.id || "UNKNOWN"),
    platform: String(account?.platform || "UNKNOWN"),
    sessionMode: String(account?.sessionMode || "UNKNOWN"),
    authMode: String(account?.authMode || "UNKNOWN"),
    eligible: account?.eligibleForExecution === true,
    blocker: String(account?.currentBlocker || "UNKNOWN"),
    reasons: Array.isArray(account?.ineligibilityReasons)
      ? account.ineligibilityReasons.map((reason: unknown) => String(reason)).filter(Boolean)
      : [],
  }))
  const discoveryOpportunities = Array.isArray(data?.discoveryOpportunities)
    ? data.discoveryOpportunities
    : []
  const engagementCandidates = Array.isArray(data?.engagementContext?.candidates)
    ? data.engagementContext.candidates
    : []
  const conversationContinuity = data?.conversationContinuity && typeof data.conversationContinuity === "object"
    ? data.conversationContinuity
    : null
  const conversationRows = Array.isArray(data?.engagementContext?.conversations)
    ? data.engagementContext.conversations.slice(0, 5)
    : []
  const continuityRows = Array.isArray(conversationContinuity?.conversations)
    ? conversationContinuity.conversations
    : []
  const productIntelligence = Array.isArray(data?.productIntelligence)
    ? data.productIntelligence
    : []
  const readyProductIntelligence = productIntelligence.filter(
    (item: R) => item?.handoff?.readinessStatus === "READY",
  ).length
  const authorityRows = Array.isArray(data?.campaignAuthorityRuntime)
    ? data.campaignAuthorityRuntime
    : []
  const authorityBlockers = authorityRows.filter((item: R) => item?.status !== "READY_FOR_BOUNDED_DELEGATION")
  const accountPoolRows = Array.isArray(data?.authorizedAccountPoolSummary)
    ? data.authorizedAccountPoolSummary
    : []
  const blockedAccountPools = accountPoolRows.filter((item: R) => item?.autonomousPath !== "AVAILABLE_ADVISORY")
  const channelCapabilities = Array.isArray(data?.channelCapabilities)
    ? data.channelCapabilities
    : []
  const blockedChannels = channelCapabilities.filter((item: R) => item?.status !== "READY")
  const factorySandbox = data?.productFactorySandbox && typeof data.productFactorySandbox === "object"
    ? data.productFactorySandbox
    : null
  const browserRuntime = data?.browserRuntime && typeof data.browserRuntime === "object"
    ? data.browserRuntime
    : null
  const browserRuntimeRows = Array.isArray(browserRuntime?.routes) ? browserRuntime.routes.slice(0, 12) : []
  const gpmCatalog = data?.gpmAccountCatalog && typeof data.gpmAccountCatalog === "object" ? data.gpmAccountCatalog : null
  const gpmProfiles = Array.isArray(gpmCatalog?.catalog?.profiles) ? gpmCatalog.catalog.profiles.slice(0, 12) : []
  const gpmAccounts = Array.isArray(gpmCatalog?.accounts) ? gpmCatalog.accounts.slice(0, 12) : []
  const sessionReadiness = data?.sessionReadiness && typeof data.sessionReadiness === "object" ? data.sessionReadiness : null
  const sessionRows = Array.isArray(sessionReadiness?.rows) ? sessionReadiness.rows.slice(0, 12) : []
  const camoufoxSession = data?.camoufoxSession && typeof data.camoufoxSession === "object" ? data.camoufoxSession : null
  const camoufoxSessionRows = Array.isArray(camoufoxSession?.sessions) ? camoufoxSession.sessions.slice(0, 12) : []
  const nineRouter = data?.nineRouter && typeof data.nineRouter === "object" ? data.nineRouter : null
  const provisioning = data?.provisioning && typeof data.provisioning === "object" ? data.provisioning : null
  const fanoutPlans = Array.isArray(data?.fanoutPlans) ? data.fanoutPlans : []
  const unsupportedClaimCount = productIntelligence.reduce((total: number, item: R) => {
    const document = item?.document && typeof item.document === "object" ? item.document : {}
    return total + (Array.isArray(document.CLAIMS_WE_CANNOT_MAKE) ? document.CLAIMS_WE_CANNOT_MAKE.length : 0)
  }, 0)
  const executionBlockers = Array.isArray(data?.executionRuntime?.blockers)
    ? data.executionRuntime.blockers
    : []
  const accountBlockers = accountRows.filter((account) => !account.eligible).length
  const currentBlockerCount = executionBlockers.length + accountBlockers + authorityBlockers.length + blockedAccountPools.length + blockedChannels.length + (factorySandbox?.executionEligible === true ? 0 : factorySandbox ? 1 : 0)
  const opportunityRows = discoveryOpportunities.slice(0, 5)
  const intelligenceRows = productIntelligence.slice(0, 4)
  const productIntelligenceRuntime = Array.isArray(data?.productIntelligenceRuntime)
    ? data.productIntelligenceRuntime.slice(0, 64)
    : []
  const compactText = compactDisplayText
  const strategyHistory = (Array.isArray(data?.strategy) ? data.strategy : [])
    .flatMap((row: R) => (Array.isArray(row?.recent) ? row.recent : row?.latest ? [row.latest] : []).map((item: R) => ({ ...item, campaignId: row.campaignId })))
    .sort((left: R, right: R) => String(right?.createdAt || right?.timestamp || "").localeCompare(String(left?.createdAt || left?.timestamp || "")))
    .slice(0, 5)
  const learningHistory = (Array.isArray(data?.learning) ? data.learning : [])
    .flatMap((row: R) => (Array.isArray(row?.recent) ? row.recent : row?.latest ? [row.latest] : []).map((item: R) => ({ ...item, campaignId: row.campaignId })))
    .sort((left: R, right: R) => String(right?.generatedAt || right?.createdAt || "").localeCompare(String(left?.generatedAt || left?.createdAt || "")))
    .slice(0, 5)
  const fitLabel = (fit: R | null | undefined) => fit
    ? [fit.audience?.status, fit.channel?.status, fit.locale?.status].map((value) => String(value || "UNKNOWN")).join(" · ")
    : "No fit projection"
  const continuityFor = (row: R) => continuityRows.find(
    (item: R) => item?.postRef && row?.postRef && item.postRef === row.postRef,
  ) || null
  return (
    <section className="panel mission-control-panel full-span">
      <div className="panel-head">
        <div>
          <h2>Mission Control</h2>
          <p>
            Quan sát quyết định advisory, coverage và chu kỳ điều khiển từ state
            hiện tại. Panel này không cấp quyền và không thực hiện hành động.
          </p>
        </div>
        <span className="status completed">Chỉ đọc · advisory</span>
      </div>
      <div className="mission-control-grid">
        <article>
          <span className="mission-eyebrow">Chu kỳ điều khiển</span>
          <strong>{cycleStatus}</strong>
          <small>
            {cycle?.lastCompletedAt
              ? `Lần cuối: ${formatDate(cycle.lastCompletedAt)}`
              : "Chưa có bằng chứng chạy chu kỳ"}
          </small>
        </article>
        <article>
          <span className="mission-eyebrow">Next best action</span>
          <strong>{advisoryAction(strategy?.action)}</strong>
          <small>{reasons(strategy)}</small>
        </article>
        <article>
          <span className="mission-eyebrow">Learning signal</span>
          <strong>{advisoryAction(learning?.action)}</strong>
          <small>{reasons(learning)}</small>
        </article>
        <article>
          <span className="mission-eyebrow">Publication / metrics</span>
          <strong>
            {missionValue(outcome?.publication?.verified, Boolean(outcome))} verified ·{" "}
            {missionValue(outcome?.publication?.unknown, Boolean(outcome))} UNKNOWN
          </strong>
          <small>
            {outcome
              ? `${outcome.metrics?.snapshots ?? "UNKNOWN"} snapshot · ${measuredFields.length ? measuredFields.join(", ") : "chưa có field đo được"}`
              : "Chưa có outcome summary"}
          </small>
        </article>
      </div>
      <div className="mission-detail-grid" aria-label="Advisory strategy and learning history">
        <section className="mission-detail-section" aria-label="Recent strategy decisions">
          <div className="mission-account-head">
            <div>
              <span className="mission-eyebrow">Recent strategy decisions</span>
              <small>Top 5 advisory records · không thay đổi authority hoặc execution</small>
            </div>
            <span className="status">{strategyHistory.length}/5</span>
          </div>
          {strategyHistory.length ? (
            <div className="mission-detail-list">
              {strategyHistory.map((item: R, index: number) => {
                const action = String(item?.action || "UNKNOWN")
                const reasons = Array.isArray(item?.reasons) ? item.reasons.slice(0, 8) : []
                const evidence = Array.isArray(item?.evidence) ? item.evidence.slice(0, 8) : []
                return <article key={String(item?.decisionId || `${item?.campaignId || "UNKNOWN"}-${index}`)}>
                  <div className="mission-detail-title">
                    <strong>{compactText(item?.campaignId, "UNKNOWN", 70)}</strong>
                    <span className={action === "do_nothing" || action === "wait" ? "status draft" : "status completed"}>{advisoryAction(action)}</span>
                  </div>
                  <small>{formatDate(item?.createdAt || item?.timestamp)} · decision {compactText(item?.decisionId, "UNKNOWN", 24)}</small>
                  <small>Reasons: {reasons.length ? reasons.map((reason: unknown) => compactText(reason, "UNKNOWN", 90)).join(" · ") : "UNKNOWN"}</small>
                  <small>Evidence: {evidence.length ? evidence.map((ref: unknown) => compactText(ref, "UNKNOWN", 90)).join(" · ") : "UNKNOWN"}</small>
                </article>
              })}
            </div>
          ) : <div className="empty-state">Chưa có strategy decision.</div>}
        </section>
        <section className="mission-detail-section" aria-label="Recent learning feedback">
          <div className="mission-account-head">
            <div>
              <span className="mission-eyebrow">Recent learning feedback</span>
              <small>Top 5 advisory records · UNKNOWN và metric uncertainty được giữ nguyên</small>
            </div>
            <span className="status">{learningHistory.length}/5</span>
          </div>
          {learningHistory.length ? (
            <div className="mission-detail-list">
              {learningHistory.map((item: R, index: number) => {
                const observation = item?.observation && typeof item.observation === "object" ? item.observation : {}
                const metricAdvisory = item?.postAttributionContext?.metricAdvisory
                const metricCounts = metricAdvisory?.counts && typeof metricAdvisory.counts === "object" ? metricAdvisory.counts : null
                const reasons = Array.isArray(item?.reasons) ? item.reasons.slice(0, 8) : []
                return <article key={String(item?.feedbackId || `${item?.campaignId || "UNKNOWN"}-${index}`)}>
                  <div className="mission-detail-title">
                    <strong>{compactText(item?.campaignId, "UNKNOWN", 70)}</strong>
                    <span className="status draft">{advisoryAction(item?.action)}</span>
                  </div>
                  <small>{formatDate(item?.generatedAt || item?.createdAt)} · feedback {compactText(item?.feedbackId, "UNKNOWN", 24)}</small>
                  <small>Reasons: {reasons.length ? reasons.map((reason: unknown) => compactText(reason, "UNKNOWN", 90)).join(" · ") : "UNKNOWN"}</small>
                  <small>Publication: {compactText(observation?.publication?.verified, "UNKNOWN", 24)} verified · {compactText(observation?.publication?.unknown, "UNKNOWN", 24)} UNKNOWN</small>
                  <small>Metric assessment: {metricCounts ? Object.entries(metricCounts).filter(([, count]) => Number(count) > 0).map(([name, count]) => `${name}:${count}`).join(" · ") || "UNOBSERVED" : "UNKNOWN"}</small>
                </article>
              })}
            </div>
          ) : <div className="empty-state">Chưa có learning feedback.</div>}
        </section>
      </div>
      <div className="mission-account-runtime">
        <div className="mission-account-head">
          <div>
            <span className="mission-eyebrow">Account agent selection</span>
            <small>Read-only advisory selection · execution readiness remains authoritative</small>
          </div>
          <span className="status">{accountAgentSelection?.status || "UNKNOWN"}</span>
        </div>
        {accountAgentRows.length ? (
          <div className="mission-account-list">
            {accountAgentRows.map((agent: R) => {
              const runtime = accountRows.find((row) => row.id.includes(String(agent.accountId || "")))
              const selected = String(agent.agentId || "") === String(accountAgentSelection?.selectedAgentId || "")
              return <article key={String(agent.agentId || agent.accountId || "UNKNOWN")}>
                <div className="mission-account-title">
                  <strong>{compactText(agent.accountId, "UNKNOWN", 60)}</strong>
                  <span className={agent.eligibilityState === "ELIGIBLE" ? "status completed" : "status failed"}>
                    {compactText(agent.eligibilityState, "UNKNOWN", 24)}{selected ? " · selected" : ""}
                  </span>
                </div>
                <small>{compactText(agent.platform, "UNKNOWN", 32)} · {compactText(agent.provider, "UNKNOWN", 32)} · advisory reasons: {Array.isArray(agent.eligibilityReasons) && agent.eligibilityReasons.length ? agent.eligibilityReasons.join(" · ") : "—"}</small>
                <small>Execution runtime: {runtime ? (runtime.eligible ? "ELIGIBLE" : `INELIGIBLE · ${runtime.blocker || "UNKNOWN"}`) : "UNKNOWN"}</small>
              </article>
            })}
          </div>
        ) : <div className="empty-state">Chưa có account agent projection.</div>}
      </div>
      <div className="mission-account-runtime">
        <div className="mission-account-head">
          <div><span className="mission-eyebrow">9Router model gateway</span><small>Live authenticated catalog · quota inferred only from observed requests</small></div>
          <span className={nineRouter?.authenticated ? "status completed" : "status draft"}>{compactText(nineRouter?.catalogStatus, "CONNECT_REQUIRED", 32)}</span>
        </div>
        <div className="mission-account-list">
          <article><div className="mission-account-title"><strong>{compactText(nineRouter?.selection?.model, "UNKNOWN", 100)}</strong><span className="status">{compactText(nineRouter?.quotaStatus, "UNVERIFIED", 32)}</span></div><small>{compactText(nineRouter?.selection?.reason, "No model selected", 180)}</small><small>{Array.isArray(nineRouter?.models) ? nineRouter.models.length : 0} models · binary {compactText(nineRouter?.binary?.version, "UNKNOWN", 24)} · key {nineRouter?.security?.keyStored ? compactText(nineRouter?.security?.keyStorage, "stored", 40) : "CONNECT_REQUIRED"}</small></article>
          <article><div className="mission-account-title"><strong>Provisioning</strong><span className="status">{compactText(provisioning?.nineRouter?.status, "UNKNOWN", 32)}</span></div><small>Camoufox {compactText(provisioning?.camoufox?.status, "UNKNOWN", 32)} · pinned {compactText(provisioning?.camoufox?.expectedVersion, "UNKNOWN", 20)}</small><small>Provider login remains user-owned in 9Router; no provider credentials imported.</small></article>
        </div>
      </div>
      <div className="mission-account-runtime">
        <div className="mission-account-head"><div><span className="mission-eyebrow">Campaign fan-out</span><small>All Social expands only to eligible social Account Agents; each row remains isolated.</small></div><span className="status">{fanoutPlans.reduce((count: number, plan: R) => count + Number(plan?.ready || 0), 0)} READY</span></div>
        {fanoutPlans.length ? <div className="mission-account-list">{fanoutPlans.slice(0, 4).map((plan: R) => <article key={String(plan.campaignId)}><div className="mission-account-title"><strong>{compactText(plan.campaignId, "UNKNOWN", 70)}</strong><span className="status">{compactText(plan.mode, "UNKNOWN", 32)}</span></div><small>{Array.isArray(plan.channels) ? plan.channels.join(" · ") : "UNKNOWN"} · {Number(plan.ready || 0)} ready · {Number(plan.blocked || 0)} blocked</small>{(plan.rows || []).slice(0, 8).map((row: R) => <small key={`${row.channel}:${row.accountId}`}>{row.channel}/{row.accountId}: {row.status} · {Array.isArray(row.reasons) && row.reasons.length ? row.reasons.join(" · ") : "eligible"}</small>)}</article>)}</div> : <div className="empty-state">Chưa có fan-out plan.</div>}
      </div>
      <div className="mission-account-runtime">
        <div className="mission-account-head">
          <div>
            <span className="mission-eyebrow">Account / session readiness</span>
            <small>Read-only projection · không đăng nhập, chọn account hoặc chạy browser</small>
          </div>
          <span className="status">{accountRows.length ? `${accountRows.length} account` : "UNKNOWN"}</span>
        </div>
        {accountRows.length ? (
          <div className="mission-account-list">
            {accountRows.map((account) => (
              <article key={account.id}>
                <div className="mission-account-title">
                  <strong>{account.id}</strong>
                  <span className={account.eligible ? "status completed" : "status failed"}>
                    {account.eligible ? "Eligible" : "Ineligible"}
                  </span>
                </div>
                <small>{account.platform} · {account.sessionMode} · {account.authMode}</small>
                <small>Blocker: {account.blocker}</small>
                <small>Reasons: {account.reasons.length ? account.reasons.join(" · ") : "—"}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">Chưa có account runtime projection.</div>
        )}
      </div>
      <div className="mission-account-runtime">
        <div className="mission-account-head">
          <div>
            <span className="mission-eyebrow">Browser runtime routing</span>
            <small>Read-only route/health projection · hệ thống tự chọn transport theo workload</small>
          </div>
          <span className="status">{browserRuntimeRows.length ? `${browserRuntimeRows.length} workload` : "UNKNOWN"}</span>
        </div>
        {browserRuntimeRows.length ? (
          <div className="mission-account-list">
            {browserRuntimeRows.map((row: R) => (
              <article key={String(row.workload)}>
                <div className="mission-account-title">
                  <strong>{compactText(row.workload, "UNKNOWN", 80)}</strong>
                  <span className={row.health?.state === "READY" ? "status completed" : "status draft"}>
                    {compactText(row.health?.state, "UNKNOWN", 24)}
                  </span>
                </div>
                <small>Route: {compactText(row.route, "UNKNOWN", 40)} · transport: {compactText(row.transportId, "UNKNOWN", 80)}</small>
                <small>Runtime: {compactText(row.runtimeIdentity?.provider, "UNKNOWN", 60)} {compactText(row.runtimeIdentity?.providerVersion, "", 40)}</small>
                <small>Reason: {compactText(row.health?.reason || row.reason, "UNKNOWN", 120)}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">Chưa có browser runtime projection.</div>
        )}
      </div>
      <div className="mission-account-runtime">
        <div className="mission-account-head">
          <div><span className="mission-eyebrow">GPM account catalog</span><small>Read-only probe · fingerprints only · không điều khiển profile</small></div>
          <span className="status">{gpmCatalog?.catalog?.state || "UNKNOWN"}</span>
        </div>
        {gpmCatalog && (gpmProfiles.length || gpmAccounts.length) ? (
          <div className="mission-account-list">
            <article><div className="mission-account-title"><strong>Catalog state counts</strong><span className="status">{gpmCatalog.summary?.catalogProfiles ?? 0} profiles</span></div><small>Bound {gpmCatalog.summary?.boundProfiles ?? 0} · Unbound {gpmCatalog.summary?.unboundProfiles ?? 0} · Ambiguous {gpmCatalog.summary?.ambiguousProfiles ?? 0} · Missing {gpmCatalog.summary?.missingProfiles ?? 0}</small></article>
            {gpmProfiles.map((row: R) => <article key={String(row.profileFingerprint)}><div className="mission-account-title"><strong>{compactText(row.name, "UNKNOWN", 60)}</strong><span className="status">{row.linkage?.status || "UNKNOWN"}</span></div><small>Profile fingerprint: {compactText(row.profileFingerprint, "UNKNOWN", 20)} · accounts {row.linkage?.accountCount ?? 0}</small></article>)}
            {gpmAccounts.map((row: R) => <article key={`account-${String(row.profileFingerprint)}-${String(row.accountId)}`}><div className="mission-account-title"><strong>{compactText(row.platform, "UNKNOWN", 40)} account</strong><span className="status">{row.catalogLinkage || "UNKNOWN"}</span></div><small>Profile fingerprint: {compactText(row.profileFingerprint, "UNKNOWN", 20)}</small></article>)}
          </div>
        ) : <div className="empty-state">Catalog UNKNOWN hoặc chưa có GPM endpoint.</div>}
      </div>
      <div className="mission-account-runtime">
        <div className="mission-account-head">
          <div><span className="mission-eyebrow">Session readiness</span><small>Read-only exact binding · không tạo lease hoặc authority</small></div>
          <span className="status">{sessionReadiness?.summary?.ready ?? 0}/{sessionReadiness?.summary?.accounts ?? 0} READY</span>
        </div>
        {sessionRows.length ? (
          <div className="mission-account-list">
            {sessionRows.map((row: R) => <article key={`${String(row.platform)}-${String(row.accountId)}-${String(row.profileFingerprint)}`}><div className="mission-account-title"><strong>{compactText(row.platform, "UNKNOWN", 40)} account</strong><span className={row.executionEligible === true ? "status completed" : "status draft"}>{compactText(row.status, "UNKNOWN", 24)}</span></div><small>Profile fingerprint: {compactText(row.profileFingerprint, "UNKNOWN", 20)} · observed: {compactText(row.observedProfileFingerprint, "UNKNOWN", 20)}</small><small>Reason: {Array.isArray(row.reasons) && row.reasons.length ? row.reasons.map((reason: unknown) => compactText(reason, "UNKNOWN", 80)).join(" · ") : "UNKNOWN"}</small></article>)}
          </div>
        ) : <div className="empty-state">Session readiness UNKNOWN hoặc chưa có account.</div>}
      </div>
      <div className="mission-account-runtime">
        <div className="mission-account-head">
          <div><span className="mission-eyebrow">Camoufox authenticated session</span><small>Evidence đọc từ metadata profile đã bảo vệ · không tự cấp quyền publish</small></div>
          <span className={camoufoxSession?.state === "OBSERVED" ? "status completed" : "status draft"}>{compactText(camoufoxSession?.state, "UNKNOWN", 24)}</span>
        </div>
        {camoufoxSessionRows.length ? (
          <div className="mission-account-list">
            {camoufoxSessionRows.map((row: R) => <article key={`${String(row.platform)}-${String(row.accountId)}-${String(row.profileFingerprint)}`}>
              <div className="mission-account-title"><strong>{compactText(row.displayName || `${row.platform} account`, "UNKNOWN", 80)}</strong><span className={row.state === "READY" && row.identityStatus === "VERIFIED" && row.freshness !== "EXPIRED" ? "status completed" : "status draft"}>{compactText(row.state, "UNKNOWN", 24)}</span></div>
              <small>{compactText(row.platform, "UNKNOWN", 40)} · {compactText(row.accountId, "UNKNOWN", 80)} · identity {compactText(row.identityStatus, "UNKNOWN", 24)}</small>
              <small>Auth: {compactText(row.authState, "UNKNOWN", 24)} · Profile fingerprint: {compactText(row.profileFingerprint, "UNKNOWN", 20)}</small>
              <small>Freshness: {compactText(row.freshness, "UNKNOWN", 24)} · observed: {compactText(row.checkedAt, "UNKNOWN", 40)} · expires: {compactText(row.expiresAt, "UNKNOWN", 40)}</small>
              <small>Identity: {compactText(row.identityReference, "UNKNOWN", 120)}</small>
              <small>Canonical execution authority/readiness remains evaluated separately.</small>
            </article>)}
          </div>
        ) : <div className="empty-state">Camoufox session UNKNOWN hoặc chưa có sanitized metadata.</div>}
      </div>
      <div className="mission-advisory-runtime">
        <div className="mission-account-head">
          <div>
            <span className="mission-eyebrow">Distribution intelligence</span>
            <small>Chỉ đọc · cơ hội và blocker không cấp quyền thực thi</small>
          </div>
          <span className="status">Advisory</span>
        </div>
        <div className="mission-advisory-grid">
          <article>
            <span className="mission-eyebrow">Discovery opportunities</span>
            <strong>{discoveryOpportunities.length}</strong>
            <small>{discoveryOpportunities.length ? "Có cơ hội đủ điều kiện để nghiên cứu hoặc cân nhắc engage" : "Chưa có cơ hội đủ điều kiện"}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Engagement candidates</span>
            <strong>{engagementCandidates.length}</strong>
            <small>{engagementCandidates.length ? "Reply có grounding đang chờ policy/runtime" : "Chưa có hội thoại actionable"}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Conversation continuity</span>
            <strong>{conversationContinuity ? Number(conversationContinuity.total || 0) : "UNKNOWN"}</strong>
            <small>{conversationContinuity ? "Luồng hội thoại đã group theo post; UNKNOWN vẫn quarantine" : "Chưa có continuity projection"}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Product intelligence</span>
            <strong>{readyProductIntelligence}/{productIntelligence.length || 0} READY</strong>
            <small>{productIntelligence.length ? "Readiness lấy từ handoff đã lưu" : "Chưa có product intelligence record"}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Current blockers</span>
            <strong>{currentBlockerCount}</strong>
            <small>{currentBlockerCount ? `${executionBlockers.length} execution · ${authorityBlockers.length} authority · ${blockedChannels.length} channel · signal count` : "Chưa có blocker projection"}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Standing authority</span>
            <strong>{authorityRows.filter((item: R) => item?.status === "READY_FOR_BOUNDED_DELEGATION").length}/{authorityRows.length || 0} READY</strong>
            <small>{authorityRows.reduce((total: number, item: R) => total + Number(item?.activeWindowCount || 0), 0)} window · {authorityRows.reduce((total: number, item: R) => total + Number(item?.activeGrantCount || 0), 0)} grant · {authorityRows.reduce((total: number, item: R) => total + Number(item?.activeLeaseCount || 0), 0)} lease</small>
          </article>
          <article>
            <span className="mission-eyebrow">Account pool</span>
            <strong>{accountPoolRows.filter((item: R) => item?.autonomousPath === "AVAILABLE_ADVISORY").length}/{accountPoolRows.length || 0} AVAILABLE</strong>
            <small>{blockedAccountPools.length ? `${blockedAccountPools.length} destination pool bị chặn` : "Projection advisory, không tự chọn account"}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Channel readiness</span>
            <strong>{channelCapabilities.filter((item: R) => item?.status === "READY").length}/{channelCapabilities.length || 0} READY</strong>
            <small>{blockedChannels.length ? `${blockedChannels.length} channel cần target/rules/auth` : "Các channel đã có readiness projection"}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Factory sandbox</span>
            <strong>{factorySandbox?.executionEligible === true ? "ELIGIBLE" : String(factorySandbox?.status || "UNKNOWN")}</strong>
            <small>{factorySandbox?.executionEligible === true ? "Preflight đủ điều kiện" : "Build/render unsafe vẫn fail-closed"}</small>
          </article>
        </div>
        <section className="mission-detail-section mission-intelligence-runtime" aria-label="Product intelligence readiness">
          <div className="mission-account-head">
            <div>
              <span className="mission-eyebrow">Product intelligence readiness</span>
              <small>Read-only projection · status, coverage và lineage metadata; không suy ra publish readiness</small>
            </div>
            <span className="status">{productIntelligenceRuntime.length}/64</span>
          </div>
          {productIntelligenceRuntime.length ? (
            <div className="mission-detail-list">
              {productIntelligenceRuntime.map((item: R) => {
                const fields = item?.requiredFields && typeof item.requiredFields === "object" ? item.requiredFields : {}
                const covered = Object.values(fields).filter(Boolean).length
                const validationErrors = Array.isArray(item?.validationErrors) ? item.validationErrors.slice(0, 3) : []
                return <article key={String(item.campaignId || "UNKNOWN")}>
                  <div className="mission-detail-title">
                    <strong>{compactText(item.campaignId, "UNKNOWN", 90)}</strong>
                    <span className={item.status === "READY" ? "status completed" : item.status === "BLOCKED" ? "status failed" : "status draft"}>{compactText(item.status, "UNKNOWN", 32)}</span>
                  </div>
                  <small>Readiness: {compactText(item.readinessStatus, "UNKNOWN", 32)} · Required fields: {covered}/4</small>
                  <small>Evidence: {Number(item.evidenceCount || 0)} · Claims proved: {Number(item.supportedClaimCount || 0)} · Unsupported: {Number(item.unsupportedClaimCount || 0)}</small>
                  <small>Inspection: {compactText(item.inspection?.status, "UNKNOWN", 24)} · Hash: {item.inspection?.inspectionHash ? "present" : "missing"} · Source fingerprint: {item.inspection?.sourceFingerprint ? "present" : "missing"}</small>
                  {validationErrors.length ? <small>Validation: {validationErrors.map((error: unknown) => compactText(error, "UNKNOWN", 100)).join(" · ")}</small> : null}
                </article>
              })}
            </div>
          ) : <div className="empty-state">Chưa có product intelligence runtime projection.</div>}
        </section>
        <div className="mission-detail-grid">
          <section className="mission-detail-section" aria-label="Discovery opportunity detail">
            <div className="mission-account-head">
              <div>
                <span className="mission-eyebrow">Opportunity detail</span>
                <small>Top 5 advisory rows · score, fit và lý do được đọc từ projection hiện có</small>
              </div>
              <span className="status">{opportunityRows.length}/{discoveryOpportunities.length}</span>
            </div>
            {opportunityRows.length ? (
              <div className="mission-detail-list">
                {opportunityRows.map((item: R) => (
                  <article key={`${String(item.campaignId || "-")}:${String(item.discoveryId)}`}>
                    <div className="mission-detail-title">
                      <strong>{compactText(item.channel, "UNKNOWN", 80)}</strong>
                      <span className="status completed">{Number(item.score || 0)}/100</span>
                    </div>
                    <small>{compactText(item.recommendedAction, "research")} · {compactText(item.discoveryId, "UNKNOWN", 90)}</small>
                    <small>Fit: {fitLabel(item.fit)}</small>
                    <small>Reasons: {Array.isArray(item.reasons) && item.reasons.length ? item.reasons.map((reason: unknown) => compactText(reason, "UNKNOWN", 90)).join(" · ") : "UNKNOWN"}</small>
                    <small>Evidence: {Array.isArray(item.evidence) && item.evidence.length ? item.evidence.join(" · ") : "UNKNOWN"}</small>
                  </article>
                ))}
              </div>
            ) : <div className="empty-state">Chưa có opportunity đủ điều kiện.</div>}
          </section>
          <section className="mission-detail-section" aria-label="Product intelligence lineage">
            <div className="mission-account-head">
              <div>
                <span className="mission-eyebrow">Product intelligence lineage</span>
                <small>Top 4 handoff · claim → evidence hash/locator, chỉ đọc</small>
              </div>
              <span className="status">{intelligenceRows.length}/{productIntelligence.length}</span>
            </div>
            {intelligenceRows.length ? (
              <div className="mission-detail-list">
                {intelligenceRows.map((item: R, index: number) => {
                  const document = item?.document && typeof item.document === "object" ? item.document : {}
                  const evidenceByHash = new Map((Array.isArray(document.evidence) ? document.evidence : []).map((evidence: R) => [String(evidence?.hash || ""), evidence]))
                  const claims = Array.isArray(document.CLAIMS_WE_CAN_PROVE) ? document.CLAIMS_WE_CAN_PROVE.slice(0, 4) : []
                  const unsupportedClaims = Array.isArray(document.CLAIMS_WE_CANNOT_MAKE) ? document.CLAIMS_WE_CANNOT_MAKE.slice(0, 4) : []
                  const inspection = item?.repositoryInspection && typeof item.repositoryInspection === "object" ? item.repositoryInspection : null
                  return (
                    <article key={String(item.campaignId || item.attachedAt || `intelligence-${index}`)}>
                      <div className="mission-detail-title">
                        <strong>{compactText(item.campaignId, "UNKNOWN", 90)}</strong>
                        <span className={item?.handoff?.readinessStatus === "READY" ? "status completed" : "status draft"}>{compactText(item?.handoff?.readinessStatus, "UNKNOWN", 40)}</span>
                      </div>
                      {claims.length ? claims.map((claim: R) => {
                        const refs = Array.isArray(claim?.evidenceRefs) ? claim.evidenceRefs : []
                        const linked = refs.slice(0, 3).map((ref: unknown) => evidenceByHash.get(String(ref)) || { hash: ref })
                        return <div className="mission-lineage-row" key={String(claim.id || claim.field || claim.text)}>
                          <strong>{compactText(claim.field || claim.id, "CLAIM", 70)}</strong>
                          <small>{compactText(claim.text, "UNKNOWN", 170)}</small>
                          <small>Evidence: {linked.length ? linked.map((evidence: R) => `${compactText(evidence.hash, "UNKNOWN", 14)} · ${compactText(evidence.locator, "locator unknown", 90)}`).join(" | ") : "UNKNOWN"}</small>
                        </div>
                      }) : <small>Chưa có CLAIMS_WE_CAN_PROVE lineage.</small>}
                      <div className="mission-lineage-row unsupported-claim-row">
                        <strong>CLAIMS_WE_CANNOT_MAKE ({unsupportedClaims.length})</strong>
                        <small>{unsupportedClaims.length ? unsupportedClaims.map((claim: R) => compactText(typeof claim === "string" ? claim : claim?.text || claim?.field, "UNKNOWN", 150)).join(" · ") : "Không có unsupported claim được ghi nhận"}</small>
                      </div>
                      <small>Repository inspection: {inspection ? compactText(inspection.status || inspection.result || "RECORDED", "RECORDED", 70) : "UNKNOWN"}</small>
                    </article>
                  )
                })}
              </div>
            ) : <div className="empty-state">Chưa có product intelligence handoff.</div>}
          </section>
          <section className="mission-detail-section" aria-label="Conversation detail">
            <div className="mission-account-head">
              <div>
                <span className="mission-eyebrow">Conversation detail</span>
                <small>Top 5 read-only rows · nội dung và trạng thái lấy từ engagement projection</small>
              </div>
              <span className="status">{conversationRows.length}/{Number(data?.engagementContext?.total || 0)}</span>
            </div>
            {conversationRows.length ? (
              <div className="mission-detail-list">
                {conversationRows.map((row: R, index: number) => {
                  const continuity = continuityFor(row)
                  const status = String(row?.status || "UNKNOWN").toUpperCase()
                  const statusClass = status === "QUARANTINED" ? "status failed" : status === "ACTIONABLE" ? "status completed" : "status draft"
                  const reasons = Array.isArray(row?.reasonCodes) ? row.reasonCodes : []
                  return (
                    <article key={String(row?.conversationRef || row?.interactionRef || `conversation-${index}`)}>
                      <div className="mission-detail-title">
                        <strong>{compactText(row?.channel, "UNKNOWN", 70)} · {compactText(row?.authorLabel, "unknown", 80)}</strong>
                        <span className={statusClass}>{status}</span>
                      </div>
                      <small>{compactText(row?.text, "No conversation text", 180)}</small>
                      <small>{Number(row?.replyCount || 0)} replies · latest {formatDate(row?.latestReplyAt || row?.capturedAt)}</small>
                      <small>Reasons: {reasons.length ? reasons.map((reason: unknown) => compactText(reason, "UNKNOWN", 80)).join(" · ") : "UNKNOWN"}</small>
                      <small>Continuity: {continuity ? `${Number(continuity.turnCount || 0)} turns · ${compactText(continuity.status, "UNKNOWN", 40)}` : "UNKNOWN"}</small>
                    </article>
                  )
                })}
              </div>
            ) : <div className="empty-state">Chưa có conversation detail.</div>}
          </section>
          <section className="mission-detail-section" aria-label="Engagement candidate detail">
            <div className="mission-account-head">
              <div>
                <span className="mission-eyebrow">Engagement candidate detail</span>
                <small>Top 5 advisory rows · không có nút approve, reply hoặc send</small>
              </div>
              <span className="status">{Math.min(5, engagementCandidates.length)}/{engagementCandidates.length}</span>
            </div>
            {engagementCandidates.length ? (
              <div className="mission-detail-list">
                {engagementCandidates.slice(0, 5).map((candidate: R, index: number) => {
                  const status = String(candidate?.status || "UNKNOWN").toUpperCase()
                  const statusClass = status === "QUARANTINED" ? "status failed" : status === "ACTIONABLE" ? "status completed" : "status draft"
                  const reasons = Array.isArray(candidate?.reasonCodes) ? candidate.reasonCodes : []
                  return (
                    <article key={String(candidate?.candidateRef || `candidate-${index}`)}>
                      <div className="mission-detail-title">
                        <strong>{compactText(candidate?.channel, "UNKNOWN", 70)} · ref {compactText(candidate?.candidateRef, "UNKNOWN", 24)}</strong>
                        <span className={statusClass}>{status}</span>
                      </div>
                      <small>Conversation {compactText(candidate?.conversationRef, "UNKNOWN", 24)} · target {compactText(candidate?.targetRef, "UNKNOWN", 24)}</small>
                      <small>Reasons: {reasons.length ? reasons.map((reason: unknown) => compactText(reason, "UNKNOWN", 90)).join(" · ") : "UNKNOWN"}</small>
                    </article>
                  )
                })}
              </div>
            ) : <div className="empty-state">Chưa có engagement candidate.</div>}
          </section>
        </div>
      </div>
    </section>
  )
}

function executionRuntimeLabel(value: unknown) {
  const labels: Record<string, string> = {
    DRY_RUN: "DRY_RUN",
    LIVE: "LIVE",
    UNKNOWN: "UNKNOWN",
    DRY_RUN_COMPLETE: "DRY_RUN_COMPLETE",
    SUBMIT_RESULT_UNKNOWN: "SUBMIT_RESULT_UNKNOWN",
    publication_verified: "PUBLICATION_VERIFIED",
    execution_state: "EXECUTION_STATE",
    dry_run_completed: "DRY_RUN_COMPLETED",
    execution_request_created: "REQUEST_CREATED",
    execution_started: "EXECUTION_STARTED",
    durable_submit_intent: "DURABLE_SUBMIT_INTENT",
    submit_sent: "SUBMIT_SENT",
    transport_receipt_recorded: "TRANSPORT_RECEIPT",
    submission_receipt_recorded: "SUBMISSION_RECEIPT",
    submit_result_unknown: "SUBMIT_RESULT_UNKNOWN",
    pre_submit_failure_recorded: "PRE_SUBMIT_FAILURE",
    execution_receipt_recorded: "EXECUTION_RECEIPT",
    execution_state_observed: "EXECUTION_STATE",
  }
  const normalized = String(value || "UNKNOWN").trim()
  return labels[normalized] || normalized || "UNKNOWN"
}

function safeExecutionPermalink(value: unknown) {
  try {
    const url = new URL(String(value || "").trim())
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function ExecutionEvidencePanel({ data }: { data: R }) {
  const runtime = data?.executionRuntime && typeof data.executionRuntime === "object"
    ? data.executionRuntime
    : null
  const counts = runtime?.counts && typeof runtime.counts === "object" ? runtime.counts : {}
  const byMode = counts?.byMode && typeof counts.byMode === "object" ? counts.byMode : {}
  const latest = runtime?.latestAction && typeof runtime.latestAction === "object"
    ? runtime.latestAction
    : null
  const blockers = Array.isArray(runtime?.blockers) ? runtime.blockers : []
  const permalink = safeExecutionPermalink(
    Array.isArray(runtime?.recent)
      ? runtime.recent.find((row: R) => safeExecutionPermalink(row?.permalink))?.permalink
      : null,
  )
  const quarantineCount = Number.isFinite(Number(runtime?.quarantine?.count))
    ? Number(runtime.quarantine.count)
    : 0
  const timeline = Array.isArray(runtime?.timeline) ? runtime.timeline.slice(0, 12) : []

  return (
    <section className="panel mission-execution-panel full-span" aria-label="Bằng chứng thực thi">
      <div className="panel-head">
        <div>
          <h2>Execution evidence</h2>
          <p>Projection chỉ đọc của transport, trạng thái và bằng chứng publication.</p>
        </div>
        <span className="status">Chỉ đọc · fail-closed</span>
      </div>
      {!runtime ? (
        <div className="empty-state">Chưa có execution runtime projection.</div>
      ) : (
        <>
          <div className="mission-execution-grid">
            <article>
              <span className="mission-eyebrow">Latest phase / action</span>
              <strong>{latest ? executionRuntimeLabel(latest.phase) : "UNKNOWN"}</strong>
              <small>
                {latest
                  ? `${executionRuntimeLabel(latest.event)} · ${executionRuntimeLabel(latest.mode)} · ${formatDate(latest.at)}`
                  : "Chưa có action được ghi nhận"}
              </small>
            </article>
            <article>
              <span className="mission-eyebrow">Execution modes</span>
              <strong>{Number(byMode.DRY_RUN || 0)} DRY_RUN</strong>
              <small>{Number(byMode.LIVE || 0)} LIVE · {Number(byMode.UNKNOWN || 0)} UNKNOWN</small>
            </article>
            <article>
              <span className="mission-eyebrow">Publication verification</span>
              <strong>{Number(counts.verified || 0)} VERIFIED</strong>
              <small>{Number(counts.publicationUnverified || 0)} LIVE chưa verify · không suy luận từ command</small>
            </article>
            <article>
              <span className="mission-eyebrow">UNKNOWN quarantine</span>
              <strong>{quarantineCount}</strong>
              <small>Record immutable · không retry tự động</small>
            </article>
          </div>
          <div className="mission-execution-footer">
            <div>
              <span className="mission-eyebrow">Verified permalink</span>
              {permalink ? (
                <a href={permalink} target="_blank" rel="noreferrer">Mở publication ↗</a>
              ) : (
                <small>Chưa có independent VERIFIED permalink.</small>
              )}
            </div>
            <div>
              <span className="mission-eyebrow">Bounded blockers</span>
              {blockers.length ? (
                <div className="mission-blocker-list">
                  {blockers.slice(0, 8).map((blocker: R) => (
                    <span className="status draft" key={`${blocker.code}-${blocker.count}`}>
                      {executionRuntimeLabel(blocker.code)} · {Number(blocker.count || 0)}
                    </span>
                  ))}
                </div>
              ) : (
                <small>Không có blocker code được ghi nhận.</small>
              )}
            </div>
          </div>
          <div className="mission-execution-timeline" aria-label="Execution timeline">
            <div className="mission-timeline-head">
              <div>
                <span className="mission-eyebrow">Execution timeline</span>
                <small>Chuỗi evidence được dựng từ request/receipt hiện có; mã thực thi đã fingerprint.</small>
              </div>
              <span className="status">{Number(runtime?.timelineCount || timeline.length)} events{runtime?.timelineTruncated ? " · bounded" : ""}</span>
            </div>
            {timeline.length ? (
              <div className="mission-timeline-list">
                {timeline.map((event: R, index: number) => {
                  const eventPermalink = event?.publicationStatus === "VERIFIED"
                    ? safeExecutionPermalink(event?.permalink)
                    : null
                  return (
                    <article key={`${String(event?.executionRef || "unknown")}-${String(event?.at || "")}-${String(event?.event || index)}`}>
                      <time>{formatDate(event?.at)}</time>
                      <div>
                        <strong>{executionRuntimeLabel(event?.event)}</strong>
                        <small>{executionRuntimeLabel(event?.phase)} · {executionRuntimeLabel(event?.submitState)} · {executionRuntimeLabel(event?.mode)} · ref {String(event?.executionRef || "UNKNOWN")}</small>
                      </div>
                      <span className={`status ${event?.publicationStatus === "VERIFIED" ? "completed" : event?.publicationStatus === "UNKNOWN" ? "failed" : "draft"}`}>
                        {executionRuntimeLabel(event?.publicationStatus)}
                      </span>
                      {eventPermalink ? <a href={eventPermalink} target="_blank" rel="noreferrer">permalink ↗</a> : null}
                    </article>
                  )
                })}
              </div>
            ) : (
              <small>Chưa có timeline event được ghi nhận.</small>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function ProductFactorySafetyPanel({ data }: { data: R }) {
  const capability = data?.productFactorySandbox && typeof data.productFactorySandbox === "object"
    ? data.productFactorySandbox
    : null
  const checks = capability?.checks && typeof capability.checks === "object" ? capability.checks : {}
  const limits = capability?.limits && typeof capability.limits === "object" ? capability.limits : {}
  const eligible = capability?.executionEligible === true
  const status = String(capability?.status || "UNKNOWN")
  const statusClass = eligible ? "status completed" : status === "UNAVAILABLE" ? "status failed" : "status draft"
  const reason = eligible
    ? "Đã có capability đủ điều kiện theo preflight"
    : "Chưa chứng minh được sandbox đầy đủ; lệnh build/render vẫn bị chặn"
  return (
    <section className="panel mission-execution-panel full-span" aria-label="Product Factory safety">
      <div className="panel-head">
        <div>
          <h2>Product Factory safety</h2>
          <p>Capability preflight chỉ đọc; không tự chạy build, render hoặc cấp quyền xuất bản.</p>
        </div>
        <span className={statusClass}>{eligible ? "Eligible" : status}</span>
      </div>
      {!capability ? (
        <div className="empty-state">Chưa có sandbox capability projection.</div>
      ) : (
        <div className="mission-execution-grid">
          <article>
            <span className="mission-eyebrow">Sandbox profile</span>
            <strong>{String(capability.profile?.id || "UNKNOWN")}</strong>
            <small>{String(capability.backend || "UNKNOWN")} · v{String(capability.profile?.version || capability.version || "UNKNOWN")}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Execution eligibility</span>
            <strong>{eligible ? "ALLOWED BY PREFLIGHT" : "NOT EXECUTED"}</strong>
            <small>{reason}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Checks</span>
            <strong>{Object.values(checks).filter((value) => String(value) === "PASS").length} PASS</strong>
            <small>{Object.entries(checks).filter(([, value]) => String(value) !== "PASS").map(([key, value]) => `${key}:${value}`).join(" · ") || "All checks passed"}</small>
          </article>
          <article>
            <span className="mission-eyebrow">Unsafe command policy</span>
            <strong>{String(capability.unsafeCommandDisposition || "NOT_EXECUTED_UNSAFE")}</strong>
            <small>{Object.entries(limits).map(([key, value]) => `${key}:${value}`).join(" · ") || "No verified limits"}</small>
          </article>
        </div>
      )}
    </section>
  )
}

function ProductEvidencePanel({ data }: { data: R }) {
  const runs = Array.isArray(data?.productFactoryEvidence)
    ? data.productFactoryEvidence.slice(0, 6)
    : []
  const intelligence = Array.isArray(data?.productIntelligence)
    ? data.productIntelligence.slice(0, 6)
    : []
  const unsupportedClaimCount = intelligence.reduce((total: number, item: R) => {
    const document = item?.document && typeof item.document === "object" ? item.document : {}
    return total + (Array.isArray(document.CLAIMS_WE_CANNOT_MAKE) ? document.CLAIMS_WE_CANNOT_MAKE.length : 0)
  }, 0)
  return (
    <section className="panel mission-execution-panel full-span" aria-label="Product evidence">
      <div className="panel-head">
        <div>
          <h2>Product evidence</h2>
          <p>Read-only lineage của Product Factory và product intelligence; không chạy lệnh hoặc cấp quyền.</p>
        </div>
        <span className="status">Chỉ đọc</span>
      </div>
      {!runs.length && !intelligence.length ? (
        <div className="empty-state">Chưa có Product Factory hoặc product intelligence evidence.</div>
      ) : (
        <div className="mission-execution-grid">
          <article>
            <span className="mission-eyebrow">Factory runs</span>
            <strong>{runs.length}</strong>
            <small>{runs.filter((run: R) => run?.status === "SUCCEEDED").length} SUCCEEDED · {runs.filter((run: R) => run?.planStatus === "NOT_EXECUTED_UNSAFE").length} fail-closed</small>
          </article>
          <article>
            <span className="mission-eyebrow">Artifacts evidenced</span>
            <strong>{runs.reduce((total: number, run: R) => total + Number(run?.artifactCount || 0), 0)}</strong>
            <small>Hash/path metadata only; promotion remains a separate guarded action.</small>
          </article>
          <article>
            <span className="mission-eyebrow">Product intelligence</span>
            <strong>{intelligence.filter((item: R) => item?.handoff?.readinessStatus === "READY").length}/{intelligence.length} READY</strong>
            <small>Handoff và evidence claim hash đã lưu trong campaign state.</small>
          </article>
          <article>
            <span className="mission-eyebrow">Unsupported claims</span>
            <strong>{unsupportedClaimCount}</strong>
            <small>Claims không đủ bằng chứng vẫn bị giữ ngoài publish scope.</small>
          </article>
          <article>
            <span className="mission-eyebrow">Latest evidence</span>
            <strong>{runs[0]?.classification?.kind || "UNKNOWN"}</strong>
            <small>{runs[0]?.execution?.status || runs[0]?.status || "UNKNOWN"} · không suy luận build/render thành công từ projection.</small>
          </article>
        </div>
      )}
    </section>
  )
}

function ContentPipelinePanel({ data }: { data: R }) {
  const runs = Array.isArray(data?.recentContentPipelineRuns)
    ? data.recentContentPipelineRuns.slice(0, 6)
    : []
  const runtime = data?.contentRuntime && typeof data.contentRuntime === "object" ? data.contentRuntime : null
  const succeeded = runs.filter((run: R) => run?.status === "SUCCEEDED")
  const failed = runs.filter((run: R) => run?.status === "FAILED")
  return (
    <section className="panel mission-execution-panel full-span" aria-label="Content media pipeline">
      <div className="panel-head">
        <div>
          <h2>Content, report and media</h2>
          <p>Live pipeline lineage from canonical campaign state. Evidence, copy, MP4 and typed failures stay visible.</p>
        </div>
        <span className={`status ${runtime?.ready === true ? "completed" : runtime?.status === "UNAVAILABLE" ? "failed" : "draft"}`}>
          {runtime ? `${String(runtime.status || "UNKNOWN")} · ${runs.length ? `${succeeded.length} succeeded · ${failed.length} failed` : "No runs"}` : "Runtime unknown"}
        </span>
      </div>
      {!runs.length ? (
        <div className="empty-state">No content pipeline run has been recorded.</div>
      ) : (
        <div className="mission-execution-grid">
          {runtime ? (
            <article>
              <span className="mission-eyebrow">Research/media runtime</span>
              <strong>{String(runtime.status || "UNKNOWN")}</strong>
              <small>{String(runtime.mode || "LOCAL")} · Python {String(runtime.python?.status || "UNKNOWN")} · ffmpeg {String(runtime.ffmpeg?.status || "UNKNOWN")}</small>
              <small>{runtime.failure ? String(runtime.failure.code || "RUNTIME_UNAVAILABLE") : "Preflight verified"}</small>
              <small>Provisioning: {runtime.provisioning?.running ? "RUNNING" : runtime.provisioning?.attempted ? (runtime.provisioning?.error || "completed") : "not attempted"}</small>
            </article>
          ) : null}
          {runs.map((run: R) => (
            <article key={`${String(run?.campaignId)}-${String(run?.runId)}`}>
              <span className="mission-eyebrow">{String(run?.campaignId || "UNKNOWN")}</span>
              <strong>{String(run?.status || "UNKNOWN")}</strong>
              <small>{String(run?.mode || "UNKNOWN")} · {Number(run?.evidence?.length || 0)} evidence · {run?.media?.sha256 ? "MP4 verified" : "No MP4"}</small>
              {run?.failure ? <small>{String(run.failure.code || "FAILED")} · {String(run.failure.message || "")}</small> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function Overview({
  data,
  select,
  periodLabel,
}: {
  data: R
  select: (post: R) => void
  periodLabel: string
}) {
  return (
    <>
      <KpiRow data={data} />
      <div className="filterbar">
        <span className="sync-text">
          Phạm vi chung: {periodLabel} · {data.postCount} bài ·{" "}
          {data.latestMetricSnapshots?.length || 0} snapshot mới nhất theo bài ·
          số liệu thiếu hiển thị “—”
        </span>
      </div>
      <div className="dashboard-grid">
        <MissionControlPanel data={data} />
        <ExecutionEvidencePanel data={data} />
        <ProductFactorySafetyPanel data={data} />
        <ProductEvidencePanel data={data} />
        <ContentPipelinePanel data={data} />
        <TrafficChart data={data} />
        <TrafficSourcesPanel data={data} />
        <ReadinessPanel data={data} />
        <SourcesPanel data={data} />
        <LifecycleFunnel data={data} />
        <UserActions data={data} />
        <ChannelTable data={data} />
        <CommunityOverview data={data} />
        <LeadSummary integration={data.autoGtm} />
        <TopContent data={data} select={select} />
        <Intelligence data={data} />
        <SignalsAndLive data={data} />
      </div>
    </>
  )
}

const titles: Record<string, string> = {
  "/": "Growth intelligence",
  "/traffic": "Phân tích traffic",
  "/engagement": "Phân tích tương tác",
  "/actions": "Phân tích hành động",
  "/conversions": "Phân tích chuyển đổi",
  "/content-performance": "Hiệu quả nội dung",
  "/platforms": "Nền tảng",
  "/campaigns": "Chiến dịch",
  "/posts": "Bài đăng & Seeds",
  "/markets": "Thị trường",
  "/audience": "Đối tượng",
  "/signals": "Trung tâm intelligence",
  "/leads": "Khách hàng tiềm năng",
  "/reports": "Báo cáo",
  "/integrations": "Tích hợp",
  "/settings": "Cài đặt",
}
const periodLabels: Record<string, string> = {
  today: "Hôm nay",
  "7d": "7 ngày",
  "30d": "30 ngày",
  all: "Toàn bộ",
}
const productOptions = [
  ["design-os-3d-blender", "3D Blender"],
  ["design-os-code2flow", "Vibe Code"],
  ["design-os-svg-animation", "SVG Animation"],
]
function productRepoFor(data: R, post: R) {
  const campaign = (data.campaigns || []).find(
    (item: R) => item.id === post.campaignId,
  )
  const explicit = post.productRepo || campaign?.productRepo || campaign?.repo
  if (explicit) return String(explicit)
  const text = `${campaign?.name || ""} ${post.content || ""}`.toLowerCase()
  if (
    text.includes("code2flow") ||
    text.includes("vibe-code") ||
    text.includes("signal relay flow")
  )
    return "design-os-code2flow"
  if (
    text.includes("svg-animation") ||
    text.includes("svg animation") ||
    text.includes("sentinel camera in svg")
  )
    return "design-os-svg-animation"
  if (
    text.includes("blender") ||
    text.includes("rover") ||
    text.includes("3d product") ||
    text.includes("3d")
  )
    return "design-os-3d-blender"
  return "unknown"
}
function channelMatches(value: unknown, channelId: string) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
  const wanted = String(channelId || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
  if (!wanted) return true
  if (normalized === wanted) return true
  return (
    (wanted === "facebookgroup" && normalized === "facebook") ||
    (wanted === "facebook" && normalized === "facebookgroup")
  )
}
function periodStart(period: string) {
  if (period === "all") return 0
  const now = new Date()
  if (period === "today") {
    now.setHours(0, 0, 0, 0)
    return now.getTime()
  }
  return now.getTime() - (period === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000
}
function validMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function scopeDashboardData(
  data: R,
  period: string,
  channel: string,
  repo: string,
) {
  if (!data || !Array.isArray(data.posts)) return data
  const start = periodStart(period)
  const channels = (data.channels || []).filter(
    (item: R) => !channel || channelMatches(item.id, channel),
  )
  const targets = (data.targets || []).filter(
    (item: R) => !channel || channelMatches(item.channel, channel),
  )
  const targetIds = new Set(targets.map((item: R) => item.id))
  const targetScopedPosts = data.posts.filter(
    (post: R) =>
      (!channel || targetIds.has(post.targetId)) &&
      (!repo || productRepoFor(data, post) === repo),
  )
  const rawSnapshots: R[] = data.latestMetricSnapshots || []
  const snapshotsByPost = new Map<string, R[]>()
  rawSnapshots.forEach((snapshot: R) =>
    snapshotsByPost.set(snapshot.postId, [
      ...(snapshotsByPost.get(snapshot.postId) || []),
      snapshot,
    ]),
  )
  const inWindow = (value: unknown) =>
    period === "all" || (Date.parse(String(value || "")) || 0) >= start
  const baselinePosts = data.posts.filter(
    (post: R) =>
      period === "all" ||
      inWindow(post.publishedAt || post.createdAt || post.updatedAt) ||
      (snapshotsByPost.get(post.id) || []).some((snapshot: R) =>
        inWindow(snapshot.capturedAt),
      ),
  )
  const trafficSourceFallback = {
    ...data,
    posts: baselinePosts,
    targets: data.targets || [],
    channels: data.channels || [],
    latestMetricSnapshots: rawSnapshots.filter((snapshot: R) =>
      inWindow(snapshot.capturedAt),
    ),
  }
  const posts = targetScopedPosts.filter(
    (post: R) =>
      period === "all" ||
      inWindow(post.publishedAt || post.createdAt || post.updatedAt) ||
      (snapshotsByPost.get(post.id) || []).some((snapshot: R) =>
        inWindow(snapshot.capturedAt),
      ),
  )
  const postIds = new Set(posts.map((post: R) => post.id))
  const latestMetricSnapshots = rawSnapshots.filter(
    (snapshot: R) =>
      postIds.has(snapshot.postId) && inWindow(snapshot.capturedAt),
  )
  const totals: R = {}
  const metricCoverage: R = {}
  for (const key of [
    "impressions",
    "reactions",
    "comments",
    "shares",
    "clicks",
    "leads",
  ]) {
    const values = latestMetricSnapshots
      .map((snapshot: R) => validMetric(snapshot[key]))
      .filter((value: number | null): value is number => value !== null)
    totals[key] = values.length
      ? values.reduce((sum: number, value: number) => sum + value, 0)
      : null
    metricCoverage[key] = {
      measured: values.length,
      unsupported: latestMetricSnapshots.filter(
        (snapshot: R) => snapshot.coverage?.[key] === "unsupported",
      ).length,
      unknown: latestMetricSnapshots.filter(
        (snapshot: R) =>
          !snapshot.coverage?.[key] || snapshot.coverage?.[key] === "unknown",
      ).length,
    }
  }
  const engagements = [totals.reactions, totals.comments, totals.shares].filter(
    (value: number | null) => value !== null,
  )
  totals.engagements = engagements.length
    ? engagements.reduce((sum: number, value: number) => sum + value, 0)
    : null
  const statuses: R = {}
  for (const post of posts)
    statuses[post.status] = (statuses[post.status] || 0) + 1
  const campaignIds = new Set(
    posts.map((post: R) => post.campaignId).filter(Boolean),
  )
  const campaigns = (data.campaigns || []).filter((item: R) =>
    campaignIds.has(item.id),
  )
  const communityMemberships = (data.communityMemberships || []).filter(
    (item: R) =>
      (!repo || item.productRepo === repo) &&
      (!channel || channelMatches(item.platform, channel)),
  )
  const recentInteractions = (data.recentInteractions || []).filter(
    (item: R) => postIds.has(item.postId) && inWindow(item.capturedAt),
  )
  const signals = (data.trafficPulse || data.signals || []).filter(
    (item: R) => !item.postId || postIds.has(item.postId),
  )
  return {
    ...data,
    channels,
    targets,
    posts,
    campaigns,
    communityMemberships,
    latestMetricSnapshots,
    recentInteractions,
    trafficPulse: signals,
    signals,
    totals,
    metricCoverage,
    statuses,
    postCount: posts.length,
    targetCount: targets.length,
    campaignCount: campaigns.length,
    trafficSourceFallback,
    scope: { period, channel, repo },
  }
}
function DashboardScopeBar({
  data,
  sourceData,
  period,
  setPeriod,
  channel,
  setChannel,
  repo,
  setRepo,
}: {
  data: R
  sourceData: R
  period: string
  setPeriod: (value: string) => void
  channel: string
  setChannel: (value: string) => void
  repo: string
  setRepo: (value: string) => void
}) {
  const measured = (data.latestMetricSnapshots || []).filter((snapshot: R) =>
    ["impressions", "reactions", "comments", "shares", "clicks", "leads"].some(
      (key) => validMetric(snapshot[key]) !== null,
    ),
  ).length
  return (
    <section className="dashboard-scope" aria-label="Bộ lọc chung dashboard">
      <div className="scope-selects">
        <label>
          Thời gian
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="today">Hôm nay</option>
            <option value="7d">7 ngày</option>
            <option value="30d">30 ngày</option>
            <option value="all">Toàn bộ</option>
          </select>
        </label>
        <label>
          Nền tảng
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option value="">Tất cả nền tảng</option>
            {(sourceData.channels || []).map((item: R) => (
              <option value={item.id} key={item.id}>
                {labelChannel(item.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Repo sản phẩm
          <select
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
          >
            <option value="">Tất cả repo</option>
            {productOptions.map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="scope-summary">
        <strong>{data.postCount || 0} bài</strong>
        <span>{measured} bài có ít nhất một counter đo được</span>
        <span>API cập nhật {formatDate(data.updatedAt)}</span>
      </div>
    </section>
  )
}

function OperatorSessionPanel({ refresh }: { refresh: () => void }) {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem("seedingOperatorToken") || "" } catch { return "" } })
  const [status, setStatus] = useState("")
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setStatus("Đang kiểm tra token…")
    try {
      const response = await fetch("/api/operator/session", { headers: { authorization: `Bearer ${token.trim()}` } })
      if (!response.ok) throw new Error("Token không hợp lệ")
      sessionStorage.setItem("seedingOperatorToken", token.trim()); setToken(""); setStatus("Đã kết nối phiên vận hành cục bộ"); refresh()
    } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể kết nối token") }
  }
  return <section className="panel full-span"><div className="panel-head"><div><h2>Phiên vận hành cục bộ</h2><p>Token chỉ nằm trong sessionStorage của cửa sổ này; không lưu vào state hoặc repo.</p></div></div><form onSubmit={connect} className="scope-selects"><input required type="password" value={token} onChange={event => setToken(event.target.value)} placeholder="operator token" autoComplete="off" /><button className="primary-button" type="submit">Kết nối</button><button type="button" className="secondary-button" onClick={() => { sessionStorage.removeItem("seedingOperatorToken"); setStatus("Đã ngắt phiên"); refresh() }}>Ngắt</button></form>{status ? <small>{status}</small> : null}</section>
}

function UpdatePanel({ data, refresh }: { data: R, refresh: () => void }) {
  const update = data?.update && typeof data.update === "object" ? data.update : {}
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const token = () => {
    try { return sessionStorage.getItem("seedingOperatorToken") || "" } catch { return "" }
  }
  const check = async () => {
    setBusy(true)
    try {
      const response = await fetch("/api/update/status", { cache: "no-store" })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      setStatus(`${body.status || "UNKNOWN"}: ${body.reason || "đã kiểm tra"}`)
      refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể kiểm tra cập nhật")
    } finally { setBusy(false) }
  }
  const install = async () => {
    const operatorToken = token()
    if (!operatorToken) { setStatus("Kết nối token vận hành trước"); return }
    setBusy(true)
    setStatus("Đang xác minh manifest, checksum và chữ ký…")
    try {
      const response = await fetch("/api/update/install", {
        method: "POST",
        headers: { authorization: `Bearer ${operatorToken}` },
      })
      const body = await response.json()
      if (!response.ok && response.status !== 202) throw new Error(body?.error || body?.installation?.reason || `HTTP ${response.status}`)
      setStatus(body?.installation?.reason || "Cập nhật đã được cài; ứng dụng cần khởi động lại")
      refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể cài cập nhật")
    } finally { setBusy(false) }
  }
  const eligible = update.installEligible === true && update.automaticUpdates === true && update.signatureVerified === true
  const installStatus = update.installation?.status
  return <section className="panel full-span" aria-label="Cập nhật ứng dụng">
    <div className="panel-head"><div><h2>Cập nhật ứng dụng</h2><p>Manifest HTTPS, SHA-256, chữ ký Ed25519 và updater macOS phải được xác minh trước khi cài. Tài khoản, campaign, lịch và lịch sử vẫn nằm ngoài app bundle.</p></div><span className={`status ${eligible ? "ready" : "pending"}`}>{String(update.status || "NOT_CONFIGURED")}</span></div>
    <div className="scope-summary"><span>Phiên bản hiện tại: {String(update.currentVersion || "UNKNOWN")}</span><span>{update.updateAvailable ? `Bản mới: ${String(update.manifest?.version || "UNKNOWN")}` : "Không có bản mới đã xác minh"}</span><span>Chữ ký: {update.signatureVerified ? "VERIFIED" : "UNVERIFIED"}</span><span>Installer: {update.installEligible ? "ELIGIBLE" : "BLOCKED"}</span></div>
    <div className="scope-selects"><button type="button" className="secondary-button" onClick={check} disabled={busy}>{busy ? "Đang kiểm tra…" : "Kiểm tra cập nhật"}</button><button type="button" className="primary-button" onClick={install} disabled={busy || !eligible}>Cài bản cập nhật đã xác minh</button>{installStatus ? <span>{String(installStatus)}</span> : null}</div>
    <small>{String(update.reason || "Release manifest chưa cấu hình")} {status ? `· ${status}` : ""}</small>
  </section>
}

function NineRouterPanel({ data, refresh }: { data: R, refresh: () => void }) {
  const router = data?.nineRouter && typeof data.nineRouter === "object" ? data.nineRouter : {}
  const [task, setTask] = useState("research")
  const [preferredModel, setPreferredModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [status, setStatus] = useState("")
  const choose = async (event: React.FormEvent) => {
    event.preventDefault(); const token = sessionStorage.getItem("seedingOperatorToken") || ""; if (!token) { setStatus("Kết nối token vận hành trước"); return }
    try { const response = await fetch("/api/9router/select-model", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ task, preferredModel: preferredModel || null }) }); const body = await response.json(); if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`); setStatus(`${body.model || "UNKNOWN"}: ${body.reason || "UNKNOWN"}`); refresh() } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể chọn model") }
  }
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); const token = sessionStorage.getItem("seedingOperatorToken") || ""; if (!token) { setStatus("Kết nối token vận hành trước"); return }
    if (!apiKey.trim()) { setStatus("Nhập app-scoped API key từ 9Router dashboard"); return }
    try { const response = await fetch("/api/9router/connect", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ apiKey: apiKey.trim() }) }); const body = await response.json(); if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`); setApiKey(""); setStatus(`${body.catalogStatus || "CONNECTED"}: ${body.models?.length || 0} model live`); refresh() } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể kết nối 9Router") }
  }
  const models = Array.isArray(router.models) ? router.models : []
  return <section className="panel full-span"><div className="panel-head"><div><h2>9Router model gateway</h2><p>Catalog authenticated từ 9Router /v1/models; quota chỉ được đánh dấu sau request thực tế. Provider login vẫn do user thực hiện trong 9Router.</p></div><span className="status">{String(router.catalogStatus || "CONNECT_REQUIRED")}</span></div>{router.connectRequired ? <form onSubmit={connect} className="scope-selects"><input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="9Router app-scoped API key" autoComplete="off" /><button className="secondary-button" type="submit">Kết nối 9Router</button></form> : null}<form onSubmit={choose} className="scope-selects"><select value={task} onChange={event => setTask(event.target.value)}><option value="research">Research</option><option value="content">Content</option><option value="media">Media / vision</option><option value="code">Code</option></select><select value={preferredModel} onChange={event => setPreferredModel(event.target.value)}><option value="">Auto compatible fallback</option>{models.map((model: R) => <option key={String(model.id)} value={String(model.id)}>{String(model.id)}</option>)}</select><button className="primary-button" type="submit">Chọn model</button></form><small>Selected: {String(router.selection?.model || "UNKNOWN")} · {String(router.selection?.reason || "chưa chọn")} · {models.length} model · quota {String(router.quotaStatus || "UNVERIFIED")}</small>{status ? <small>{status}</small> : null}</section>
}

function FanoutPlannerPanel({ data, refresh }: { data: R, refresh: () => void }) {
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : []
  const accounts = Array.isArray(data?.executionAccounts) ? data.executionAccounts.filter((item: R) => item?.provider === "camoufox") : []
  const channels = Array.isArray(data?.channels) ? data.channels.filter((item: R) => item?.id !== "email") : []
  const [campaignId, setCampaignId] = useState("")
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [allSocial, setAllSocial] = useState(false)
  const [status, setStatus] = useState("")
  const plan = async (event: React.FormEvent) => {
    event.preventDefault(); const token = sessionStorage.getItem("seedingOperatorToken") || ""; if (!token || !campaignId) { setStatus("Kết nối token và chọn campaign trước"); return }
    try { const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/fanout-plan`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ allSocial, channels: allSocial ? undefined : selectedChannels, accountIds: selectedAccounts, execute: true }) }); const body = await response.json(); if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`); const execution = body.execution; setStatus(`${body.ready || 0} READY · ${body.blocked || 0} BLOCKED${execution ? ` · ${execution.targetIds?.length || 0} queued for guarded execution` : ""}`); refresh() } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể tạo fan-out plan") }
  }
  return <section className="panel full-span"><div className="panel-head"><div><h2>Campaign fan-out</h2><p>All Social fan-out và queue tự động qua từng Account Agent đủ session, identity, target readiness và standing authority. Mọi post vẫn qua readiness, quota, kill switch và UNKNOWN quarantine.</p></div></div><form onSubmit={plan} className="scope-selects"><select required value={campaignId} onChange={event => setCampaignId(event.target.value)}><option value="">Chọn campaign</option>{campaigns.map((campaign: R) => <option key={String(campaign.id)} value={String(campaign.id)}>{String(campaign.name || campaign.id)}</option>)}</select><label><input type="checkbox" checked={allSocial} onChange={event => setAllSocial(event.target.checked)} /> All Social</label>{!allSocial && channels.map((channel: R) => <label key={String(channel.id)}><input type="checkbox" checked={selectedChannels.includes(String(channel.id))} onChange={event => setSelectedChannels(current => event.target.checked ? [...new Set([...current, String(channel.id)])] : current.filter(item => item !== String(channel.id)))} /> {String(channel.label || channel.id)}</label>)}{accounts.length ? <fieldset className="account-picker"><legend>Accounts (chọn một hoặc nhiều; bỏ trống = tất cả account phù hợp)</legend>{accounts.map((account: R) => { const id = String(account.accountId || account.id || ""); const key = `${String(account.platform || "")}/${id}`; return <label key={key}><input type="checkbox" checked={selectedAccounts.includes(id)} onChange={event => setSelectedAccounts(current => event.target.checked ? [...new Set([...current, id])] : current.filter(item => item !== id))} /> {key} · {String(account.loginStatus || account.agentStatus || account.sessionHealth || "UNKNOWN")}</label> })}<button type="button" className="secondary-button" onClick={() => setSelectedAccounts(selectedAccounts.length === accounts.length ? [] : accounts.map((account: R) => String(account.accountId || account.id || "")))}>{selectedAccounts.length === accounts.length ? "Bỏ chọn tất cả" : "Chọn tất cả account"}</button></fieldset> : <small>Chưa có Camoufox Account Agent nào.</small>}<button className="primary-button" type="submit">Fan-out và queue tự động</button></form>{accounts.length ? <small>Accounts: {accounts.map((account: R) => `${account.platform}/${account.accountId}`).join(" · ")}</small> : null}{status ? <small>{status}</small> : null}</section>
}

function StandingAuthorizationPanel({ data, refresh }: { data: R, refresh: () => void }) {
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : []
  const accounts = Array.isArray(data?.executionAccounts) ? data.executionAccounts.filter((item: R) => item?.provider === "camoufox" && item?.status === "enabled") : []
  const targets = Array.isArray(data?.targets) ? data.targets.filter((item: R) => item?.status === "active" && item?.channel !== "email") : []
  const [campaignId, setCampaignId] = useState("")
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [authorizationReference, setAuthorizationReference] = useState("")
  const [audience, setAudience] = useState("")
  const [timezone, setTimezone] = useState("Asia/Saigon")
  const [status, setStatus] = useState("")
  const selectedCampaign = campaigns.find((item: R) => String(item.id) === campaignId)
  const selectedTargets = targets.filter((item: R) => targetIds.includes(String(item.id)))
  const target = selectedTargets[0]
  const targetAccount = accounts.find((item: R) => String(item.accountId) === String(target?.accountId) && String(item.platform) === String(target?.channel))
  const authorize = async (event: React.FormEvent) => {
    event.preventDefault()
    const token = sessionStorage.getItem("seedingOperatorToken") || ""
    if (!token || !selectedCampaign || !selectedTargets.length || !targetAccount) { setStatus("Chọn campaign, ít nhất một target và account Agent trước"); return }
    if (!authorizationReference.trim() || !audience.trim()) { setStatus("Nhập standing authorization reference và audience"); return }
    try {
      const multi = selectedTargets.length > 1
      const payload = multi ? {
        productRepo: selectedCampaign.productRepo,
        name: selectedCampaign.name,
        objective: selectedCampaign.objective,
        audience: audience.split(",").map(item => item.trim()).filter(Boolean),
        targetIds: selectedTargets.map((item: R) => String(item.id)),
        authorizationReference: authorizationReference.trim(),
        timezone,
        validityHours: 24,
        quota: 1,
        concurrency: 1,
        visibility: "PUBLIC"
      } : {
        productRepo: selectedCampaign.productRepo,
        name: selectedCampaign.name,
        objective: selectedCampaign.objective,
        audience: audience.split(",").map(item => item.trim()).filter(Boolean),
        platform: target.channel,
        targetId: target.id,
        accountId: target.accountId,
        profileId: target.profileId,
        provider: targetAccount.provider || "camoufox",
        providerProfileId: targetAccount.providerProfileId || targetAccount.profileId,
        identityReference: targetAccount.identityReference || target.identityReference || target.expectedIdentityUrl,
        authorizationReference: authorizationReference.trim(),
        timezone,
        validityHours: 24,
        quota: 1,
        concurrency: 1,
        visibility: "PUBLIC"
      }
      const response = await fetch(multi ? "/api/campaigns/bootstrap-fanout" : "/api/campaigns/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      setStatus(`${body.status || "UNKNOWN"}: ${body.blockers?.[0]?.code || body.authorizationId || "authority evaluated"}`)
      refresh()
    } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể thiết lập standing authorization") }
  }
  return <section className="panel full-span"><div className="panel-head"><div><h2>Standing authorization / Account Agent</h2><p>Chủ tài khoản xác nhận phạm vi đăng tự động một lần. Mỗi target/account vẫn giữ identity, readiness, rules, quota, UNKNOWN quarantine và kill switch riêng.</p></div><span className="status">{String(targetAccount?.loginStatus || targetAccount?.agentStatus || "CHỌN ACCOUNT")}</span></div><form onSubmit={authorize} className="scope-selects"><select required value={campaignId} onChange={event => setCampaignId(event.target.value)}><option value="">Chọn campaign</option>{campaigns.map((campaign: R) => <option key={String(campaign.id)} value={String(campaign.id)}>{String(campaign.name || campaign.id)}</option>)}</select><fieldset className="account-picker"><legend>Targets/accounts (chọn một hoặc nhiều; All Social fan-out vẫn giữ từng binding)</legend>{targets.map((item: R) => <label key={String(item.id)}><input type="checkbox" checked={targetIds.includes(String(item.id))} onChange={event => setTargetIds(current => event.target.checked ? [...new Set([...current, String(item.id)])] : current.filter(id => id !== String(item.id)))} /> {String(item.channel)}/{String(item.accountId)} · {String(item.name || item.id)}</label>)}</fieldset><input required value={authorizationReference} onChange={event => setAuthorizationReference(event.target.value)} placeholder="standing authorization reference" /><input required value={audience} onChange={event => setAudience(event.target.value)} placeholder="audience segments, comma separated" /><input value={timezone} onChange={event => setTimezone(event.target.value)} placeholder="IANA timezone" /><button className="primary-button" type="submit">Authorize autonomous campaign</button></form>{status ? <small>{status}</small> : null}</section>
}

function ScheduleStatusPanel({ data }: { data: R }) {
  const schedules = Array.isArray(data?.schedules) ? data.schedules : []
  const runs = Array.isArray(data?.recentScheduleRuns) ? data.recentScheduleRuns : []
  const latestBySchedule = new Map<string, R>()
  runs.forEach((run: R) => { const id = String(run.scheduleId || ""); if (id && !latestBySchedule.has(id)) latestBySchedule.set(id, run) })
  const labels: Record<string, string> = { running: "RUNNING", blocked: "BLOCKED", failed: "FAILED", succeeded: "QUEUED / EVALUATED", recorded: "RECORDED" }
  return <section className="panel full-span" aria-label="Lịch tự động và trạng thái queue"><div className="panel-head"><div><h2>Lịch tự động</h2><p>Queue chỉ ghi nhận cửa sổ và chuyển qua standing authority/readiness. BLOCKED, UNKNOWN và publication evidence hiển thị riêng; queued không đồng nghĩa đã đăng.</p></div><span className="status">{schedules.length} lịch</span></div>{schedules.length ? <div className="scope-summary">{schedules.map((schedule: R) => { const run = latestBySchedule.get(String(schedule.id)); const state = String(run?.status || (schedule.status === "active" ? "not_due" : "blocked")).toLowerCase(); const blockedTargets = Array.isArray(run?.blockedTargets) ? run.blockedTargets : []; return <div key={String(schedule.id)}><strong>{String(schedule.name || schedule.id)}</strong><span>{String(schedule.localTime || "")} {String(schedule.timezone || "")}</span><span className={`status ${state}`}>{labels[state] || state.toUpperCase()}</span>{run?.windowKey ? <span>window {String(run.windowKey)}</span> : null}{run?.note ? <small>{String(run.note)}</small> : null}{blockedTargets.slice(0, 8).map((item: R, index: number) => <small key={`${String(item.targetId || item.accountId || "blocked")}:${index}`}>BLOCKED {String(item.platform || "")}/{String(item.accountId || "")}: {String(item.reason || "unknown")}</small>)}</div>})}</div> : <div className="empty-state">Chưa có lịch tự động.</div>}</section>
}

function AccountOnboardingPanel({ refresh }: { refresh: () => void }) {
  const [platform, setPlatform] = useState("linkedin")
  const [accountId, setAccountId] = useState("")
  const [profileId, setProfileId] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [targetName, setTargetName] = useState("")
  const [targetUrl, setTargetUrl] = useState("")
  const [status, setStatus] = useState("")
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setStatus("Đang lưu Keychain và chạy Account Agent…")
    try {
      const token = sessionStorage.getItem("seedingOperatorToken") || ""
      if (!token) throw new Error("Kết nối token vận hành trước khi thêm account")
      const response = await fetch("/api/account-credentials", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-agentic-actor": "dashboard-operator" }, body: JSON.stringify({ platform, accountId, profileId, username, password, ...(targetUrl.trim() ? { targetName: targetName.trim() || undefined, targetUrl: targetUrl.trim() } : {}) }) })
      const body = await response.json(); if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      setStatus(`Agent ${body?.login?.status || "UNKNOWN"}: ${body?.login?.reason || "đã ghi nhận"}${body?.target?.status ? ` · target ${body.target.status}` : ""}`); setPassword(""); refresh()
    } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể onboard account") }
  }
  return <section className="panel full-span"><div className="panel-head"><div><h2>Thêm social account</h2><p>Credential lưu Keychain; Account Agent tự mở Camoufox, đăng nhập, rồi lấy identity trực tiếp từ trang đã xác thực. Profile để trống sẽ dùng profile bền vững do app tạo. Target URL tùy chọn; app không tự đoán target.</p></div></div><form onSubmit={submit} className="scope-selects"><input required value={platform} onChange={event => setPlatform(event.target.value)} placeholder="platform" /><input required value={accountId} onChange={event => setAccountId(event.target.value)} placeholder="account ID" /><input value={profileId} onChange={event => setProfileId(event.target.value)} placeholder="Camoufox profile (optional)" /><input required value={username} onChange={event => setUsername(event.target.value)} placeholder="username" autoComplete="username" /><input required type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="password" autoComplete="current-password" /><input value={targetName} onChange={event => setTargetName(event.target.value)} placeholder="target name (optional)" /><input type="url" value={targetUrl} onChange={event => setTargetUrl(event.target.value)} placeholder="exact target URL (optional)" /><button className="primary-button" type="submit">Lưu và chạy Agent</button></form>{status ? <small>{status}</small> : null}</section>
}
function savedScope(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(`growth-dashboard-${key}`) || fallback
  } catch {
    return fallback
  }
}
function CommunityOverview({ data }: { data: R }) {
  const [filter, setFilter] = useState("all")
  const rows = [...(data.communityMemberships || [])].sort((a: R, b: R) =>
    String(b.updatedAt || b.checkedAt || "").localeCompare(
      String(a.updatedAt || a.checkedAt || ""),
    ),
  )
  const filtered =
    filter === "all"
      ? rows
      : rows.filter(
          (item: R) =>
            item.membershipStatus === filter || item.postStatus === filter,
        )
  const groups = Object.entries(communityRepoLabels).map(([repo, label]) => ({
    repo,
    label:
      repo === "design-os-3d-blender"
        ? "Sản phẩm 3D"
        : repo === "design-os-code2flow"
          ? "Vibe Code"
          : "Hoạt ảnh SVG",
    items: filtered.filter((item: R) => item.productRepo === repo),
  }))
  const joined = rows.filter(
    (item: R) => item.membershipStatus === "joined",
  ).length
  const pending = rows.filter(
    (item: R) =>
      item.membershipStatus === "pending" ||
      item.postStatus === "manual_review",
  ).length
  const labels: Record<string, string> = {
    joined: "Đã tham gia",
    pending: "Chờ duyệt",
    rejected: "Bị từ chối",
    blocked: "Bị chặn",
    not_applicable: "Không áp dụng",
    unknown: "Chưa xác minh",
    allowed: "Được đăng",
    manual_review: "Chờ duyệt bài",
  }
  return (
    <section className="panel community-panel full-span">
      <div className="panel-head">
        <div>
          <h2>Cộng đồng theo repo</h2>
          <p>Theo dõi trạng thái tham gia và quyền đăng theo từng sản phẩm.</p>
        </div>
        <div className="community-summary">
          <span className="status ready">{joined} đã tham gia</span>
          <span className="status pending">{pending} chờ duyệt</span>
        </div>
      </div>
      <div className="community-tools">
        <span>{rows.length} cộng đồng đã ghi nhận</span>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="joined">Đã tham gia</option>
          <option value="pending">Chờ duyệt</option>
          <option value="unknown">Chưa xác minh</option>
          <option value="blocked">Bị chặn</option>
          <option value="rejected">Bị từ chối</option>
        </select>
      </div>
      <div className="community-groups">
        {groups.map(({ repo, label, items }) => (
          <article className="community-repo" key={repo}>
            <div className="community-repo-head">
              <span className="track-dot" />
              <div>
                <b>{label}</b>
                <small>{repo}</small>
              </div>
              <strong>
                {items.length}
                <small>cộng đồng</small>
              </strong>
            </div>
            {items.length ? (
              <div className="community-list">
                {items.map((item: R) => (
                  <div className="community-row" key={item.id}>
                    <Mark name={labelChannel(item.platform)} />
                    <div className="community-row-main">
                      <b title={item.communityName}>{item.communityName}</b>
                      <small>
                        {labelChannel(item.platform)} · kiểm tra{" "}
                        {formatDate(item.checkedAt || item.updatedAt)}
                      </small>
                      <div className="community-statuses">
                        <span className={`status ${item.membershipStatus}`}>
                          {labels[item.membershipStatus] || "Chưa xác minh"}
                        </span>
                        <span
                          className={`community-post-status ${item.postStatus}`}
                        >
                          {labels[item.postStatus] || "Chưa rõ quyền đăng"}
                        </span>
                      </div>
                    </div>
                    {item.communityUrl ? (
                      <a
                        className="community-open"
                        href={item.communityUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Mở nhóm ↗
                      </a>
                    ) : (
                      <span className="community-open disabled">
                        Thiếu link
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                Chưa có cộng đồng phù hợp với trạng thái lọc.
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

export default function App() {
  const location = useLocation()
  const path =
    location.pathname === "/" ? "/" : location.pathname.replace(/\/$/, "")
  const [data, setData] = useState<R>({})
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<R | null>(null)
  const [period, setPeriod] = useState(() => savedScope("period", "30d"))
  const [channel, setChannel] = useState(() => savedScope("platform", ""))
  const [repo, setRepo] = useState(() => savedScope("repo", ""))
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const savedTheme: Theme =
        localStorage.getItem("growth-dashboard-theme") === "light"
          ? "light"
          : "dark"
      document.documentElement.dataset.theme = savedTheme
      return savedTheme
    } catch {
      document.documentElement.dataset.theme = "dark"
      return "dark"
    }
  })
  const scopedData = useMemo(
    () => scopeDashboardData(data, period, channel, repo),
    [data, period, channel, repo],
  )
  const load = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setData(await response.json())
      setError("")
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Không thể kết nối API dashboard",
      )
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem("growth-dashboard-theme", theme)
    } catch {
      /* private browsing can disable persistence */
    }
  }, [theme])
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem("growth-dashboard-period", period)
      localStorage.setItem("growth-dashboard-platform", channel)
      localStorage.setItem("growth-dashboard-repo", repo)
    } catch {
      /* private browsing can disable persistence */
    }
  }, [period, channel, repo])
  const periodLabel = `${periodLabels[period]}${
    channel ? ` · ${labelChannel(channel)}` : ""
  }${repo ? ` · ${repo}` : ""}`
  return (
    <div className="app">
      <Sidebar
        path={path}
        theme={theme}
        onToggleTheme={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
        signalCount={
          (scopedData.trafficPulse || scopedData.signals || []).length
        }
      />
      <main className="main">
        <OperatorSessionPanel refresh={load} />
        <AccountOnboardingPanel refresh={load} />
        <NineRouterPanel data={data} refresh={load} />
        <UpdatePanel data={data} refresh={load} />
        <StandingAuthorizationPanel data={data} refresh={load} />
        <ScheduleStatusPanel data={data} />
        <FanoutPlannerPanel data={data} refresh={load} />
        {Object.keys(data).length > 0 && !error ? (
          <DashboardScopeBar
            data={scopedData}
            sourceData={data}
            period={period}
            setPeriod={setPeriod}
            channel={channel}
            setChannel={setChannel}
            repo={repo}
            setRepo={setRepo}
          />
        ) : null}
        {error ? (
          <div className="page-shell">
            <Header
              data={data}
              title={titles[path] || "Growth intelligence"}
              loading={loading}
              refresh={load}
            />
            <div className="empty-state">
              Dashboard API không khả dụng: {error}
            </div>
          </div>
        ) : Object.keys(data).length === 0 ? (
          <div className="page-shell">
            <Header
              data={data}
              title={titles[path] || "Growth intelligence"}
              loading={loading}
              refresh={load}
            />
            <div className="route-loading">
              <div />
              <div />
            </div>
          </div>
        ) : path === "/" ? (
          <div className="page-shell">
            <Header
              data={scopedData}
              title={titles[path]}
              loading={loading}
              refresh={load}
            />
            <Overview
              data={scopedData}
              select={setSelected}
              periodLabel={periodLabel}
            />
            <footer>
              Distribution OS <span>·</span> Dữ liệu từ dashboard API{" "}
              <span>·</span> Asia/Saigon
            </footer>
          </div>
        ) : path === "/leads" ? (
          <div className="page-shell">
            <Header
              data={scopedData}
              title={titles[path]}
              loading={loading}
              refresh={load}
            />
            <LeadsPage integration={data.autoGtm} />
          </div>
        ) : (
          <RoutedPage path={path} data={scopedData} onSelect={setSelected} />
        )}
      </main>
      <PostDrawer
        data={scopedData}
        post={selected}
        close={() => setSelected(null)}
      />
    </div>
  )
}
