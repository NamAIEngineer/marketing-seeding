const SLOT_START = 7 * 60;
const SLOT_END = 23 * 60;

export function dailySlots({ start = "07:00", end = "23:00", count = 10 } = {}) {
  const parse = (v) => { const [h, m] = String(v).split(":").map(Number); return h * 60 + m; };
  const from = parse(start); const to = parse(end);
  if (!Number.isInteger(count) || count < 1 || to <= from) throw new Error("PILOT_SLOT_WINDOW_INVALID");
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const minute = Math.round(from + step * i);
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  });
}

export function pilotExperiment(input = {}) {
  const slots = dailySlots(input);
  return {
    schemaVersion: 1,
    id: String(input.id || `pilot-${input.campaignId || "design-os"}-${input.startDate || "2026-11-02"}`),
    campaignId: input.campaignId || null,
    startDate: input.startDate || "2026-11-02",
    endDate: input.endDate || "2026-11-08",
    timezone: input.timezone || "Asia/Ho_Chi_Minh",
    status: input.status || "armed",
    slotCount: slots.length,
    slots,
    readinessGate: "account_ready",
    firstPostWithinMinutes: 15,
    missedSlotPolicy: "shift_to_next_slot_no_burst",
    variables: ["timeBand", "openingStyle", "videoVariant", "aspectDuration", "placementGroupType", "language"],
    metrics: ["clicks1h", "clicks24h", "clicks72h", "engagement1h", "engagement24h", "engagement72h", "githubStars"],
    warningRule: { checkpointOrWarning: "halve_frequency", durationHours: 48, maxNextDayMixChangePercent: 30 }
  };
}

export function nextEligibleSlot({ slots, posted = [], nowMinutes, ready = false }) {
  if (!ready) return { status: "BLOCKED", reason: "account_not_ready" };
  const used = new Set(posted.map(String));
  const next = (slots || []).find((slot) => !used.has(slot) && (nowMinutes == null || toMinutes(slot) >= nowMinutes));
  return next ? { status: "ELIGIBLE", slot: next } : { status: "EXHAUSTED", reason: "no_slot_no_burst" };
}

function toMinutes(value) { const [h, m] = String(value).split(":").map(Number); return h * 60 + m; }

export function buildPilotReport({ experiment, date, observations = [], generatedAt = new Date().toISOString() }) {
  return { schemaVersion: 1, experimentId: experiment?.id || null, date, generatedAt, reportTime: "23:30", observations, status: "durable_observations_only" };
}

export const PILOT_WINDOW = Object.freeze({ start: SLOT_START, end: SLOT_END });
