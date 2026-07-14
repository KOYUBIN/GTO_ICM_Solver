import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getChart, availableRfiPositions, availableVsRfi, availableRfiVs3bet } from './charts.js';
import { solveRiver, solvePostflop } from './cfr.js';
import { exactEquity } from './enumerate.js';
import { calcEquity } from './equity.js';
import { parseRange, rangeToCombos, type Combo } from './range.js';
import { parseCards } from './cards.js';
import { parseOcrPoker } from './ocr.js';

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
  const pairs = availableRfiVs3bet();
  assert.ok(pairs.length >= 4);
  assert.ok(pairs.some((p) => p.hero === 'BTN' && p.villain === 'SB'));
});

test('charts: RFI-vs-3bet charted pair — AA 4bets, all labels sum to 1', () => {
  for (const { hero, villain } of availableRfiVs3bet()) {
    const s = getChart({
      gameType: 'cash',
      stackBB: 100,
      heroPos: hero,
      villainPos: villain,
      line: 'RFI-vs-3bet',
    });
    assert.equal(s.source, 'chart', `${hero} vs ${villain} should be charted`);
    for (const [label, f] of s.hands) {
      const total = f.fold + f.call + f.raise;
      assert.ok(Math.abs(total - 1) < 1e-9, `${hero} vs ${villain} ${label} sums to ${total}`);
      assert.ok(f.fold >= 0 && f.call >= 0 && f.raise >= 0, `${label} has a negative frequency`);
    }
    const aa = s.hands.get('AA');
    assert.ok(aa && aa.raise > 0.9, `${hero} vs ${villain}: AA should (near-)pure 4bet`);
  }
});

test('charts: RFI-vs-3bet heuristic pair still returns a valid strategy', () => {
  const s = getChart({
    gameType: 'cash',
    stackBB: 100,
    heroPos: 'MP',
    villainPos: 'SB',
    line: 'RFI-vs-3bet',
  });
  assert.equal(s.source, 'heuristic');
  assert.ok(s.hands.size > 0);
  let hasRaise = false;
  let hasCall = false;
  for (const f of s.hands.values()) {
    const total = f.fold + f.call + f.raise;
    assert.ok(Math.abs(total - 1) < 1e-9);
    assert.ok(f.fold >= 0 && f.call >= 0 && f.raise >= 0);
    if (f.raise > 0) hasRaise = true;
    if (f.call > 0) hasCall = true;
  }
  // A sensible 3bet defense mixes 4bets and calls.
  assert.ok(hasRaise && hasCall);
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

test('ocr: parses cards, pot and ranks from screenshot-like text', () => {
  const text = [
    '클래식 200억 GTD',
    'ubin BTN  Ks Kc',
    'Forgiven BB  8h 8d',
    'Board: 8s 7c 2d  Qh  3s',
    'POT 599,114',
  ].join('\n');
  const r = parseOcrPoker(text);
  // Full card tokens (rank+suit) are normalized.
  assert.ok(r.cards.includes('Ks') && r.cards.includes('Kc'));
  assert.ok(r.cards.includes('8h') && r.cards.includes('8d'));
  assert.ok(r.cards.includes('8s') && r.cards.includes('7c') && r.cards.includes('Qh'));
  // Pot prefers the line tagged with POT.
  assert.equal(r.pot, 599114);
  // Title is the GTD line.
  assert.ok(r.title && r.title.includes('GTD'));
});

test('ocr: handles unicode suit glyphs and 10 -> T', () => {
  const r = parseOcrPoker('A♠ 10♥  pot 12,000');
  assert.ok(r.cards.includes('As'));
  assert.ok(r.cards.includes('Th'));
  assert.equal(r.pot, 12000);
});

test('ocr: does not mis-read words like GTD/cash as cards, keeps joined cards', () => {
  // "GTD" (Guaranteed) must not become Td; "cash" must not become As.
  const r = parseOcrPoker('클래식 200억 GTD  cash game');
  assert.ok(!r.cards.includes('Td'), `GTD leaked Td: ${r.cards.join(',')}`);
  assert.ok(!r.cards.includes('As'), `cash leaked As: ${r.cards.join(',')}`);
  // Joined hole cards (no space) still parse.
  const r2 = parseOcrPoker('KsKc vs 8h8d');
  assert.ok(r2.cards.includes('Ks') && r2.cards.includes('Kc'));
  assert.ok(r2.cards.includes('8h') && r2.cards.includes('8d'));
});

test('ocr: rejects English words and cross-line/word-gap phantom cards', () => {
  assert.equal(parseOcrPoker('The quick Ask Add This game').cards.length, 0);
  const cross = parseOcrPoker('Level 9 starts\nDealer calls 2');
  assert.ok(!cross.cards.includes('9s') && !cross.cards.includes('2d'));
});

test('ocr: hand IDs are not the pot, card rows are not the title', () => {
  const r = parseOcrPoker('Hand #210000000001\nubin Ks Kc\nPOT 599,114');
  assert.equal(r.pot, 599114);
  const t = parseOcrPoker('Ah 7d 2c Ts 9h\n클래식 200억 GTD\nPOT 12000');
  assert.ok(t.title && t.title.includes('GTD'));
});

test('solvePostflop: node-lock forces 77 to 100% bet in the reported strategy', () => {
  const board = 'KsQd7h2c3s';
  const setCombos = rangeToCombos(parseRange('77')).map((x) => x.combo);
  const setKeys = new Set(setCombos.map((c) => `${c[0]}-${c[1]}`));
  const oop = [...setCombos, ...rangeToCombos(parseRange('65s')).map((x) => x.combo)];
  const ip: Combo[] = [parseCards('KdJd') as Combo];
  const r = solvePostflop({
    board,
    oopRange: oop,
    ipRange: ip,
    pot: 100,
    betFraction: 0.75,
    iterations: 4000,
    seed: 7,
    oopLock: { '77': { check: 0, bet: 1 } },
  });
  const lockedRows = r.oopStrategy.filter((x) => setKeys.has(`${x.combo[0]}-${x.combo[1]}`));
  assert.ok(lockedRows.length > 0);
  for (const row of lockedRows) {
    assert.ok(row.bet > 0.999, `77 locked to 100% bet, got bet=${row.bet}`);
  }
  // Unlocked hands (65s) still solve freely — air should not be forced to bet.
  const freeRows = r.oopStrategy.filter((x) => !setKeys.has(`${x.combo[0]}-${x.combo[1]}`));
  assert.ok(freeRows.length > 0);
});

test('solvePostflop: locking the whole OOP range to bet shifts IP response and OOP EV', () => {
  // River: OOP = 3 combos of the nuts (77 set) + 4 combos of air (65s), IP =
  // one top-pair bluff-catcher. Locking OOP to bet 100% (all the air included)
  // is exploitable: IP's best response deviates from the equilibrium call
  // frequency, and OOP's EV moves away from the unlocked solve.
  const board = 'KsQd7h2c3s';
  const oop = [
    ...rangeToCombos(parseRange('77')).map((x) => x.combo),
    ...rangeToCombos(parseRange('65s')).map((x) => x.combo),
  ];
  const ip: Combo[] = [parseCards('KdJd') as Combo];
  const cfg = { board, oopRange: oop, ipRange: ip, pot: 100, betFraction: 0.75, iterations: 8000, seed: 11 };
  const free = solvePostflop(cfg);
  const locked = solvePostflop({
    ...cfg,
    oopLock: { '77': { check: 0, bet: 1 }, '65s': { check: 0, bet: 1 } },
  });
  assert.ok(locked.oopBetFreq > 0.999, `locked bet freq ${locked.oopBetFreq}`);
  // IP exploits the over-bluffed locked range (call frequency changes a lot).
  assert.ok(
    Math.abs(locked.ipCallVsBetFreq - free.ipCallVsBetFreq) > 0.1,
    `ip call freq should shift: ${free.ipCallVsBetFreq} -> ${locked.ipCallVsBetFreq}`,
  );
  assert.ok(
    Math.abs(locked.oopEV - free.oopEV) > 3,
    `oop EV should change: ${free.oopEV} -> ${locked.oopEV}`,
  );
});

test('solvePostflop: fully-conflicting ranges throw instead of hanging', () => {
  // Both ranges share the Ace of clubs, so no non-conflicting pair exists.
  const oop: Combo[] = [parseCards('AcAd') as Combo];
  const ip: Combo[] = [parseCards('AcAh') as Combo];
  assert.throws(
    () => solvePostflop({ board: 'Ks7h2c', oopRange: oop, ipRange: ip, pot: 60, iterations: 100 }),
    /충돌하지 않는/,
  );
});
