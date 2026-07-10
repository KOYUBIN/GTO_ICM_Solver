import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame,
  startHand,
  legalActions,
  applyAction,
  buildPots,
  forfeit,
  redactFor,
  type TableState,
  type Seat,
} from './holdem.js';
import { BLIND_PRESETS, PRESET_LIST, buildCustomPreset, levelAt } from './blinds.js';

function game(stacks: number[], sb = 10, bb = 20, ante = 0, seed = 42): TableState {
  return createGame({
    players: stacks.map((s, i) => ({ id: `p${i}`, name: `P${i}`, stack: s })),
    smallBlind: sb,
    bigBlind: bb,
    ante,
    seed,
  });
}

function seatOf(s: TableState, id: string): Seat {
  return s.seats.find((x) => x.id === id)!;
}

// ---------- blinds & antes ----------

test('startHand posts blinds and deals two cards each', () => {
  let s = game([1000, 1000, 1000]);
  s = startHand(s);
  // Button at 0 (3-handed): SB = p1, BB = p2, first to act = p0 (UTG/button).
  assert.equal(s.smallBlind, 10);
  assert.equal(s.bigBlind, 20);
  assert.equal(seatOf(s, 'p1').committedThisStreet, 10);
  assert.equal(seatOf(s, 'p2').committedThisStreet, 20);
  assert.equal(s.currentBet, 20);
  for (const seat of s.seats) assert.equal(seat.holeCards.length, 2);
  // Pot holds the two blinds.
  assert.equal(s.pots[0].amount, 30);
  // First to act is the button (p0) 3-handed.
  assert.equal(s.seats[s.toAct].id, 'p0');
});

test('antes are posted by all dealt-in players', () => {
  let s = game([1000, 1000, 1000], 10, 20, 5);
  s = startHand(s);
  // 3 antes (15) + SB 10 + BB 20 = 45.
  assert.equal(s.pots[0].amount, 45);
});

test('heads-up: button posts small blind and acts first', () => {
  let s = game([1000, 1000]);
  s = startHand(s);
  // Heads-up button (p0) is SB and acts first preflop.
  assert.equal(seatOf(s, 'p0').committedThisStreet, 10); // button = SB
  assert.equal(seatOf(s, 'p1').committedThisStreet, 20); // other = BB
  assert.equal(s.seats[s.toAct].id, 'p0');
});

// ---------- fold-around ----------

test('fold-around: last player standing wins the pot uncontested', () => {
  let s = game([1000, 1000, 1000]);
  s = startHand(s);
  // p0 (button) folds, p1 (SB) folds -> p2 (BB) wins blinds.
  s = applyAction(s, 'p0', { type: 'fold' });
  s = applyAction(s, 'p1', { type: 'fold' });
  assert.equal(s.currentStreet, 'showdown');
  assert.equal(s.winners.length, 1);
  assert.equal(s.winners[0].seatId, 'p2');
  assert.equal(s.winners[0].hand, 'uncontested');
  // p2 started with 1000, posted 20 BB, wins the 30 pot -> 1010 net.
  assert.equal(seatOf(s, 'p2').stack, 1010);
  assert.equal(s.handInProgress, false);
});

// ---------- legal actions ----------

test('legalActions: BB can check when action limps around to it', () => {
  let s = game([1000, 1000, 1000]);
  s = startHand(s);
  s = applyAction(s, 'p0', { type: 'call' }); // button calls 20
  s = applyAction(s, 'p1', { type: 'call' }); // SB completes to 20
  // Now BB (p2) is to act with the option.
  assert.equal(s.seats[s.toAct].id, 'p2');
  const la = legalActions(s);
  assert.ok(la.actions.includes('check'));
  assert.ok(la.actions.includes('raise'));
  assert.equal(la.callAmount, 0);
});

test('min-raise: raise must be at least one big blind over the current bet', () => {
  let s = game([1000, 1000, 1000]);
  s = startHand(s);
  const la = legalActions(s); // p0 to act, facing BB of 20
  assert.equal(la.minRaiseTo, 40); // 20 + 20 min increment
  assert.throws(() => applyAction(s, 'p0', { type: 'raise', amount: 30 }));
  const ok = applyAction(s, 'p0', { type: 'raise', amount: 40 });
  assert.equal(seatOf(ok, 'p0').committedThisStreet, 40);
  assert.equal(ok.currentBet, 40);
});

// ---------- full hand to showdown ----------

test('full hand to showdown deals a 5-card board and pays a winner', () => {
  let s = game([1000, 1000], 10, 20, 0, 12345);
  s = startHand(s);
  // Heads-up: button/SB p0 acts first. Limp-check the hand to showdown.
  s = applyAction(s, 'p0', { type: 'call' }); // SB completes
  s = applyAction(s, 'p1', { type: 'check' }); // BB checks -> flop
  assert.equal(s.currentStreet, 'flop');
  assert.equal(s.board.length, 3);

  // Postflop heads-up: BB (p1) acts first.
  s = applyAction(s, 'p1', { type: 'check' });
  s = applyAction(s, 'p0', { type: 'check' });
  assert.equal(s.currentStreet, 'turn');
  assert.equal(s.board.length, 4);

  s = applyAction(s, 'p1', { type: 'check' });
  s = applyAction(s, 'p0', { type: 'check' });
  assert.equal(s.currentStreet, 'river');
  assert.equal(s.board.length, 5);

  s = applyAction(s, 'p1', { type: 'check' });
  s = applyAction(s, 'p0', { type: 'check' });
  assert.equal(s.currentStreet, 'showdown');
  assert.ok(s.winners.length >= 1);
  // No chips created or destroyed: total stacks conserved.
  const total = s.seats.reduce((a, x) => a + x.stack, 0);
  assert.equal(total, 2000);
});

// ---------- side pots ----------

test('buildPots: short all-in creates a main and side pot', () => {
  // p0 all-in for 100, p1 and p2 each in for 300.
  const seats: Seat[] = [
    mkSeat('p0', 0, 'allin', 100),
    mkSeat('p1', 700, 'active', 300),
    mkSeat('p2', 700, 'active', 300),
  ];
  const pots = buildPots(seats);
  // Main pot: 100 * 3 = 300, eligible everyone.
  assert.equal(pots[0].amount, 300);
  assert.deepEqual(pots[0].eligible.sort(), ['p0', 'p1', 'p2']);
  // Side pot: 200 * 2 = 400, only p1/p2.
  assert.equal(pots[1].amount, 400);
  assert.deepEqual(pots[1].eligible.sort(), ['p1', 'p2']);
});

test('buildPots: folded all-in-for-less leaves dead money but no eligibility', () => {
  const seats: Seat[] = [
    mkSeat('p0', 0, 'folded', 50), // folded after putting in 50
    mkSeat('p1', 500, 'active', 200),
    mkSeat('p2', 500, 'active', 200),
  ];
  const pots = buildPots(seats);
  const total = pots.reduce((a, p) => a + p.amount, 0);
  assert.equal(total, 450); // 50 + 200 + 200
  // p0 is never eligible.
  for (const p of pots) assert.ok(!p.eligible.includes('p0'));
});

test('all-in side pot: short stack can only win the main pot', () => {
  // Three-handed, distinct stacks so a side pot forms when all-in.
  let s = game([100, 1000, 1000], 10, 20, 0, 777);
  s = startHand(s);
  // Drive everyone all-in. p0 (button) shoves 100, p1 (SB) calls, p2 (BB) calls.
  s = applyAction(s, 'p0', { type: 'allin' });
  s = applyAction(s, 'p1', { type: 'allin' });
  s = applyAction(s, 'p2', { type: 'call' });
  // Board runs out automatically; showdown reached.
  assert.equal(s.currentStreet, 'showdown');
  // Chips conserved.
  const total = s.seats.reduce((a, x) => a + x.stack, 0);
  assert.equal(total, 2100);
  // The short stack (p0) can never end with more than main-pot worth: it
  // contributed 100, so max it can win is 100*3 = 300.
  assert.ok(seatOf(s, 'p0').stack <= 300);
});

// ---------- blind presets ----------

test('all named presets exist with sane structure', () => {
  for (const id of ['hyper-turbo', 'turbo', 'classic', 'deepstack', 'cash'] as const) {
    const p = BLIND_PRESETS[id];
    assert.ok(p, `missing preset ${id}`);
    assert.ok(p.startingStack > 0);
    assert.ok(p.levels.length >= 1);
    assert.ok(p.name.length > 0);
  }
  assert.equal(PRESET_LIST.length, 5);
  assert.equal(BLIND_PRESETS.cash.isCash, true);
});

test('blind levels strictly increase for tournament presets', () => {
  for (const id of ['hyper-turbo', 'turbo', 'classic', 'deepstack'] as const) {
    const lv = BLIND_PRESETS[id].levels;
    for (let i = 1; i < lv.length; i++) {
      assert.ok(lv[i].bigBlind >= lv[i - 1].bigBlind, `${id} bb should not drop`);
      assert.ok(lv[i].bigBlind > lv[0].bigBlind, `${id} bb should grow`);
    }
  }
});

test('buildCustomPreset builds a single-level fixed structure', () => {
  const p = buildCustomPreset({
    startingStack: 5000,
    smallBlind: 25,
    bigBlind: 50,
    ante: 5,
    levelMinutes: 0,
  });
  assert.equal(p.startingStack, 5000);
  assert.equal(p.levels.length, 1);
  assert.equal(p.levels[0].bigBlind, 50);
  assert.equal(levelAt(p, 99).bigBlind, 50); // clamps past the end
});

// ---------- helpers ----------

function mkSeat(id: string, stack: number, status: Seat['status'], committedTotal: number): Seat {
  return {
    id,
    name: id.toUpperCase(),
    stack,
    status,
    holeCards: [],
    committedThisStreet: 0,
    committedTotal,
    hasActed: true,
  };
}

// ---------- regression: blind puts the first actor all-in ----------

test('heads-up: a blind that puts the button all-in does not stall the hand', () => {
  // Button/SB has only 1 chip and blinds are 10/20 -> SB posts all-in for 1.
  let s = game([1, 1000], 10, 20, 0, 7);
  s = startHand(s);
  const total = s.seats.reduce((a, x) => a + x.stack, 0) + s.pots.reduce((a, p) => a + p.amount, 0);
  // Either action is on someone who can act, or the hand already ran out.
  if (s.handInProgress) {
    const la = legalActions(s);
    assert.ok(la.actions.length > 0, 'the seat to act must have legal actions');
    assert.equal(s.seats[s.toAct].status, 'active');
  }
  // No chips created or destroyed.
  assert.equal(total, 1001);
});

test('blinds putting everyone all-in runs out to showdown with conserved chips', () => {
  // Both players are shorter than the blinds -> both all-in on the post.
  let s = game([3, 6], 10, 20, 0, 11);
  s = startHand(s);
  // Drive any remaining actions to completion.
  let guard = 0;
  while (s.handInProgress && guard++ < 50) {
    const la = legalActions(s);
    if (!la.actions.length) break;
    s = applyAction(s, s.seats[s.toAct].id, { type: la.actions.includes('check') ? 'check' : 'call' });
  }
  assert.equal(s.handInProgress, false);
  assert.equal(s.seats.reduce((a, x) => a + x.stack, 0), 9);
});

// ---------- forfeit / leave ----------

test('forfeit: the player to act folds and the turn advances', () => {
  let s = game([1000, 1000, 1000]);
  s = startHand(s); // 3-handed, first to act = button (p0)
  const actor = s.seats[s.toAct].id;
  const before = s.toAct;
  s = forfeit(s, actor);
  assert.equal(s.seats.find((x) => x.id === actor)!.status, 'folded');
  assert.ok(s.toAct !== before || !s.handInProgress);
});

test('forfeit: heads-up opponent leaving ends the hand uncontested', () => {
  let s = game([1000, 1000]);
  s = startHand(s);
  // The player NOT to act leaves -> only one live seat -> uncontested win.
  const notToAct = s.seats[(s.toAct + 1) % 2].id;
  s = forfeit(s, notToAct);
  assert.equal(s.handInProgress, false);
  // Chips conserved at the starting bankroll.
  assert.equal(s.seats.reduce((a, x) => a + x.stack, 0), 2000);
});

test('forfeit: outside a hand just sits the player out', () => {
  let s = game([1000, 1000]);
  s = forfeit(s, s.seats[0].id);
  assert.equal(s.seats[0].status, 'sittingOut');
});

// ---------- security & rules regressions ----------

test('redactFor never ships the deck or seed, and hides cards on fold-arounds', () => {
  let s = game([1000, 1000, 1000], 10, 20, 0, 7);
  s = startHand(s);
  // Mid-hand: deck and seed must be stripped for every viewer.
  let v = redactFor(s, 'p0');
  assert.equal(v.deck.length, 0);
  assert.equal(v.seed, 0);
  assert.ok(v.seats.find((x) => x.id === 'p1')!.holeCards.every((c) => c === -1));

  // Fold to one player -> uncontested "showdown": winner's cards stay hidden.
  s = applyAction(s, s.seats[s.toAct].id, { type: 'fold' });
  s = applyAction(s, s.seats[s.toAct].id, { type: 'fold' });
  assert.equal(s.handInProgress, false);
  assert.ok(s.winners.some((w) => w.hand === 'uncontested'));
  const winnerId = s.winners[0].seatId;
  v = redactFor(s, undefined);
  assert.ok(v.seats.find((x) => x.id === winnerId)!.holeCards.every((c) => c === -1));
  assert.equal(v.deck.length, 0);
  assert.equal(v.seed, 0);
});

test('showdown returns uncalled excess instead of destroying chips', () => {
  // 3-handed: p0 (button), p1 SB, p2 BB. p0 shoves 1000, p1 calls all-in for
  // 300, p2 folds -> p0's 700 excess must come back at showdown.
  let s = game([1000, 300, 1000], 10, 20, 0, 21);
  s = startHand(s);
  assert.equal(s.seats[s.toAct].id, 'p0');
  s = applyAction(s, 'p0', { type: 'allin' });
  assert.equal(s.seats[s.toAct].id, 'p1');
  s = applyAction(s, 'p1', { type: 'allin' }); // call-for-less (300)
  s = applyAction(s, 'p2', { type: 'fold' });
  assert.equal(s.handInProgress, false);
  // Total chips conserved: 1000 + 300 + 1000.
  assert.equal(s.seats.reduce((a, x) => a + x.stack, 0), 2300);
  // p0 got the uncalled 700 back regardless of who won the 620 pot.
  const p0 = seatOf(s, 'p0');
  assert.ok(p0.stack >= 700, `p0 stack ${p0.stack} should include the returned 700`);
});

test('a short all-in does not re-open action for a player who already acted', () => {
  // p0 opens to 60; p1 shoves 75 total (short raise: +15 < minRaise 20);
  // p2 folds; back on p0 -> p0 may call/fold but NOT re-raise.
  let s = game([1000, 75, 1000], 10, 20, 0, 33);
  s = startHand(s);
  s = applyAction(s, 'p0', { type: 'raise', amount: 60 });
  s = applyAction(s, 'p1', { type: 'allin' }); // 75 total, short of a full raise
  s = applyAction(s, 'p2', { type: 'fold' });
  assert.equal(s.seats[s.toAct].id, 'p0');
  const la = legalActions(s);
  assert.ok(la.actions.includes('call'));
  assert.ok(!la.actions.includes('raise'), `raise offered illegally: ${la.actions}`);
  assert.ok(!la.actions.includes('allin'), `aggressive allin offered illegally: ${la.actions}`);
  assert.throws(() => applyAction(s, 'p0', { type: 'raise', amount: 200 }), /재개/);
  assert.throws(() => applyAction(s, 'p0', { type: 'allin' }), /재개/);
  // Calling closes the round cleanly.
  s = applyAction(s, 'p0', { type: 'call' });
  assert.equal(s.handInProgress, false); // heads-up all-in runs out
});

test('antes keep the preflop call at a full ante+BB even vs a short all-in BB', () => {
  // BB has only 15 (covers ante 5 + 10 of the 20 BB). currentBet must still be
  // ante+BB = 25 on the committedThisStreet scale, so p0 can't limp cheap.
  let s = game([1000, 1000, 15], 10, 20, 5, 55);
  s = startHand(s);
  assert.equal(s.currentBet, 25);
  const la = legalActions(s);
  // p0 (UTG/button, committed 5 ante) must call 20, not less.
  assert.equal(la.callAmount, 20);
});
