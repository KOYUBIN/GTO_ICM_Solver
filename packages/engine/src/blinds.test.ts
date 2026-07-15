import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getPreset, PRESET_LIST, BLIND_PRESETS } from './blinds.js';

test("monster preset exists with the expected top-level fields", () => {
  const p = getPreset('monster');
  assert.equal(p.id, 'monster');
  assert.equal(p.name, '몬스터 (파이널 나인)');
  assert.equal(p.startingStack, 2_500_000);
  assert.equal(p.levelMinutes, 10);
  assert.equal(p.isCash, false);
  assert.equal(p.rebuyStack, 3_000_000);
  assert.equal(p.lateRegLevel, 10);
});

test("monster ladder has a strictly increasing bigBlind", () => {
  const p = getPreset('monster');
  assert.ok(p.levels.length >= 16, `expected >=16 levels, got ${p.levels.length}`);
  for (let i = 1; i < p.levels.length; i++) {
    assert.ok(
      p.levels[i].bigBlind > p.levels[i - 1].bigBlind,
      `bigBlind not increasing at level ${p.levels[i].level}`,
    );
  }
});

test("monster ante is 0 for L1-L2 and > 0 from L3 onward", () => {
  const p = getPreset('monster');
  assert.equal(p.levels[0].ante, 0);
  assert.equal(p.levels[1].ante, 0);
  for (let i = 2; i < p.levels.length; i++) {
    assert.ok(p.levels[i].ante > 0, `ante should be > 0 at level ${p.levels[i].level}`);
  }
});

test("monster level 1 opens at 10k/20k", () => {
  const p = getPreset('monster');
  assert.equal(p.levels[0].smallBlind, 10_000);
  assert.equal(p.levels[0].bigBlind, 20_000);
});

test("PRESET_LIST includes the monster preset", () => {
  assert.ok(
    PRESET_LIST.some((preset) => preset.id === 'monster'),
    'PRESET_LIST should contain monster',
  );
  assert.equal(PRESET_LIST.includes(BLIND_PRESETS.monster), true);
});

test("optional fields stay undefined on presets that do not use them", () => {
  // Backward-compatible: existing presets never set the new optional fields.
  assert.equal(BLIND_PRESETS.classic.rebuyStack, undefined);
  assert.equal(BLIND_PRESETS.classic.lateRegLevel, undefined);
});
