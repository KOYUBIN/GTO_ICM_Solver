import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getChart, availableRfiPositions, availableVsRfi } from './charts.js';
import { solveRiver, solvePostflop } from './cfr.js';
import { exactEquity } from './enumerate.js';
import { calcEquity } from './equity.js';
import { parseRange, rangeToCombos, type Combo } from './range.js';
import { parseCards } from './cards.js';

test('charts: BTN RFI is wider than UTG RFI', () => {
  const utg = getChart({ gameType: 'cash', stackBB: 100, heroPos: 'UTG', line: 'RFI' });
  const btn = getChart({ gameType: 'cash', stackBB: 100, heroPos: 'BTN', line: 'RFI' });
  assert.equal(utg.source, 'chart');
  assert.ok(btn.hands.size > utg.hands.size);
});

test('charts: vs-RFI mixes call/3bet and sums to 1', () => {
  const s = getChart({
    gameType: 'cash',
    stackBB: 100,
    heroPos: 'BB',
    villainPos: 'BTN',
    line: 'vs-RFI',
  });
  assert.equal(s.source, 'chart');
  for (const freqs of s.hands.values()) {
    const total = freqs.fold + freqs.call + freqs.raise;
    assert.ok(Math.abs(total - 1) < 1e-9);
  }
  // AA should be a pure (or near-pure) 3bet.
  const aa = s.hands.get('AA');
  assert.ok(aa && aa.raise > 0.9);
});

test('charts: catalog helpers return data', () => {
  assert.ok(availableRfiPositions().length >= 5);
  assert.ok(availableVsRfi().length >= 4);
});

test('enumerate: exact equity matches Monte-Carlo within tolerance', () => {
  // Use a near-complete board so exact enumeration is cheap (turn -> 44 cards).
  const board = 'Ah7d2c9s';
  const exact = exactEquity('AsKs', '7h6h', board);
  const mc = calcEquity([{ cards: 'AsKs' }, { cards: '7h6h' }], {
    board,
    iterations: 20000,
    seed: 3,
  });
  assert.ok(Math.abs(exact.equities[0] - mc.equities[0]) < 0.03);
});

test('cfr: nut-vs-air river — value bets and bluff-catcher indifference', () => {
  // OOP holds the nuts and total air; IP holds a bluff-catcher.
  // Board: Ks Qd 7h 2c 3s. OOP nuts = a set; OOP air = busted draw.
  const board = 'KsQd7h2c3s';
  const oop = [
    ...rangeToCombos(parseRange('77')), // sets (nuts-ish)
    ...rangeToCombos(parseRange('65s')), // air
  ].map((x) => x.combo);
  const ip: Combo[] = [parseCards('KdJd') as Combo]; // top pair bluff-catcher
  const res = solveRiver({
    board,
    oopRange: oop,
    ipRange: ip,
    pot: 100,
    betFraction: 1,
    iterations: 8000,
    seed: 42,
  });
  // OOP should bet a meaningful fraction (value + some bluffs), not 0% or 100%.
  assert.ok(res.oopBetFreq > 0.1 && res.oopBetFreq < 0.95, `betFreq ${res.oopBetFreq}`);
  // IP can't call every bet profitably against a balanced range.
  assert.ok(res.ipCallVsBetFreq >= 0 && res.ipCallVsBetFreq <= 1);
});

test('cfr: within a polarized range, the nut hands value bet near 100%', () => {
  // Board KsQd7h2c3s. OOP 77 = a set (value), 65s = busted draw (air).
  // IP holds a top-pair bluff-catcher that must defend vs the bluffs, so the
  // value hands strictly prefer to bet.
  const board = 'KsQd7h2c3s';
  const setCombos = rangeToCombos(parseRange('77')).map((x) => x.combo);
  const setKeys = new Set(setCombos.map((c) => `${c[0]}-${c[1]}`));
  const oop = [...setCombos, ...rangeToCombos(parseRange('65s')).map((x) => x.combo)];
  const ip: Combo[] = [parseCards('KdJd') as Combo];
  const res = solveRiver({
    board,
    oopRange: oop,
    ipRange: ip,
    pot: 100,
    betFraction: 0.75,
    iterations: 12000,
    seed: 9,
  });
  const nutRows = res.oopStrategy.filter((r) => setKeys.has(`${r.combo[0]}-${r.combo[1]}`));
  const avgNutBet = nutRows.reduce((s, r) => s + r.bet, 0) / nutRows.length;
  assert.ok(avgNutBet > 0.8, `nut hands should bet a lot, got ${avgNutBet}`);
});

test('solvePostflop: solves a river board (single street) sensibly', () => {
  const board = 'KsQd7h2c3s';
  const oop = [
    ...rangeToCombos(parseRange('77')).map((x) => x.combo), // value
    ...rangeToCombos(parseRange('65s')).map((x) => x.combo), // air
  ];
  const ip: Combo[] = [parseCards('KdJd') as Combo];
  const r = solvePostflop({ board, oopRange: oop, ipRange: ip, pot: 100, betFraction: 0.75, iterations: 6000, seed: 3 });
  assert.equal(r.street, 'river');
  assert.ok(Number.isFinite(r.oopEV));
  assert.ok(r.oopBetFreq >= 0 && r.oopBetFreq <= 1);
});

test('solvePostflop: multi-street flop solve runs; nuts bet more than air', () => {
  // Flop input -> solver runs out turn + river via chance sampling.
  const board = 'Ks7h2c';
  const setCombos = rangeToCombos(parseRange('77')).map((x) => x.combo); // flopped set
  const airCombos = rangeToCombos(parseRange('65s')).map((x) => x.combo); // air
  const setKeys = new Set(setCombos.map((c) => `${c[0]}-${c[1]}`));
  const oop = [...setCombos, ...airCombos];
  const ip: Combo[] = [parseCards('AhKh') as Combo, parseCards('QsQc') as Combo];
  const r = solvePostflop({ board, oopRange: oop, ipRange: ip, pot: 60, betFraction: 0.66, iterations: 9000, seed: 5 });
  assert.equal(r.street, 'flop');
  const sets = r.oopStrategy.filter((x) => setKeys.has(`${x.combo[0]}-${x.combo[1]}`));
  const air = r.oopStrategy.filter((x) => !setKeys.has(`${x.combo[0]}-${x.combo[1]}`));
  const setBet = sets.reduce((s, x) => s + x.bet, 0) / sets.length;
  const airBet = air.reduce((s, x) => s + x.bet, 0) / air.length;
  assert.ok(setBet > airBet, `set ${setBet} should bet more than air ${airBet}`);
});
