import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCards, parseCard } from './cards.js';
import { describeHand, bestFive } from './handstrength.js';

function sameCards(actual: number[], expected: number[]): void {
  assert.deepEqual([...actual].sort((a, b) => a - b), [...expected].sort((a, b) => a - b));
}

// ---------- describeHand ----------

test('royal flush is detected and named', () => {
  const { rankKo, detailKo } = describeHand(parseCards('AsKs'), parseCards('QsJsTs2d3h'));
  assert.equal(rankKo, '로열 플러시');
  assert.equal(detailKo, '로열 플러시');
});

test('straight flush (non-royal) keeps its own name', () => {
  const { rankKo, detailKo } = describeHand(parseCards('9s8s'), parseCards('7s6s5sAdAh'));
  assert.equal(rankKo, '스트레이트 플러시');
  assert.equal(detailKo, '스트레이트 플러시 9 하이');
});

test('full house naming: trips over pair', () => {
  const { rankKo, detailKo } = describeHand(parseCards('AhAd'), parseCards('KcKdKh'));
  assert.equal(rankKo, '풀 하우스');
  assert.equal(detailKo, '풀 하우스 KKK-AA');
});

test('two pair detail shows both pairs, high first', () => {
  const { rankKo, detailKo } = describeHand(parseCards('AhKd'), parseCards('AsKc2d7h9s'));
  assert.equal(rankKo, '투 페어');
  assert.equal(detailKo, '투 페어 AA-KK');
});

test('preflop pocket pair text', () => {
  const { rankKo, detailKo } = describeHand(parseCards('QsQd'), []);
  assert.equal(rankKo, '포켓 페어');
  assert.equal(detailKo, '포켓 페어 QQ');
});

test('preflop unpaired text, high card first', () => {
  const { rankKo, detailKo } = describeHand(parseCards('KhAs'), []);
  assert.equal(rankKo, '하이카드');
  assert.equal(detailKo, '하이카드 A-K');
});

test('flush draw hint appears on a 4-card board', () => {
  const { rankKo, detailKo } = describeHand(parseCards('Ah5h'), parseCards('Kh2h9cJd'));
  assert.equal(rankKo, '하이카드');
  assert.ok(detailKo.includes('플러시 드로우'), detailKo);
});

test('open-ended straight draw hint on the flop', () => {
  const { detailKo } = describeHand(parseCards('9h8d'), parseCards('7c6s2d'));
  assert.ok(detailKo.includes('양방 스트레이트 드로우'), detailKo);
});

test('no draw hints on a complete 5-card board', () => {
  // Four hearts, but the river is out — no cards to come, so no draw hint.
  const { detailKo } = describeHand(parseCards('Ah5h'), parseCards('Kh2h9cJd7s'));
  assert.ok(!detailKo.includes('드로우'), detailKo);
});

test('made flush is named, not called a draw', () => {
  const { rankKo, detailKo } = describeHand(parseCards('Ah5h'), parseCards('Kh2h9h4c'));
  assert.equal(rankKo, '플러시');
  assert.equal(detailKo, '플러시 A 하이');
});

// ---------- bestFive ----------

test('bestFive picks board quads plus the best kicker', () => {
  const five = bestFive(parseCards('Ah2d'), parseCards('KcKdKhKs3c'));
  sameCards(five, parseCards('KcKdKhKsAh'));
});

test('bestFive picks the exact royal flush cards', () => {
  const five = bestFive(parseCards('AsKs'), parseCards('QsJsTs2d3h'));
  sameCards(five, parseCards('AsKsQsJsTs'));
});

test('bestFive drops both hole cards when the board plays', () => {
  // Board is a broadway straight; hole cards cannot improve it.
  const five = bestFive(parseCards('2c3d'), parseCards('AhKdQcJsTh'));
  sameCards(five, parseCards('AhKdQcJsTh'));
});

test('bestFive output is sorted by descending rank', () => {
  const five = bestFive(parseCards('Ah2d'), parseCards('KcKdKhKs3c'));
  assert.equal(five[0], parseCard('Ah'));
  for (let i = 1; i < five.length; i++) {
    assert.ok(five[i - 1] % 13 >= five[i] % 13);
  }
});

test('bestFive returns [] preflop (fewer than five cards)', () => {
  assert.deepEqual(bestFive(parseCards('AsKs'), []), []);
  assert.deepEqual(bestFive(parseCards('AsKs'), parseCards('QdJh')), []);
});
