import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySlots, nextEligibleSlot, pilotExperiment } from '../src/growth-pilot.mjs';

test('pilot arms ten slots and blocks until ready', () => {
 const p=pilotExperiment({campaignId:'c'}); assert.equal(p.slots.length,10); assert.equal(p.slots[0],'07:00'); assert.equal(p.slots.at(-1),'23:00');
 assert.equal(nextEligibleSlot({slots:p.slots,ready:false}).status,'BLOCKED');
 assert.equal(nextEligibleSlot({slots:p.slots,ready:true,posted:['07:00'],nowMinutes:500}).slot,'08:47');
});

test('slot generator deterministic',()=>assert.deepEqual(dailySlots({count:3}),['07:00','15:00','23:00']));
