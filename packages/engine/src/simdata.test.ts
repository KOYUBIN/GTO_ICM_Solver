import { test } from 'node:test';
import assert from 'node:assert/strict';

import rfiSim from './generated/rfi-sim.json' with { type: 'json' };
import { simRfiRange, simRfiStacks } from './simdata.js';

const POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
const STACKS = [5, 10, 15, 20, 25, 30, 40, 50, 70, 100] as const;
const SHOVE_STACKS = [5, 10, 15] as const;

test('rfi-sim.json exists, parses and carries real simulation output', () => {
  assert.ok(rfiSim.meta, 'meta block present');
  assert.match(rfiSim.meta.model, /raise-EV/, 'model documents the raise-EV blocks');
  assert.match(rfiSim.meta.model, /shove-EV/, 'model documents the push/fold shove-EV blocks');
  assert.ok(
    rfiSim.meta.iterationsPerHand >= 1000,
    `expected a real MC run, got iterationsPerHand=${rfiSim.meta.iterationsPerHand}`,
  );

  const data = rfiSim.data as Record<string, Record<string, number>>;
  const keys = Object.keys(data);
  assert.equal(keys.length, POSITIONS.length * STACKS.length, 'one block per position/stack');
  for (const pos of POSITIONS) {
    for (const stack of STACKS) {
      const block = data[`${pos}-${stack}`];
      assert.ok(block, `block ${pos}-${stack} present`);
      assert.equal(Object.keys(block).length, 169, `${pos}-${stack} covers all 169 labels`);
      for (const ev of Object.values(block)) assert.ok(Number.isFinite(ev));
    }
  }
});

test('blockMeta records the depth-aware model for every block', () => {
  const blockMeta = (rfiSim as { blockMeta?: Record<string, string> }).blockMeta;
  assert.ok(blockMeta, 'blockMeta present');
  for (const pos of POSITIONS) {
    for (const stack of STACKS) {
      const expected = stack <= 15 ? 'shove-EV' : 'raise-EV';
      assert.equal(blockMeta[`${pos}-${stack}`], expected, `${pos}-${stack} model`);
    }
  }
});

test('simRfiRange exposes the per-block model', () => {
  for (const pos of POSITIONS) {
    assert.equal(simRfiRange(pos, 10).model, 'shove-EV', `${pos} 10bb is push/fold`);
    assert.equal(simRfiRange(pos, 15).model, 'shove-EV', `${pos} 15bb is push/fold`);
    assert.equal(simRfiRange(pos, 20).model, 'raise-EV', `${pos} 20bb is a raise model`);
    assert.equal(simRfiRange(pos, 100).model, 'raise-EV', `${pos} 100bb is a raise model`);
  }
});

test('BTN-100 simulated RFI range is wider than UTG-100', () => {
  const btn = simRfiRange('BTN', 100);
  const utg = simRfiRange('UTG', 100);
  assert.ok(
    btn.labels.length > utg.labels.length,
    `BTN ${btn.labels.length} labels should exceed UTG ${utg.labels.length}`,
  );
  // Neither should be degenerate (open-nothing or open-everything).
  assert.ok(utg.labels.length > 0 && btn.labels.length < 169);
});

test('push/fold ranges widen monotonically as stacks get shorter', () => {
  for (const pos of POSITIONS) {
    const n5 = simRfiRange(pos, 5).labels.length;
    const n10 = simRfiRange(pos, 10).labels.length;
    const n15 = simRfiRange(pos, 15).labels.length;
    assert.ok(n5 > n10, `${pos}: 5bb shove (${n5}) should be wider than 10bb (${n10})`);
    assert.ok(n10 > n15, `${pos}: 10bb shove (${n10}) should be wider than 15bb (${n15})`);
  }
});

test('AA open EV beats 72o open EV at every position and stack depth', () => {
  for (const pos of POSITIONS) {
    for (const stack of STACKS) {
      const r = simRfiRange(pos, stack);
      const aa = r.evOf('AA');
      const trash = r.evOf('72o');
      assert.ok(aa !== undefined && trash !== undefined, `${pos}-${stack} has AA and 72o`);
      assert.ok(aa > trash, `${pos}-${stack}: AA ${aa} should beat 72o ${trash}`);
      assert.ok(aa > 0, `${pos}-${stack}: opening AA must be +EV, got ${aa}`);
    }
  }
});

test('shove blocks are push/fold for the requested depths', () => {
  for (const pos of POSITIONS) {
    for (const stack of SHOVE_STACKS) {
      assert.equal(simRfiRange(pos, stack).model, 'shove-EV', `${pos}-${stack}`);
    }
  }
});

test('simRfiRange resolves the nearest simulated stack depth', () => {
  // The 10 MTT depths are now exact hits.
  for (const stack of STACKS) assert.equal(simRfiRange('BTN', stack).stackBB, stack);
  // Off-grid depths snap to the nearest simulated one.
  assert.equal(simRfiRange('BTN', 12).stackBB, 10);
  assert.equal(simRfiRange('BTN', 60).stackBB, 50);
  assert.equal(simRfiRange('BTN', 90).stackBB, 100);
  assert.equal(simRfiRange('UTG', 500).stackBB, 100);
  assert.equal(simRfiRange('SB', 3).stackBB, 5);
  assert.deepEqual(simRfiStacks('CO'), [...STACKS]);
  assert.throws(() => simRfiRange('BB', 100), /No simulated RFI data/);
});
