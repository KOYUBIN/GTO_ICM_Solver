import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAYOUT_PRESETS,
  payoutsFor,
  bubbleFactor,
  icmShoveEv,
  MONSTER_GAME,
  monsterPaidCount,
  monsterPrizePool,
  monsterPayouts,
} from './mtt.js';

// ---------- payout presets ----------

test('every payout preset sums to ~1 with descending positive payouts', () => {
  assert.ok(PAYOUT_PRESETS.length >= 6);
  for (const p of PAYOUT_PRESETS) {
    assert.ok(p.id.length > 0 && p.name.length > 0);
    assert.ok(p.minPlayers >= 2, `${p.id} minPlayers`);
    assert.ok(p.maxPlayers >= p.minPlayers, `${p.id} min <= max`);
    assert.ok(p.payouts.length >= 1 && p.payouts.length <= p.maxPlayers, `${p.id} places`);
    const sum = p.payouts.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-3, `${p.id} payouts sum ${sum}, expected ~1`);
    for (let i = 0; i < p.payouts.length; i++) {
      assert.ok(p.payouts[i] > 0, `${p.id} place ${i} must be positive`);
      if (i > 0) {
        assert.ok(p.payouts[i] <= p.payouts[i - 1], `${p.id} payouts must be descending`);
      }
    }
  }
});

test('payoutsFor covers every field size from heads-up to huge fields', () => {
  for (let field = 2; field <= 1200; field++) {
    const payouts = payoutsFor(field);
    assert.ok(payouts.length >= 1, `no payouts for field ${field}`);
    assert.ok(payouts.length <= field, `field ${field} pays more places than players`);
    const sum = payouts.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-3, `field ${field} payouts sum ${sum}`);
  }
});

test('payoutsFor picks the standard structures by field size', () => {
  assert.deepEqual(payoutsFor(2), [1]); // heads-up: winner takes all
  assert.deepEqual(payoutsFor(6), [0.65, 0.35]); // 6-max SNG
  assert.deepEqual(payoutsFor(9), [0.5, 0.3, 0.2]); // 9-max SNG
  assert.deepEqual(payoutsFor(15), [0.5, 0.3, 0.2]); // small MTT tier
  assert.equal(payoutsFor(30).length, 5); // 19-45 tier pays 5
  assert.equal(payoutsFor(80).length, 10); // 46-100 tier pays 10
  assert.equal(payoutsFor(200).length, 27); // 101-300 tier pays 27
  assert.equal(payoutsFor(800).length, 63); // 301-1000 tier pays 63
  assert.equal(payoutsFor(5000).length, 63); // beyond 1000 falls back to the biggest ladder
});

test('payoutsFor: explicit preset id, trimming, and errors', () => {
  // 50/30/20 forced onto a 2-player field trims to 2 places and renormalizes.
  const trimmed = payoutsFor(2, 'sng-9max');
  assert.equal(trimmed.length, 2);
  assert.ok(Math.abs(trimmed[0] - 0.625) < 1e-9);
  assert.ok(Math.abs(trimmed[0] + trimmed[1] - 1) < 1e-9);
  assert.throws(() => payoutsFor(9, 'no-such-preset'));
  assert.throws(() => payoutsFor(1));
});

// ---------- bubble factor ----------

test('bubbleFactor > 1 on a classic bubble with near-equal stacks', () => {
  // 4 players, 3 paid: losing an all-in busts on the stone bubble.
  const payouts = [0.5, 0.3, 0.2];
  const bf = bubbleFactor([2500, 2500, 2500, 2500], payouts, 0, 1);
  assert.ok(bf > 1, `expected bubble factor > 1, got ${bf}`);
  // With these classic numbers it is substantially above 1.
  assert.ok(bf > 1.5, `expected a strong bubble factor, got ${bf}`);
});

test('bubbleFactor rises when the hero covers less (villain covers hero)', () => {
  const payouts = [0.5, 0.3, 0.2];
  // Hero covers villain: losing still leaves hero with chips.
  const bfCovering = bubbleFactor([3500, 1500, 2500, 2500], payouts, 0, 1);
  // Villain covers hero: losing busts the hero on the bubble.
  const bfCovered = bubbleFactor([1500, 3500, 2500, 2500], payouts, 0, 1);
  assert.ok(bfCovering > 1, `covering spot should still be > 1, got ${bfCovering}`);
  assert.ok(
    bfCovered > bfCovering,
    `covered hero should face a bigger bubble factor: ${bfCovered} vs ${bfCovering}`,
  );
});

test('bubbleFactor is exactly 1 for winner-take-all heads-up (pure chip EV)', () => {
  const bf = bubbleFactor([3000, 3000], [1], 0, 1);
  assert.ok(Math.abs(bf - 1) < 1e-9, `winner-take-all should be chip-EV neutral, got ${bf}`);
});

// ---------- ICM shove EV ----------

test('icmShoveEv: AA shove from the SB heads-up for the tournament is +ICM-EV', () => {
  // Heads-up for the last two payouts of a 6-max SNG (65/35), equal stacks.
  const r = icmShoveEv({
    stacks: [3000, 3000],
    payouts: [0.65, 0.35],
    heroIdx: 0,
    heroHand: 'AA',
    callerRanges: [{ idx: 1, range: '22+, A2s+, A2o+, K2s+, K2o+' }],
    sb: 50,
    bb: 100,
    seed: 7,
  });
  // Equal stacks HU: folding keeps exactly the average of the two payouts.
  assert.ok(Math.abs(r.evFoldICM - 0.5) < 1e-9);
  assert.ok(r.deltaICM > 0, `AA shove should gain ICM EV, delta ${r.deltaICM}`);
  assert.equal(r.shoveOk, true);
  assert.ok(Math.abs(r.deltaICM - (r.evShoveICM - r.evFoldICM)) < 1e-12);
});

test('icmShoveEv: 72o shove into a tight range on a stone bubble is -ICM-EV', () => {
  // 4 left, 3 paid with big jumps; hero is a 40bb mid-stack, the caller
  // covers, and an 8bb short stack is about to bust — busting before him
  // throws away near-locked money.
  const r = icmShoveEv({
    stacks: [4000, 8000, 7200, 800],
    payouts: [0.5, 0.3, 0.2],
    heroIdx: 0,
    heroHand: '72o',
    callerRanges: [{ idx: 1, range: '88+, AJs+, AQo+' }],
    sb: 50,
    bb: 100,
    seed: 7,
  });
  assert.ok(r.deltaICM < 0, `72o bubble shove should lose ICM EV, delta ${r.deltaICM}`);
  assert.equal(r.shoveOk, false);
  // Folding preserves the hero's current ICM equity under this model.
  assert.ok(r.evFoldICM > 0.2 && r.evFoldICM < 0.35);
});

test('icmShoveEv: accepts exact hero cards and multiple callers behind', () => {
  const r = icmShoveEv({
    stacks: [1500, 2500, 2500, 3500],
    payouts: [0.5, 0.3, 0.2],
    heroIdx: 0,
    heroHand: 'AsKs',
    callerRanges: [
      { idx: 1, range: '77+, ATs+, AJo+' },
      { idx: 2, range: '99+, AQs+, AKo' },
    ],
    sb: 100,
    bb: 200,
    ante: 25,
    seed: 11,
    iterations: 3000,
  });
  assert.ok(Number.isFinite(r.evShoveICM) && Number.isFinite(r.evFoldICM));
  assert.ok(r.evShoveICM > 0 && r.evShoveICM < 1);
  assert.equal(r.shoveOk, r.deltaICM > 0);
});

// ---------- 몬스터 게임 (파이널 나인) ----------

test('MONSTER_GAME constants match the real 파이널 나인 structure', () => {
  assert.equal(MONSTER_GAME.buyIn, 30000);
  assert.equal(MONSTER_GAME.rebuyFee, 30000);
  assert.equal(MONSTER_GAME.startStack, 2_500_000);
  assert.equal(MONSTER_GAME.rebuyStack, 3_000_000);
  assert.equal(MONSTER_GAME.lateRegLevel, 10);
});

test('monsterPaidCount: floor(entries/7), at least 1', () => {
  assert.equal(monsterPaidCount(21), 3);
  assert.equal(monsterPaidCount(28), 4);
  assert.equal(monsterPaidCount(35), 5);
  assert.equal(monsterPaidCount(20), 2);
  assert.equal(monsterPaidCount(14), 2);
  assert.equal(monsterPaidCount(7), 1);
  assert.equal(monsterPaidCount(6), 1); // floor(6/7)=0 → max(1, 0) = 1
});

test('monsterPrizePool: (entries)*buyIn + rebuys*rebuyFee', () => {
  // 21 엔트리 + 15 리바이, 기본 3만 바이인/리바이.
  assert.equal(monsterPrizePool(21, 15), 1_080_000);
  assert.equal(monsterPrizePool(28, 0), 28 * 30000);
  // 바이인/리바이 요금 재정의.
  assert.equal(monsterPrizePool(10, 5, 50000, 40000), 10 * 50000 + 5 * 40000);
});

test('monsterPayouts: length n, sums to exactly 1, strictly descending head', () => {
  for (let n = 1; n <= 24; n++) {
    const p = monsterPayouts(n);
    assert.equal(p.length, n, `length for ${n}`);
    const sum = p.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `sum for ${n} = ${sum}`);
    for (let i = 0; i < p.length; i++) {
      assert.ok(p[i] > 0, `place ${i} (n=${n}) must be positive`);
      if (i > 0) {
        assert.ok(p[i] <= p[i - 1], `payouts must be descending at ${i} (n=${n})`);
      }
    }
  }
});

test('monsterPayouts: matches the standard monster anchors for 1..6', () => {
  assert.deepEqual(monsterPayouts(1), [1]);
  const approx = (a: number[], b: number[]) => {
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-9, `${a[i]} vs ${b[i]}`);
  };
  approx(monsterPayouts(2), [0.65, 0.35]);
  approx(monsterPayouts(3), [0.5, 0.3, 0.2]);
  approx(monsterPayouts(4), [0.45, 0.27, 0.18, 0.1]);
  approx(monsterPayouts(5), [0.4, 0.25, 0.17, 0.11, 0.07]);
  approx(monsterPayouts(6), [0.38, 0.23, 0.16, 0.11, 0.07, 0.05]);
});
