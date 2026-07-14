import { test } from 'node:test';
import assert from 'node:assert/strict';

import rfiSim from './generated/rfi-sim.json' with { type: 'json' };
import { simRfiRange, simRfiStacks } from './simdata.js';

const POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB'] as const;
const STACKS = [20, 50, 100] as const;

test('rfi-sim.json exists, parses and carries real simulation output', () => {
  assert.ok(rfiSim.meta, 'meta block present');
  assert.equal(rfiSim.meta.model, 'chip-EV MC vs positional continue range');
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

test('simRfiRange resolves the nearest simulated stack depth', () => {
  assert.equal(simRfiRange('BTN', 60).stackBB, 50);
  assert.equal(simRfiRange('BTN', 90).stackBB, 100);
  assert.equal(simRfiRange('UTG', 500).stackBB, 100);
  assert.equal(simRfiRange('SB', 5).stackBB, 20);
  assert.deepEqual(simRfiStacks('CO'), [20, 50, 100]);
  assert.throws(() => simRfiRange('BB', 100), /No simulated RFI data/);
});
