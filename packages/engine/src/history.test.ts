import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHandHistory } from './history.js';

const SAMPLE = `PokerStars Hand #210000000001: Hold'em No Limit ($0.25/$0.50 USD)
Seat 1: Hero ($50.00 in chips)
Seat 2: Villain ($62.50 in chips)
*** HOLE CARDS ***
Dealt to Hero [As Kh]
Hero: raises 1.5 to 2
Villain: calls 2
*** FLOP *** [Ah 7d 2c]
Hero: bets 3
Villain: calls 3
*** TURN *** [Ah 7d 2c] [Ts]
Hero: bets 8
Villain: calls 8
*** RIVER *** [Ah 7d 2c Ts] [9h]
Hero: checks
Villain: bets 20
Hero: calls 20
*** SHOW DOWN ***`;

test('parses hero cards, board, players, actions', () => {
  const h = parseHandHistory(SAMPLE);
  assert.equal(h.heroName, 'Hero');
  assert.equal(h.heroCards, 'AsKh');
  assert.equal(h.board, 'Ah7d2cTs9h');
  assert.equal(h.players.length, 2);
  assert.equal(h.stakes, '$0.25/$0.50 USD');
  // Has actions across multiple streets.
  assert.ok(h.actions.some((a) => a.street === 'river' && a.action === 'calls'));
  assert.ok(h.actions.some((a) => a.street === 'flop' && a.action === 'bets'));
  assert.equal(h.warnings.length, 0);
});

test('tolerates missing sections with warnings', () => {
  const h = parseHandHistory('some random text without a hand');
  assert.ok(h.warnings.length > 0);
  assert.equal(h.board, '');
});
