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

export async function loadGrowthLeadProjection() {
  const [manifest, drafts, northStar, community] = await Promise.all([
    readJson(manifestPath, { reference: null, artifacts: [] }),
    readJson(draftsPath, { campaign: "Design OS Studio — daily distribution", date: "2026-11-02", drafts: [] }),
    readText(northStarPath),
    readJson(communityReceiptPath, { dashboard: {}, discoveries: [], membershipChecks: [], joinProjection: null }),
  ]);
  const artifacts = (Array.isArray(manifest.artifacts) ? manifest.artifacts : []).map(mapArtifact).filter(Boolean);
  const draftRows = Array.isArray(drafts.drafts) ? drafts.drafts : [];
  const posts = draftRows.slice(0, 10).map((draft, index) => ({
    id: draft.id || `growth-draft-${index + 1}`,
    channel: draft.channel || "UNKNOWN",
    locale: draft.locale || "UNKNOWN",
    opening: draft.opening || "UNKNOWN",
    state: draft.state || "DRAFT",
    repoUrl: draft.repoUrl || drafts.repoUrl || "https://github.com/jangtrinh/design-os-studio",
    videoSlot: draft.videoSlot || `dos-video-slot-${String(index + 1).padStart(2, "0")}`,
    video: artifacts[index] || null,
    publicationStatus: "UNKNOWN",
    permalink: null,
    latestMetric: null,
  }));
  const qaFail = artifacts.filter((item) => !String(item.qa).startsWith("PASS")).length;
  const dashboard = community.dashboard && typeof community.dashboard === "object" ? community.dashboard : {};
  return {
    campaign: drafts.campaign || "Design OS Studio — daily distribution",
    date: drafts.date || "2026-11-02",
    targetPosts: 10,
    eligibleSurfaces: ["linkedin_personal", "linkedin_page", "facebook_timeline", "facebook_page", "facebook_member_group"],
    pausedSurfaces: ["threads", "reddit", "product_hunt", "indie_hackers", "x"],
    posts,
    videos: {
      ready: artifacts.length,
      qaFail,
      bufferTomorrow: artifacts.length >= 10 && qaFail === 0 ? artifacts.length : 0,
      reference: manifest.reference || null,
      artifacts,
    },
    northStar: northStarProjection(northStar),
    community: {
      ...dashboard,
      discoveries: Array.isArray(community.discoveries) ? community.discoveries : [],
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
