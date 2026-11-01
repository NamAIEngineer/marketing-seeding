/**
 * Pure evaluator for ordinary persisted daily schedules.
 *
 * This module only answers whether a schedule's current local-time window is
 * due. It does not mutate state, authorize a campaign, create a post, grant a
 * lease, or publish anything. The caller must pass a `DUE` decision through
 * the existing authorization/readiness/queue path, then persist the returned
 * `windowKey` in `scheduleRuns` before the next evaluation.
 */

const LOCAL_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const VALID_CADENCE = "daily";
const ACTIVE_STATUS = "active";
const DISABLED_STATUSES = new Set(["paused", "disabled", "inactive"]);

export const DUE_SCHEDULE_STATUSES = Object.freeze({
  DUE: "DUE",
  NOT_DUE: "NOT_DUE",
  RECORDED: "RECORDED",
  BLOCKED: "BLOCKED",
  INVALID: "INVALID"
});

export const DUE_SCHEDULE_CODES = Object.freeze({
  DUE: "SCHEDULE_DUE",
  NOT_DUE: "SCHEDULE_NOT_DUE",
  RECORDED: "SCHEDULE_WINDOW_ALREADY_RECORDED",
  DISABLED: "SCHEDULE_DISABLED",
  INVALID: "SCHEDULE_INVALID",
  UNKNOWN_STATUS: "SCHEDULE_STATUS_INVALID",
  INVALID_CADENCE: "SCHEDULE_CADENCE_INVALID",
  INVALID_LOCAL_TIME: "SCHEDULE_LOCAL_TIME_INVALID",
  INVALID_TIMEZONE: "SCHEDULE_TIMEZONE_INVALID",
  MISSING_ID: "SCHEDULE_ID_MISSING",
  MISSING_CAMPAIGN: "SCHEDULE_CAMPAIGN_ID_MISSING",
  INVALID_NOW: "SCHEDULE_EVALUATION_TIME_INVALID"
});

function asText(value) {
  return String(value ?? "").trim();
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(DUE_SCHEDULE_CODES.INVALID_NOW);
  return date;
}

function localClock(at, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);
  const value = Object.fromEntries(parts
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  const date = `${value.year}-${value.month}-${value.day}`;
  const time = `${value.hour}:${value.minute}`;
  if (!DATE_RE.test(date) || !LOCAL_TIME_RE.test(time)) throw new Error("SCHEDULE_LOCAL_CLOCK_INVALID");
  return { date, time, weekday: value.weekday || null };
}

function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    return { ok: false, code: DUE_SCHEDULE_CODES.INVALID, reason: "schedule must be an object" };
  }
  const id = asText(schedule.id);
  if (!id) return { ok: false, code: DUE_SCHEDULE_CODES.MISSING_ID, reason: "schedule id is required" };
  const campaignId = asText(schedule.campaignId);
  if (!campaignId) return { ok: false, code: DUE_SCHEDULE_CODES.MISSING_CAMPAIGN, reason: "schedule campaignId is required", id };
  const cadence = asText(schedule.cadence).toLowerCase();
  if (cadence !== VALID_CADENCE) {
    return { ok: false, code: DUE_SCHEDULE_CODES.INVALID_CADENCE, reason: "only daily schedules are supported", id, campaignId };
  }
  const localTime = asText(schedule.localTime);
  if (!LOCAL_TIME_RE.test(localTime)) {
    return { ok: false, code: DUE_SCHEDULE_CODES.INVALID_LOCAL_TIME, reason: "localTime must use HH:mm", id, campaignId };
  }
  const timezone = asText(schedule.timezone);
  if (!timezone) {
    return { ok: false, code: DUE_SCHEDULE_CODES.INVALID_TIMEZONE, reason: "timezone is required", id, campaignId };
  }
  try {
    // Validate once against the observed clock below too. This catches bad
    // IANA names without relying on host-local timezone configuration.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    return { ok: false, code: DUE_SCHEDULE_CODES.INVALID_TIMEZONE, reason: "timezone is not a valid IANA timezone", id, campaignId };
  }
  const status = asText(schedule.status).toLowerCase();
  if (status !== ACTIVE_STATUS && !DISABLED_STATUSES.has(status)) {
    return { ok: false, code: DUE_SCHEDULE_CODES.UNKNOWN_STATUS, reason: "schedule status must be active or disabled", id, campaignId };
  }
  return { ok: true, id, campaignId, cadence, localTime, timezone, status };
}

/**
 * Return the stable identity of one daily local-time window.
 *
 * Include the configured time and timezone so an operator edit starts a new
 * decision identity rather than accidentally reusing a prior configuration.
 */
export function scheduleWindowKey(scheduleOrId, localDate, localTime, timezone) {
  const schedule = scheduleOrId && typeof scheduleOrId === "object"
    ? scheduleOrId
    : { id: scheduleOrId, localTime, timezone };
  const id = asText(schedule.id);
  const date = asText(localDate);
  const time = asText(schedule.localTime ?? localTime);
  const zone = asText(schedule.timezone ?? timezone);
  if (!id || !DATE_RE.test(date) || !LOCAL_TIME_RE.test(time) || !zone) {
    throw new Error("SCHEDULE_WINDOW_KEY_INVALID");
  }
  return `daily:${id}:${date}:${time}:${zone}`;
}

function runMatchesWindow(run, schedule, currentClock, expectedKey) {
  if (!run || typeof run !== "object" || run.scheduleId !== schedule.id) return false;
  for (const field of ["windowKey", "scheduleWindowKey", "scheduledWindowKey"]) {
    const value = asText(run[field]);
    if (value) return value === expectedKey;
  }
  // New callers may persist a local date without persisting the full key.
  for (const field of ["localDate", "windowDate", "scheduledDate", "runDate"]) {
    const value = asText(run[field]);
    if (value) return value === currentClock.date;
  }
  // Existing scheduleRuns only have recordedAt. Derive its local date so old
  // rows remain idempotent without weakening the schedule's timezone rules.
  for (const field of ["scheduledAt", "dueAt", "windowStartAt", "recordedAt", "completedAt", "createdAt"]) {
    const value = run[field];
    if (value === undefined || value === null || value === "") continue;
    try {
      return localClock(asDate(value), schedule.timezone).date === currentClock.date;
    } catch {
      return false;
    }
  }
  return false;
}

function invalidDecision(validation) {
  return {
    schemaVersion: 1,
    scheduleId: validation.id || null,
    campaignId: validation.campaignId || null,
    status: DUE_SCHEDULE_STATUSES.INVALID,
    code: validation.code,
    reason: validation.reason,
    windowKey: null,
    due: false
  };
}

/** Evaluate one schedule against a read-only snapshot of schedule runs. */
export function evaluateDueSchedule(schedule, scheduleRuns = [], now = new Date()) {
  let observed;
  try {
    observed = asDate(now);
  } catch {
    const validation = validateSchedule(schedule);
    return invalidDecision({
      ...validation,
      id: validation.id || null,
      campaignId: validation.campaignId || null,
      code: DUE_SCHEDULE_CODES.INVALID_NOW,
      reason: "evaluation time must be a valid timestamp"
    });
  }
  const validation = validateSchedule(schedule);
  if (!validation.ok) return invalidDecision(validation);
  let clock;
  try {
    clock = localClock(observed, validation.timezone);
  } catch {
    return invalidDecision({ ...validation, ok: false, code: DUE_SCHEDULE_CODES.INVALID_TIMEZONE, reason: "timezone could not produce a local clock" });
  }
  const windowKey = scheduleWindowKey(validation, clock.date);
  const base = {
    schemaVersion: 1,
    scheduleId: validation.id,
    campaignId: validation.campaignId,
    localDate: clock.date,
    localTime: validation.localTime,
    timezone: validation.timezone,
    windowKey,
    due: false
  };
  if (validation.status !== ACTIVE_STATUS) {
    return { ...base, status: DUE_SCHEDULE_STATUSES.BLOCKED, code: DUE_SCHEDULE_CODES.DISABLED, reason: "schedule is disabled", blocked: true };
  }
  if (clock.time < validation.localTime) {
    return { ...base, status: DUE_SCHEDULE_STATUSES.NOT_DUE, code: DUE_SCHEDULE_CODES.NOT_DUE, reason: "local schedule time has not arrived" };
  }
  const runs = Array.isArray(scheduleRuns) ? scheduleRuns : [];
  if (runs.some((run) => runMatchesWindow(run, validation, clock, windowKey))) {
    return { ...base, status: DUE_SCHEDULE_STATUSES.RECORDED, code: DUE_SCHEDULE_CODES.RECORDED, reason: "schedule window already has a recorded run", recorded: true };
  }
  return { ...base, status: DUE_SCHEDULE_STATUSES.DUE, code: DUE_SCHEDULE_CODES.DUE, reason: "active local schedule window is due", due: true };
}

/**
 * Evaluate all persisted schedules. Input accepts a service state-shaped
 * object (`{ schedules, scheduleRuns, now }`) and returns a stable summary.
 * The returned `due` list is advisory only; it carries no authorization or
 * publication side effects.
 */
export function evaluateDueSchedules({ schedules = [], scheduleRuns = [], now = new Date() } = {}) {
  let observed;
  try {
    observed = asDate(now);
  } catch {
    const rows = Array.isArray(schedules) ? schedules : [];
    const decisions = rows.map((schedule) => invalidDecision({
      id: asText(schedule?.id) || null,
      campaignId: asText(schedule?.campaignId) || null,
      code: DUE_SCHEDULE_CODES.INVALID_NOW,
      reason: "evaluation time must be a valid timestamp"
    }));
    return {
      schemaVersion: 1,
      evaluatedAt: null,
      decisions,
      due: [],
      notDue: [],
      recorded: [],
      blocked: [],
      invalid: decisions
    };
  }
  const rows = Array.isArray(schedules) ? schedules : [];
  const runs = Array.isArray(scheduleRuns) ? scheduleRuns : [];
  const decisions = rows.map((schedule) => evaluateDueSchedule(schedule, runs, observed));
  return {
    schemaVersion: 1,
    evaluatedAt: observed.toISOString(),
    decisions,
    due: decisions.filter((item) => item.status === DUE_SCHEDULE_STATUSES.DUE),
    notDue: decisions.filter((item) => item.status === DUE_SCHEDULE_STATUSES.NOT_DUE),
    recorded: decisions.filter((item) => item.status === DUE_SCHEDULE_STATUSES.RECORDED),
    blocked: decisions.filter((item) => item.status === DUE_SCHEDULE_STATUSES.BLOCKED),
    invalid: decisions.filter((item) => item.status === DUE_SCHEDULE_STATUSES.INVALID)
  };
}

