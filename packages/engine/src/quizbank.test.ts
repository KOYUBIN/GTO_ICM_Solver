import { test } from 'node:test';
import assert from 'node:assert/strict';

import quizBank from './generated/quiz-bank.json' with { type: 'json' };
import {
  getQuizBank,
  quizBankCounts,
  sampleChipEvQuizzes,
  sampleIcmQuizzes,
} from './quizbank.js';

test('quiz-bank.json exists, parses and carries both quiz sets', () => {
  assert.ok(quizBank.meta, 'meta block present');
  assert.equal(typeof quizBank.meta.generatedAt, 'string');
  assert.ok(Array.isArray(quizBank.chipEv), 'chipEv array present');
  assert.ok(Array.isArray(quizBank.icm), 'icm array present');

  const bank = getQuizBank();
  assert.equal(bank.meta.chipEvCount, bank.chipEv.length, 'meta.chipEvCount matches array');
  assert.equal(bank.meta.icmCount, bank.icm.length, 'meta.icmCount matches array');
});

test('quiz bank has enough chip-EV and ICM items', () => {
  const counts = quizBankCounts();
  assert.ok(counts.chipEv >= 600, `expected >= 600 chip-EV quizzes, got ${counts.chipEv}`);
  assert.ok(counts.icm >= 300, `expected >= 300 ICM quizzes, got ${counts.icm}`);
});

test('every chip-EV item: best is in actions and gtoMix sums to ~1', () => {
  const bank = getQuizBank();
  for (const q of bank.chipEv) {
    assert.ok(q.actions.includes(q.best), `${q.id}: best "${q.best}" not in actions ${q.actions}`);
    const sum = (q.gtoMix.raise ?? 0) + (q.gtoMix.call ?? 0) + (q.gtoMix.fold ?? 0);
    assert.ok(Math.abs(sum - 1) <= 0.02, `${q.id}: gtoMix sums to ${sum}, expected ~1`);
    // best must be the argmax of the mix.
    const mixOfBest = q.gtoMix[q.best] ?? 0;
    const maxMix = Math.max(q.gtoMix.raise ?? 0, q.gtoMix.call ?? 0, q.gtoMix.fold ?? 0);
    assert.equal(mixOfBest, maxMix, `${q.id}: best is not the argmax of gtoMix`);
  }
});

test('every ICM item: decision matches sign(deltaIcm) (shove iff deltaIcm > 0)', () => {
  const bank = getQuizBank();
  const eps = 1e-6; // deltaIcm is stored rounded to 6 decimals
  for (const q of bank.icm) {
    assert.ok(q.decision === 'shove' || q.decision === 'fold', `${q.id}: bad decision`);
    if (q.deltaIcm > eps) {
      assert.equal(q.decision, 'shove', `${q.id}: deltaIcm ${q.deltaIcm} > 0 but decision is fold`);
    } else if (q.deltaIcm < -eps) {
      assert.equal(q.decision, 'fold', `${q.id}: deltaIcm ${q.deltaIcm} < 0 but decision is shove`);
    }
    // deltaIcm == evIcmShove - evIcmFold (within rounding).
    assert.ok(
      Math.abs(q.deltaIcm - (q.evIcmShove - q.evIcmFold)) <= 1e-5,
      `${q.id}: deltaIcm inconsistent with evIcmShove - evIcmFold`,
    );
  }
});

test('the ICM bank contains a chip-EV-vs-ICM conflict spot', () => {
  const bank = getQuizBank();
  // At least one item where the chip-EV shove is +EV (chip-EV says shove) but
  // ICM pressure makes folding the +ICM action.
  const conflict = bank.icm.find(
    (q) => typeof q.evChipShoveBB === 'number' && q.evChipShoveBB > 0 && q.decision === 'fold',
  );
  assert.ok(
    conflict,
    'expected at least one item where chip-EV shove (+EV) disagrees with the ICM fold decision',
  );
});

test('samplers respect n, filters, and never exceed the pool', () => {
  const counts = quizBankCounts();

  const chip = sampleChipEvQuizzes(10);
  assert.equal(chip.length, 10);

  const rfiOnly = sampleChipEvQuizzes(5, (q) => q.line === 'RFI');
  assert.equal(rfiOnly.length, 5);
  for (const q of rfiOnly) assert.equal(q.line, 'RFI');

  // Requesting more than available returns the whole (filtered) pool, no dupes.
  const allChip = sampleChipEvQuizzes(counts.chipEv + 100);
  assert.equal(allChip.length, counts.chipEv);
  assert.equal(new Set(allChip.map((q) => q.id)).size, counts.chipEv, 'no duplicate chip-EV ids');

  const icm = sampleIcmQuizzes(20);
  assert.equal(icm.length, 20);
  assert.equal(new Set(icm.map((q) => q.id)).size, 20, 'sampled ICM ids are unique');

  const shoveOnly = sampleIcmQuizzes(8, (q) => q.decision === 'shove');
  for (const q of shoveOnly) assert.equal(q.decision, 'shove');

  // Deterministic: same call twice yields the same ids.
  assert.deepEqual(
    sampleChipEvQuizzes(12).map((q) => q.id),
    sampleChipEvQuizzes(12).map((q) => q.id),
  );

  assert.equal(sampleChipEvQuizzes(0).length, 0);
});
