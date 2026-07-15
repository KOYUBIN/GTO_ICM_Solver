import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rangeMatchup } from './matchup.js';
import { labelToCombos, parseRange, rangeToCombos, Combo } from './range.js';
import { parseCards } from './cards.js';

function combosOf(rangeStr: string): Combo[] {
  return rangeToCombos(parseRange(rangeStr)).map((x) => x.combo);
}

const WIDE =
  '22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, Q9o+, J9o+, T9o';

test('AA-only range dominates a wide range preflop (equity > 0.8, nutPct = 1)', () => {
  const res = rangeMatchup({
    ranges: [labelToCombos('AA'), combosOf(WIDE)],
    iterations: 8000,
    seed: 42,
  });
  assert.equal(res.rangeEquities.length, 2);
  assert.ok(res.rangeEquities[0] > 0.8, `AA equity ${res.rangeEquities[0]}`);
  assert.equal(res.nutPct[0], 1); // the whole range (AA) clears the 0.80 nut bar
  assert.ok(res.nutPct[1] < 0.2, `wide-range nutPct ${res.nutPct[1]}`);
  // Distribution of the AA range is a single label carrying all 6 combos.
  assert.equal(res.distributions[0].length, 1);
  assert.equal(res.distributions[0][0].label, 'AA');
  assert.equal(res.distributions[0][0].weightCombos, 6);
  // strongPct is a looser bar than nutPct.
  for (let i = 0; i < 2; i++) assert.ok(res.strongPct[i] >= res.nutPct[i]);
});

test('sets vs A5s on Ks7h2c: huge nut advantage for the set range', () => {
  const res = rangeMatchup({
    ranges: [combosOf('KK, 77, 22'), combosOf('A5s')],
    board: 'Ks7h2c',
    iterations: 8000,
    seed: 7,
  });
  assert.ok(res.rangeEquities[0] > 0.85, `set-range equity ${res.rangeEquities[0]}`);
  assert.equal(res.nutPct[0], 1, 'every set label should be >= 0.80 equity');
  assert.equal(res.nutPct[1], 0, 'A5s never clears the nut bar vs sets');
  // Board card removal: Ks/7h/2c each kill 3 of the 6 pair combos.
  for (const d of res.distributions[0]) assert.equal(d.weightCombos, 3);
  // Distributions come back sorted strongest-first.
  for (const dist of res.distributions) {
    for (let j = 1; j < dist.length; j++) {
      assert.ok(dist[j - 1].equity >= dist[j].equity, 'distribution must be sorted desc');
    }
  }
});

test('3-range multiway: equities sum to ~1 and every range gets a distribution', () => {
  const res = rangeMatchup({
    ranges: [combosOf('QQ+'), combosOf('AK'), combosOf('99-77, JTs')],
    iterations: 6000,
    seed: 3,
  });
  assert.equal(res.rangeEquities.length, 3);
  assert.equal(res.distributions.length, 3);
  assert.equal(res.nutPct.length, 3);
  assert.equal(res.strongPct.length, 3);
  const sum = res.rangeEquities.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `equities sum ${sum}`);
  // QQ+ should be the strongest range of the three.
  assert.ok(res.rangeEquities[0] > res.rangeEquities[2]);
});

test('same seed reproduces the exact same result; different seed may differ', () => {
  const make = () => ({
    ranges: [combosOf('TT+, AQs+'), combosOf(WIDE)],
    board: 'Ah7d2s',
    iterations: 4000,
    seed: 99,
  });
  const a = rangeMatchup(make());
  const b = rangeMatchup(make());
  assert.deepEqual(a.rangeEquities, b.rangeEquities);
  assert.deepEqual(a.distributions, b.distributions);
  assert.deepEqual(a.nutPct, b.nutPct);
  assert.deepEqual(a.strongPct, b.strongPct);
});

test('sampleCombosPerLabel > 1 averages more combos without changing weights', () => {
  const res = rangeMatchup({
    ranges: [combosOf('AKs'), combosOf('QQ')],
    iterations: 4000,
    seed: 11,
    sampleCombosPerLabel: 3,
  });
  assert.equal(res.distributions[0].length, 1);
  assert.equal(res.distributions[0][0].weightCombos, 4); // AKs = 4 combos
  assert.ok(res.distributions[0][0].equity > 0.2 && res.distributions[0][0].equity < 0.6);
});

test('throws Korean errors on bad inputs', () => {
  const aa = labelToCombos('AA');
  const kk = labelToCombos('KK');
  // Not 2..4 ranges.
  assert.throws(() => rangeMatchup({ ranges: [aa] }), /2~4/);
  assert.throws(() => rangeMatchup({ ranges: [aa, kk, aa, kk, aa] }), /2~4/);
  // Empty range.
  assert.throws(() => rangeMatchup({ ranges: [aa, []] }), /비어/);
  // Bad board length / duplicate board card.
  assert.throws(() => rangeMatchup({ ranges: [aa, kk], board: 'AhKd' }), /보드/);
  assert.throws(() => rangeMatchup({ ranges: [aa, kk], board: 'AhAh2c' }), /중복/);
  // A range whose every combo collides with the board.
  const asah = [parseCards('AsAh') as Combo];
  assert.throws(() => rangeMatchup({ ranges: [asah, kk], board: 'As7h2c' }), /겹칩니다/);
});
