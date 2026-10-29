import test from "node:test";
import assert from "node:assert/strict";
import {
  DUE_SCHEDULE_CODES,
  DUE_SCHEDULE_STATUSES,
  evaluateDueSchedule,
  evaluateDueSchedules,
  scheduleWindowKey
} from "../src/campaign-due-schedule.mjs";

function schedule(overrides = {}) {
  return {
    id: "schedule-1",
    campaignId: "campaign-1",
    cadence: "daily",
    localTime: "09:30",
    timezone: "UTC",
    status: "active",
    ...overrides
  };
}

test("daily schedule is not due before local time and due at the boundary", () => {
  const item = schedule();
  const before = evaluateDueSchedule(item, [], "2026-10-30T09:29:59.999Z");
  assert.equal(before.status, DUE_SCHEDULE_STATUSES.NOT_DUE);
  assert.equal(before.code, DUE_SCHEDULE_CODES.NOT_DUE);
  const at = evaluateDueSchedule(item, [], "2026-10-30T09:30:00.000Z");
  assert.equal(at.status, DUE_SCHEDULE_STATUSES.DUE);
  assert.equal(at.due, true);
  assert.equal(at.windowKey, scheduleWindowKey(item, "2026-10-30"));
});

test("recorded window is idempotent, including legacy recordedAt-only runs", () => {
  const item = schedule();
  const expectedKey = scheduleWindowKey(item, "2026-10-30");
  const explicit = evaluateDueSchedule(item, [{ scheduleId: item.id, windowKey: expectedKey, status: "running" }], "2026-10-30T18:00:00Z");
  assert.equal(explicit.status, DUE_SCHEDULE_STATUSES.RECORDED);
  assert.equal(explicit.recorded, true);
  const legacy = evaluateDueSchedule(item, [{ scheduleId: item.id, status: "succeeded", recordedAt: "2026-10-30T11:00:00Z" }], "2026-10-30T18:00:00Z");
  assert.equal(legacy.status, DUE_SCHEDULE_STATUSES.RECORDED);
  const priorDay = evaluateDueSchedule(item, [{ scheduleId: item.id, status: "succeeded", recordedAt: "2026-10-29T11:00:00Z" }], "2026-10-30T18:00:00Z");
  assert.equal(priorDay.status, DUE_SCHEDULE_STATUSES.DUE);
});

test("timezone conversion uses local calendar date and DST-safe local clock", () => {
  const item = schedule({ timezone: "America/New_York", localTime: "09:30" });
  const due = evaluateDueSchedule(item, [], "2026-03-08T14:30:00Z");
  assert.equal(due.localDate, "2026-03-08");
  assert.equal(due.status, DUE_SCHEDULE_STATUSES.DUE);
  const firstFallBack = evaluateDueSchedule({ ...item, localTime: "01:30" }, [], "2026-11-01T05:30:00Z");
  const secondFallBack = evaluateDueSchedule({ ...item, localTime: "01:30" }, [], "2026-11-01T06:30:00Z");
  assert.equal(firstFallBack.localDate, "2026-11-01");
  assert.equal(firstFallBack.windowKey, secondFallBack.windowKey);
});

test("disabled and malformed schedules fail closed with explicit statuses", () => {
  const disabled = evaluateDueSchedule(schedule({ status: "paused" }), [], "2026-10-30T18:00:00Z");
  assert.equal(disabled.status, DUE_SCHEDULE_STATUSES.BLOCKED);
  assert.equal(disabled.code, DUE_SCHEDULE_CODES.DISABLED);
  const malformedTime = evaluateDueSchedule(schedule({ localTime: "9:30" }), [], "2026-10-30T18:00:00Z");
  assert.equal(malformedTime.status, DUE_SCHEDULE_STATUSES.INVALID);
  assert.equal(malformedTime.code, DUE_SCHEDULE_CODES.INVALID_LOCAL_TIME);
  const malformedZone = evaluateDueSchedule(schedule({ timezone: "Not/An_Zone" }), [], "2026-10-30T18:00:00Z");
  assert.equal(malformedZone.status, DUE_SCHEDULE_STATUSES.INVALID);
  assert.equal(malformedZone.code, DUE_SCHEDULE_CODES.INVALID_TIMEZONE);
});

test("summary partitions decisions without granting execution authority", () => {
  const result = evaluateDueSchedules({
    now: "2026-10-30T18:00:00Z",
    schedules: [schedule(), schedule({ id: "schedule-2", status: "paused" }), schedule({ id: "schedule-3", localTime: "25:00" })],
    scheduleRuns: []
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.decisions.length, 3);
  assert.equal(result.due.length, 1);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.due[0].published, undefined);
  assert.equal(result.due[0].authorized, undefined);
});

