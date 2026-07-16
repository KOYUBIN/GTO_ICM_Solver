import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCards, cardToString } from './cards.js';
import { evaluate7, categoryOf, HandCategory } from './handEval.js';
import { parseRange, rangePercent, labelToCombos, comboCount } from './range.js';
import { calcEquity } from './equity.js';
import { icm, riskPremium, dealCalc } from './icm.js';
import { chenScore, pushFoldAdvice } from './preflop.js';

test('card round-trips', () => {
  for (const s of ['As', 'Td', '2c', 'Kh']) {
    assert.equal(cardToString(parseCards(s)[0]), s);
  }
});

test('hand evaluator categories', () => {
  const royal = evaluate7(parseCards('AsKsQsJsTs2c3d'));
  assert.equal(categoryOf(royal), HandCategory.StraightFlush);

  const quads = evaluate7(parseCards('AsAdAhAc2c3d4s'));
  assert.equal(categoryOf(quads), HandCategory.FourOfAKind);

  const wheel = evaluate7(parseCards('As2c3d4h5s9hKd'));
  assert.equal(categoryOf(wheel), HandCategory.Straight);

  const flush = evaluate7(parseCards('As9s5s3s2s7hKd'));
  assert.equal(categoryOf(flush), HandCategory.Flush);

  const twoPair = evaluate7(parseCards('AsAd9h9c2s7h3d'));
  assert.equal(categoryOf(twoPair), HandCategory.TwoPair);
});

test('hand comparison: higher full house wins', () => {
  const aces = evaluate7(parseCards('AsAdAh9c9d2s3h'));
  const kings = evaluate7(parseCards('KsKdKh9c9d2s3h'));
  assert.ok(aces > kings);
});

test('range parsing: 22+ has 13 pairs', () => {
  const r = parseRange('22+');
  let pairs = 0;
  for (const label of r.keys()) if (label[0] === label[1]) pairs++;
  assert.equal(pairs, 13);
});

test('range parsing: AKs+ and dashes', () => {
  const r = parseRange('ATs+');
  assert.deepEqual([...r.keys()].sort(), ['AJs', 'AQs', 'AKs', 'ATs'].sort());
  const d = parseRange('A5s-A2s');
  assert.deepEqual([...d.keys()].sort(), ['A2s', 'A3s', 'A4s', 'A5s'].sort());
});

test('combo counts and range percent', () => {
  assert.equal(comboCount('AA'), 6);
  assert.equal(comboCount('AKs'), 4);
  assert.equal(comboCount('AKo'), 12);
  assert.equal(labelToCombos('AA').length, 6);
  // A full 100% range is ~100%.
  const everything = parseRange(
    '22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q2o+, J2o+, T2o+, 92o+, 82o+, 72o+, 62o+, 52o+, 42o+, 32o',
  );
  assert.ok(rangePercent(everything) > 99);
});

test('equity: AA dominates 72o preflop', () => {
  const res = calcEquity([{ cards: 'AsAd' }, { cards: '7h2c' }], { iterations: 6000, seed: 1 });
  assert.ok(res.equities[0] > 0.8, `AA equity ${res.equities[0]}`);
});

test('equity: dead heat on a quad board', () => {
  const res = calcEquity([{ cards: 'AsKs' }, { cards: 'AhKh' }], { iterations: 3000, seed: 7 });
  assert.ok(Math.abs(res.equities[0] - res.equities[1]) < 0.05);
});

test('icm: equal stacks split equity, chip leader gets more', () => {
  const payouts = [50, 30, 20];
  const equal = icm([1000, 1000, 1000], payouts);
  for (const e of equal.equities) assert.ok(Math.abs(e - 100 / 3) < 0.5);

  const skewed = icm([6000, 2000, 2000], payouts);
  assert.ok(skewed.equities[0] > skewed.equities[1]);
  // ICM compresses: chip leader's equity share < chip share.
  assert.ok(skewed.equities[0] / 100 < 0.6);
});

test('icm: risk premium is positive on the bubble', () => {
  // 4 players, 3 paid: classic bubble pressure.
  const rp = riskPremium([3000, 3000, 3000, 3000], [50, 30, 20], 0, 1, 3000);
  assert.ok(rp > 0, `risk premium ${rp}`);
});

test('dealCalc: both methods sum to the contested prize total', () => {
  const payouts = [500, 300, 200];
  const d = dealCalc([6000, 2000, 2000], payouts);
  assert.equal(d.totalPrize, 1000);
  assert.equal(d.floor, 200); // 3 players contest places 1-3; floor = 3rd place
  const sumIcm = d.icm.reduce((a, b) => a + b, 0);
  const sumChop = d.chipChop.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumIcm - 1000) < 1e-6, `icm sum ${sumIcm}`);
  assert.ok(Math.abs(sumChop - 1000) < 1e-6, `chop sum ${sumChop}`);
});

test('dealCalc: chip chop gives the leader more, floor to everyone, ICM compresses', () => {
  const payouts = [500, 300, 200];
  const d = dealCalc([6000, 2000, 2000], payouts);
  // Leader wins the most under both methods; everyone clears the floor.
  assert.ok(d.chipChop[0] > d.chipChop[1]);
  assert.ok(d.icm[0] > d.icm[1]);
  for (const v of d.chipChop) assert.ok(v >= d.floor - 1e-9);
  // Chip chop is more chip-weighted than ICM, so it pays the leader more.
  assert.ok(d.chipChop[0] > d.icm[0], `chop ${d.chipChop[0]} vs icm ${d.icm[0]}`);
});

test('dealCalc: fewer remaining players than paid places only contests the top prizes', () => {
  const payouts = [500, 300, 200, 100];
  const d = dealCalc([5000, 5000], payouts); // 2 left, 4 paid
  assert.equal(d.totalPrize, 800); // only places 1-2 are in play
  assert.equal(d.floor, 300);
  // Even stacks → even chop; ICM also ~even.
  assert.ok(Math.abs(d.chipChop[0] - d.chipChop[1]) < 1e-6);
});

test('preflop: AA strongest, push/fold shoves AA short', () => {
  assert.ok(chenScore('AA') >= chenScore('KK'));
  assert.ok(chenScore('AKs') > chenScore('72o'));
  const advice = pushFoldAdvice('AA', 8, 2);
  assert.equal(advice.action, 'push');
  const trash = pushFoldAdvice('72o', 15, 5);
  assert.equal(trash.action, 'fold');
});
