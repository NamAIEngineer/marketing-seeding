import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPilotReport, dailySlots, nextEligibleSlot, pilotExperiment } from '../src/growth-pilot.mjs';

test('pilot arms ten slots and blocks until ready', () => {
 const p=pilotExperiment({campaignId:'c'}); assert.equal(p.slots.length,10); assert.equal(p.slots[0],'07:00'); assert.equal(p.slots.at(-1),'23:00');
 assert.equal(nextEligibleSlot({slots:p.slots,ready:false}).status,'BLOCKED');
 assert.equal(nextEligibleSlot({slots:p.slots,ready:true,posted:['07:00'],nowMinutes:500}).slot,'08:47');
});

test('slot generator deterministic',()=>assert.deepEqual(dailySlots({count:3}),['07:00','15:00','23:00']));

test('missed slots never burst and report remains durable observations only', () => {
 const p = pilotExperiment({ id: 'pilot-test', startDate: '2026-11-02', endDate: '2026-11-08' });
 const exhausted = nextEligibleSlot({ slots: p.slots, posted: p.slots, nowMinutes: 23 * 60, ready: true });
 assert.deepEqual(exhausted, { status: 'EXHAUSTED', reason: 'no_slot_no_burst' });
 const report = buildPilotReport({ experiment: p, date: '2026-11-02', observations: [] });
 assert.equal(report.experimentId, 'pilot-test');
 assert.equal(report.reportTime, '23:30');
 assert.equal(report.status, 'durable_observations_only');
 assert.deepEqual(report.observations, []);
});

test('pilot carries bounded activation and warning contract', () => {
 const p = pilotExperiment({});
 assert.equal(p.status, 'armed');
 assert.equal(p.readinessGate, 'account_ready');
 assert.equal(p.firstPostWithinMinutes, 15);
 assert.equal(p.warningRule.durationHours, 48);
 assert.equal(p.warningRule.maxNextDayMixChangePercent, 30);
});
