import { readFile } from "node:fs/promises";
import path from "node:path";
import { appRoot } from "./paths.mjs";

const campaignRoot = path.join(appRoot, "campaigns", "design-os-studio-launch");
const manifestPath = path.join(campaignRoot, "video", "video-manifest.json");
const draftsPath = path.join(campaignRoot, "drafts", "drafts-2026-11-02.json");
const northStarPath = path.join(appRoot, "plans", "growth-lead-20261102", "evidence", "north-star-2026-11-02.md");
const communityReceiptPath = path.join(appRoot, "plans", "growth-lead-20261102", "evidence", "community-receipt-20261101.json");

async function readJson(filePath, fallback) {
  try {
    return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

async function readText(filePath) {
  try { return await readFile(filePath, "utf8"); } catch { return ""; }
}

function safeAssetName(value) {
  const name = path.basename(String(value || "").trim());
  return name && name === String(value || "").trim().split("/").at(-1) ? name : null;
}

function northStarProjection(markdown) {
  const stars = Number(markdown.match(/(?:FACT|Current|stars)[^\n]{0,80}?([0-9]+)\s+stars/i)?.[1]);
  const observedAt = markdown.match(/2026-11-01[^\n]*(?:ICT|\+07:00)/i)?.[0] || null;
  return {
    repoUrl: "https://github.com/jangtrinh/design-os-studio",
    target: 1000,
    current: Number.isSafeInteger(stars) ? stars : null,
    deltaToday: null,
    observedAt,
    source: markdown ? "plans/growth-lead-20261102/evidence/north-star-2026-11-02.md" : null,
    status: Number.isSafeInteger(stars) ? "OBSERVED_STALE_REFRESH" : "UNKNOWN",
  };
}

function mapArtifact(artifact, index) {
  if (!artifact) return null;
  const videoName = safeAssetName(artifact.path?.split("/").at(-1));
  const thumbnailName = safeAssetName(artifact.thumbnail?.split("/").at(-1));
  return {
    postId: artifact.postId || `growth-20261102-${String(index + 1).padStart(2, "0")}`,
    path: artifact.path || null,
    sha256: artifact.sha256 || null,
    thumbnail: artifact.thumbnail || null,
    qa: artifact.qa || "UNKNOWN",
    quality: artifact.quality || "UNKNOWN",
    source: artifact.source || "UNKNOWN",
    eligibleSurfaceAspectRatio: artifact.eligibleSurfaceAspectRatio || "UNKNOWN",
    spec: artifact.spec || null,
    videoUrl: videoName ? `/api/growth/video/${encodeURIComponent(videoName)}` : null,
    thumbnailUrl: thumbnailName ? `/api/growth/thumbnail/${encodeURIComponent(thumbnailName)}` : null,
  };
}

export async function loadGrowthLeadProjection({ dashboard = null } = {}) {
  const [manifest, drafts, northStar, community] = await Promise.all([
    readJson(manifestPath, { reference: null, artifacts: [] }),
    readJson(draftsPath, { campaign: "Design OS Studio — daily distribution", date: "2026-11-02", drafts: [] }),
    readText(northStarPath),
    readJson(communityReceiptPath, { dashboard: {}, discoveries: [], membershipChecks: [], joinProjection: null }),
  ]);
  const artifacts = (Array.isArray(manifest.artifacts) ? manifest.artifacts : []).map(mapArtifact).filter(Boolean);
  // A manifest entry is eligible only when the recorded QA result is a pass
  // that is not contradicted by the quality-A intake evidence. The intake
  // receipt is authoritative for the current capture run; it records that the
  // physical displays contained Claude/Orca rather than Design OS Studio.
  const qualityAIntake = await readJson(path.join(campaignRoot, "video", "quality-a", "quality-a.json"), null);
  const captureBlocked = qualityAIntake?.status === "BLOCKED_CAPTURE_TARGET_UNAVAILABLE";
  const effectiveArtifacts = captureBlocked
    ? artifacts.map((item) => ({
      ...item,
      qa: "BLOCKED_CAPTURE_TARGET_UNAVAILABLE",
      quality: "UNVERIFIED",
      source: "capture evidence contradicted: physical display did not show Design OS Studio",
    }))
    : artifacts;
  const draftRows = Array.isArray(drafts.drafts) ? drafts.drafts : [];
  const canonicalPosts = Array.isArray(dashboard?.posts) ? dashboard.posts : [];
  const posts = draftRows.slice(0, 10).map((draft, index) => {
    const canonical = canonicalPosts.find((item) => item.id === draft.id) || null;
    return {
    id: draft.id || `growth-draft-${index + 1}`,
    channel: draft.channel || "UNKNOWN",
    locale: draft.locale || "UNKNOWN",
    opening: draft.opening || "UNKNOWN",
    state: draft.state || "DRAFT",
    repoUrl: draft.repoUrl || drafts.repoUrl || "https://github.com/jangtrinh/design-os-studio",
    videoSlot: draft.videoSlot || `dos-video-slot-${String(index + 1).padStart(2, "0")}`,
    video: effectiveArtifacts[index] || null,
    publicationStatus: canonical?.status === "published" && canonical.publicationUrl ? "PUBLISHED_UNVERIFIED" : "UNKNOWN",
    permalink: canonical?.publicationUrl || null,
    latestMetric: canonical ? (dashboard?.latestMetrics?.[canonical.id] || null) : null,
    source: canonical?.source || null,
    evidenceHash: canonical?.evidenceHash || null,
    };
  });
  const qaFail = effectiveArtifacts.filter((item) => !String(item.qa).startsWith("PASS")).length;
  const communityDashboard = community.dashboard && typeof community.dashboard === "object" ? community.dashboard : {};
  const discoveries = Array.isArray(dashboard?.communityDiscoveries) && dashboard.communityDiscoveries.length
    ? dashboard.communityDiscoveries
    : (Array.isArray(community.discoveries) ? community.discoveries : []);
  const canonicalPilot = Array.isArray(dashboard?.pilotExperiments) ? dashboard.pilotExperiments : [];
  return {
    campaign: drafts.campaign || "Design OS Studio — daily distribution",
    date: drafts.date || "2026-11-02",
    targetPosts: 10,
    eligibleSurfaces: ["linkedin_personal", "linkedin_page", "facebook_timeline", "facebook_page", "facebook_member_group"],
    pausedSurfaces: ["threads", "reddit", "product_hunt", "indie_hackers", "x"],
    posts,
    pilot: {
      status: canonicalPilot.at(-1)?.status || "UNKNOWN",
      experiments: canonicalPilot,
      reports: Array.isArray(dashboard?.pilotReports) ? dashboard.pilotReports : [],
      schedule: canonicalPilot.at(-1) ? {
        slots: canonicalPilot.at(-1).slots || [],
        timezone: canonicalPilot.at(-1).timezone || "Asia/Ho_Chi_Minh",
        readinessGate: canonicalPilot.at(-1).readinessGate || "account_ready",
        firstPostWithinMinutes: canonicalPilot.at(-1).firstPostWithinMinutes || 15,
        missedSlotPolicy: canonicalPilot.at(-1).missedSlotPolicy || "shift_to_next_slot_no_burst"
      } : null
    },
    videos: {
      ready: effectiveArtifacts.length,
      qaFail,
      bufferTomorrow: effectiveArtifacts.length >= 10 && qaFail === 0 ? effectiveArtifacts.length : 0,
      reference: manifest.reference || null,
      artifacts: effectiveArtifacts,
    },
    northStar: northStarProjection(northStar),
    community: {
      ...communityDashboard,
      discovered: Number(dashboard?.communityDiscoveries?.length || communityDashboard.discovered || discoveries.length || 0),
      discoveries,
      membershipChecks: Array.isArray(community.membershipChecks) ? community.membershipChecks : [],
      joinProjection: community.joinProjection || null,
    },
  };
}

export async function readRegisteredGrowthAsset(kind, requestedName) {
  const projection = await loadGrowthLeadProjection();
  const name = safeAssetName(requestedName);
  if (!name) return null;
  const candidates = kind === "thumbnail"
    ? projection.videos.artifacts.map((item) => item.thumbnail).filter(Boolean)
    : projection.videos.artifacts.map((item) => item.path).filter(Boolean);
  const relative = candidates.find((candidate) => path.basename(candidate) === name);
  if (!relative) return null;
  return {
    absolutePath: path.join(campaignRoot, relative.replace(/^campaigns\/design-os-studio-launch\//, "")),
    contentType: kind === "thumbnail" ? "image/jpeg" : "video/mp4",
  };
}
