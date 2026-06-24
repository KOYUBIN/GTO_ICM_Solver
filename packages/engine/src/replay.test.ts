import { test } from 'node:test';
import assert from 'node:assert/strict';

import { streetEquities } from './replay.js';

test('streetEquities: KK vs 88 preflop ~80/20, exact on a set board', () => {
  // Final board makes 88 a set (trips) -> 88 wins at the river.
  const rows = streetEquities(['KsKc', '8h8d'], '8s7c2d Qh 3s');
  const pre = rows.find((r) => r.street === 'preflop')!;
  // KK is ~80% preflop vs 88 (the underdog ~19-20%).
  assert.ok(pre.equities[0] > 0.75 && pre.equities[0] < 0.86, `KK pre ${pre.equities[0]}`);
  // Flop gives 88 a set -> 88 now far ahead.
  const flop = rows.find((r) => r.street === 'flop')!;
  assert.ok(flop.equities[1] > 0.85, `88 flop ${flop.equities[1]}`);
  // River is exact: 88 (set) wins outright.
  const river = rows.find((r) => r.street === 'river')!;
  assert.equal(river.cards, 5);
  assert.ok(river.equities[1] > 0.99, `88 river ${river.equities[1]}`);
});

test('streetEquities: only returns streets up to the given board length', () => {
  assert.equal(streetEquities(['AsKs', 'QdQh'], '').length, 1); // preflop only
  assert.equal(streetEquities(['AsKs', 'QdQh'], 'Ah7d2c').length, 2); // + flop
});
