/**
 * Single-table No-Limit Hold'em state machine.
 *
 * Pure & deterministic: every function takes a state and returns a NEW state
 * (the input is never mutated), and shuffling is driven by a seed so a given
 * (config, actions) sequence always replays identically. The web room store is
 * the only authority that advances this engine; clients just render the state.
 *
 * Reuses the shared card/eval primitives so a hand here scores exactly like the
 * equity and solver tools.
 */

import { fullDeck, mulberry32, cardToString, type Card } from './cards.js';
import { evaluate7 } from './handEval.js';

export type SeatStatus = 'active' | 'folded' | 'allin' | 'sittingOut' | 'empty';
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface Seat {
  id: string;
  name: string;
  stack: number;
  status: SeatStatus;
  holeCards: Card[]; // empty until dealt; length 2 while in a hand
  /** Chips put in on the current betting street (reset each street). */
  committedThisStreet: number;
  /** Total chips committed across the whole hand (drives side-pot math). */
  committedTotal: number;
  /** Whether this seat has acted since the last bet/raise on this street. */
  hasActed: boolean;
}

export interface Pot {
  amount: number;
  /** Seat ids eligible to win this pot. */
  eligible: string[];
}

export interface Winner {
  seatId: string;
  amount: number;
  /** Pot index won (0 = main pot). */
  potIndex: number;
  /** Hand description, or 'uncontested' on a fold-around. */
  hand: string;
}

export interface TableState {
  seats: Seat[];
  button: number; // seat index of the dealer button
  deck: Card[]; // remaining undealt cards
  board: Card[];
  pots: Pot[]; // computed at showdown; otherwise a single running main pot
  currentStreet: Street;
  toAct: number; // seat index to act, or -1 when the hand isn't running
  /** Highest committed-this-street amount a player must match to stay in. */
  currentBet: number;
  /** Minimum raise INCREMENT allowed on top of currentBet. */
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  handNumber: number;
  seed: number;
  /** True between startHand and showdown. */
  handInProgress: boolean;
  log: string[];
  winners: Winner[];
}

export interface PlayerConfig {
  id: string;
  name: string;
  stack: number;
}

export interface GameConfig {
  players: PlayerConfig[];
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  seed?: number;
}

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface Action {
  type: ActionType;
  /** For bet/raise: the TOTAL committed-this-street amount the seat raises TO. */
  amount?: number;
}

export interface LegalActions {
  actions: ActionType[];
  /** Chips needed to call (0 when checking is allowed). */
  callAmount: number;
  /** Smallest legal total-to for a bet/raise. */
  minRaiseTo: number;
  /** Largest legal total-to (an all-in shove). */
  maxRaiseTo: number;
}

// ---------- helpers ----------

function cloneSeat(s: Seat): Seat {
  return { ...s, holeCards: [...s.holeCards] };
}

function cloneState(s: TableState): TableState {
  return {
    ...s,
    seats: s.seats.map(cloneSeat),
    deck: [...s.deck],
    board: [...s.board],
    pots: s.pots.map((p) => ({ amount: p.amount, eligible: [...p.eligible] })),
    log: [...s.log],
    winners: s.winners.map((w) => ({ ...w })),
  };
}

function shuffle(seed: number): Card[] {
  const rng = mulberry32(seed);
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Seats that can still take a voluntary action (active, not all-in/folded). */
function actableCount(s: TableState): number {
  return s.seats.filter((x) => x.status === 'active').length;
}

/** Seats still in the hand (haven't folded and aren't empty/sitting out). */
function liveSeats(s: TableState): Seat[] {
  return s.seats.filter((x) => x.status === 'active' || x.status === 'allin');
}

/** Next seat index (with given statuses) clockwise from `from`, or -1. */
function nextSeat(s: TableState, from: number, statuses: SeatStatus[]): number {
  const n = s.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (statuses.includes(s.seats[idx].status)) return idx;
  }
  return -1;
}

function seatIndex(s: TableState, seatId: string): number {
  return s.seats.findIndex((x) => x.id === seatId);
}

// ---------- creation ----------

export function createGame(config: GameConfig): TableState {
  const seats: Seat[] = config.players.map((p) => ({
    id: p.id,
    name: p.name,
    stack: p.stack,
    status: 'active', // ready to be dealt in
    holeCards: [],
    committedThisStreet: 0,
    committedTotal: 0,
    hasActed: false,
  }));
  return {
    seats,
    button: 0,
    deck: [],
    board: [],
    pots: [{ amount: 0, eligible: [] }],
    currentStreet: 'preflop',
    toAct: -1,
    currentBet: 0,
    minRaise: config.bigBlind,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    ante: config.ante ?? 0,
    handNumber: 0,
    seed: config.seed ?? 1,
    handInProgress: false,
    log: ['게임이 생성되었습니다.'],
    winners: [],
  };
}

/** Move chips from a seat into the running main pot, capping at their stack. */
function commit(seat: Seat, pot: Pot, amount: number): number {
  const real = Math.min(amount, seat.stack);
  seat.stack -= real;
  seat.committedThisStreet += real;
  seat.committedTotal += real;
  pot.amount += real;
  if (seat.stack === 0 && (seat.status === 'active' || seat.status === 'allin')) {
    seat.status = 'allin';
  }
  return real;
}

// ---------- start a hand ----------

export function startHand(state: TableState): TableState {
  const s = cloneState(state);
  // Anyone with chips who isn't explicitly sitting out is dealt in.
  for (const seat of s.seats) {
    if (seat.status === 'empty' || seat.status === 'sittingOut') continue;
    seat.status = seat.stack > 0 ? 'active' : 'sittingOut';
    seat.holeCards = [];
    seat.committedThisStreet = 0;
    seat.committedTotal = 0;
    seat.hasActed = false;
  }
  const playing = s.seats.filter((x) => x.status === 'active');
  if (playing.length < 2) throw new Error('칩을 가진 플레이어가 2명 이상 필요합니다.');

  s.handNumber += 1;
  s.board = [];
  s.pots = [{ amount: 0, eligible: [] }];
  s.winners = [];
  s.currentStreet = 'preflop';
  s.currentBet = 0;
  s.minRaise = s.bigBlind;
  s.log = [];

  // Rotate the button to the next dealt-in seat (first hand keeps button 0
  // if it's a player, else advances to one).
  if (s.handNumber === 1) {
    if (s.seats[s.button].status !== 'active') {
      s.button = nextSeat(s, s.button, ['active']);
    }
  } else {
    s.button = nextSeat(s, s.button, ['active']);
  }

  // Fresh shuffle per hand so each deal is independent yet reproducible.
  s.deck = shuffle(s.seed + s.handNumber);

  const pot = s.pots[0];
  s.log.push(`핸드 #${s.handNumber} 시작 (버튼: ${s.seats[s.button].name})`);

  // Antes first (everyone dealt in posts).
  if (s.ante > 0) {
    for (const seat of playing) {
      const posted = commit(seat, pot, s.ante);
      if (posted > 0) s.log.push(`${seat.name} 앤티 ${posted}`);
    }
  }

  // Blinds. Heads-up: button is the small blind and acts first preflop.
  const heads = playing.length === 2;
  const sbIdx = heads ? s.button : nextSeat(s, s.button, ['active']);
  const bbIdx = nextSeat(s, sbIdx, ['active']);

  const sbSeat = s.seats[sbIdx];
  const bbSeat = s.seats[bbIdx];
  const sbPosted = commit(sbSeat, pot, s.smallBlind);
  s.log.push(`${sbSeat.name} 스몰블라인드 ${sbPosted}`);
  const bbPosted = commit(bbSeat, pot, s.bigBlind);
  s.log.push(`${bbSeat.name} 빅블라인드 ${bbPosted}`);

  // Antes are committed into committedThisStreet, so the floor must be on the
  // same scale (ante + BB); otherwise a short all-in BB drops currentBet to a
  // bare BB and other players get to see the flop for less than a full call.
  s.currentBet = Math.max(sbSeat.committedThisStreet, bbSeat.committedThisStreet, s.ante + s.bigBlind);
  s.minRaise = s.bigBlind;

  // Deal two hole cards each, starting left of the button. Deal to everyone in
  // the hand — including players a blind/ante just put all-in (status 'allin').
  const dealt: SeatStatus[] = ['active', 'allin'];
  for (let round = 0; round < 2; round++) {
    let idx = nextSeat(s, s.button, dealt);
    for (let k = 0; k < playing.length; k++) {
      s.seats[idx].holeCards.push(s.deck.shift()!);
      idx = nextSeat(s, idx, dealt);
    }
  }

  // The blinds have "posted" but not voluntarily acted; mark them un-acted so
  // they get their option. First to act preflop is left of the big blind
  // (heads-up: the SB/button acts first).
  s.toAct = heads ? sbIdx : nextSeat(s, bbIdx, ['active']);
  s.handInProgress = true;
  // A blind can put the first-to-act seat all-in (very short stack). Make sure
  // action lands on someone who can actually act, or run the board out.
  return ensureActionable(s);
}

/**
 * Guarantee `toAct` points at a seat that can voluntarily act. If the intended
 * actor is all-in/folded, skip to the next active seat; if nobody can act
 * (e.g. blinds put everyone all-in), settle the hand by running out the board.
 */
function ensureActionable(s: TableState): TableState {
  const live = liveSeats(s);
  if (live.length <= 1) {
    return live.length === 1 ? finishUncontested(s, live[0]) : s;
  }
  if (s.toAct >= 0 && s.seats[s.toAct].status !== 'active') {
    s.toAct = nextSeat(s, s.toAct, ['active']);
  }
  if (s.toAct < 0 || roundClosed(s)) {
    return nextStreet(s);
  }
  return s;
}

// ---------- legality ----------

export function legalActions(state: TableState): LegalActions {
  const idx = state.toAct;
  const empty: LegalActions = { actions: [], callAmount: 0, minRaiseTo: 0, maxRaiseTo: 0 };
  if (idx < 0 || !state.handInProgress) return empty;
  const seat = state.seats[idx];
  if (seat.status !== 'active') return empty;

  const toCall = Math.max(0, state.currentBet - seat.committedThisStreet);
  const stack = seat.stack;
  const actions: ActionType[] = [];

  // Fold is always legal when facing a bet; when nothing to call you can still
  // fold but it's pointless — allow it anyway for UI symmetry only if facing.
  if (toCall > 0) actions.push('fold');
  else actions.push('check');

  if (toCall > 0 && stack > 0) {
    // Call is legal; if you can't cover, it's a call-all-in for less.
    actions.push('call');
  }

  // Bet (no current bet) vs raise (facing a bet). Need chips beyond the call.
  const maxTo = seat.committedThisStreet + stack; // all-in total-to
  if (state.currentBet === 0) {
    if (stack > 0) actions.push('bet');
  } else {
    // Can raise only if you have chips beyond a flat call AND the action is
    // still open to you: a short all-in that didn't meet the min-raise leaves
    // already-acted seats (hasActed) with only call/fold rights, not a re-raise.
    if (stack > toCall && !seat.hasActed) actions.push('raise');
  }

  // All-in is always legal as a call-for-less; as an aggressive (bet-exceeding)
  // shove it's only legal when the seat still has action (hasn't acted / was
  // re-opened by a full raise).
  if (stack > 0 && (!seat.hasActed || maxTo <= state.currentBet)) actions.push('allin');

  // Min/max raise-to. Standard NLHE: min raise increment = last full raise
  // (tracked in minRaise), so min total-to = currentBet + minRaise.
  const minRaiseTo = state.currentBet === 0 ? state.bigBlind : state.currentBet + state.minRaise;
  return {
    actions,
    callAmount: Math.min(toCall, stack),
    minRaiseTo: Math.min(minRaiseTo, maxTo),
    maxRaiseTo: maxTo,
  };
}

// ---------- applying an action ----------

export function applyAction(state: TableState, seatId: string, action: Action): TableState {
  if (!state.handInProgress) throw new Error('진행 중인 핸드가 없습니다.');
  const idx = seatIndex(state, seatId);
  if (idx < 0) throw new Error('존재하지 않는 좌석입니다.');
  if (idx !== state.toAct) throw new Error('당신의 차례가 아닙니다.');

  const s = cloneState(state);
  const seat = s.seats[idx];
  const legal = legalActions(state);
  const pot = s.pots[0];
  const toCall = Math.max(0, s.currentBet - seat.committedThisStreet);

  switch (action.type) {
    case 'fold': {
      if (!legal.actions.includes('fold')) throw new Error('폴드할 수 없습니다.');
      seat.status = 'folded';
      s.log.push(`${seat.name} 폴드`);
      break;
    }
    case 'check': {
      if (toCall !== 0) throw new Error('콜할 금액이 있어 체크할 수 없습니다.');
      s.log.push(`${seat.name} 체크`);
      break;
    }
    case 'call': {
      if (toCall <= 0) throw new Error('콜할 금액이 없습니다.');
      const paid = commit(seat, pot, toCall);
      s.log.push(`${seat.name} 콜 ${paid}`);
      break;
    }
    case 'bet':
    case 'raise': {
      const isBet = action.type === 'bet';
      if (isBet && s.currentBet !== 0) throw new Error('이미 베팅이 있어 벳할 수 없습니다.');
      if (!isBet && s.currentBet === 0) throw new Error('베팅이 없어 레이즈할 수 없습니다.');
      // Action wasn't re-opened to this seat (a prior short all-in didn't meet
      // the min-raise): it may only call or fold, not re-raise.
      if (!isBet && seat.hasActed) throw new Error('액션이 재개되지 않아 레이즈할 수 없습니다.');
      const totalTo = action.amount ?? 0;
      const maxTo = seat.committedThisStreet + seat.stack;
      if (totalTo > maxTo) throw new Error('스택보다 큰 금액입니다.');
      // Allow a short all-in (totalTo === maxTo) below the min-raise; otherwise
      // enforce the min-raise total-to.
      const minTo = legal.minRaiseTo;
      if (totalTo < minTo && totalTo !== maxTo) {
        throw new Error(`최소 ${minTo}까지 올려야 합니다.`);
      }
      const raiseIncrement = totalTo - s.currentBet;
      const add = totalTo - seat.committedThisStreet;
      commit(seat, pot, add);
      // A full-sized raise resets the min-raise and re-opens action; a short
      // all-in does not raise the bar for players who already acted.
      if (raiseIncrement >= s.minRaise || s.currentBet === 0) {
        s.minRaise = Math.max(s.minRaise, raiseIncrement);
        s.currentBet = seat.committedThisStreet;
        reopenAction(s, idx);
      } else {
        // Short all-in: currentBet may rise but action isn't re-opened.
        s.currentBet = Math.max(s.currentBet, seat.committedThisStreet);
      }
      s.log.push(`${seat.name} ${isBet ? '벳' : '레이즈'} ${seat.committedThisStreet}`);
      break;
    }
    case 'allin': {
      // An aggressive (bet-exceeding) shove is illegal once this seat has acted
      // and wasn't re-opened; a call-for-less all-in (can't exceed currentBet)
      // stays legal.
      if (seat.hasActed && seat.committedThisStreet + seat.stack > s.currentBet) {
        throw new Error('액션이 재개되지 않아 올인 레이즈할 수 없습니다.');
      }
      const add = seat.stack;
      const before = s.currentBet;
      const paid = commit(seat, pot, add);
      const newCommitted = seat.committedThisStreet;
      const raiseIncrement = newCommitted - before;
      if (newCommitted > before) {
        if (raiseIncrement >= s.minRaise || before === 0) {
          s.minRaise = Math.max(s.minRaise, raiseIncrement);
          s.currentBet = newCommitted;
          reopenAction(s, idx);
        } else {
          s.currentBet = newCommitted; // short raise: bar rises, no re-open
        }
      }
      s.log.push(`${seat.name} 올인 ${paid} (총 ${newCommitted})`);
      break;
    }
    default:
      throw new Error('알 수 없는 액션입니다.');
  }

  seat.hasActed = true;
  return advance(s);
}

/**
 * A player forfeits / leaves the table mid-hand. An active player is folded
 * (advancing the turn or ending the hand as needed); an all-in player stays in
 * for the showdown (their committed chips remain live). If the hand isn't
 * running, the seat is simply marked sitting-out.
 */
export function forfeit(state: TableState, seatId: string): TableState {
  const s = cloneState(state);
  const idx = seatIndex(s, seatId);
  if (idx < 0) return s;
  const seat = s.seats[idx];

  if (!s.handInProgress) {
    if (seat.status !== 'empty') seat.status = 'sittingOut';
    return s;
  }
  if (seat.status !== 'active') return s; // all-in stays live; folded/out no-op

  const wasToAct = s.toAct === idx;
  seat.status = 'folded';
  s.log.push(`${seat.name} 나감 (폴드)`);

  if (wasToAct) return advance(s);
  const live = liveSeats(s);
  if (live.length === 1) return finishUncontested(s, live[0]);
  return s;
}

/** A full raise re-opens the betting: everyone else must act again. */
function reopenAction(s: TableState, raiserIdx: number): void {
  for (let i = 0; i < s.seats.length; i++) {
    if (i === raiserIdx) continue;
    if (s.seats[i].status === 'active') s.seats[i].hasActed = false;
  }
}

/** Has the current betting round closed? */
function roundClosed(s: TableState): boolean {
  const active = s.seats.filter((x) => x.status === 'active');
  // No one left to act voluntarily -> round (and usually hand) is closed.
  if (active.length === 0) return true;
  // Everyone active must have acted and matched the current bet.
  return active.every((x) => x.hasActed && x.committedThisStreet === s.currentBet);
}

/** Advance the turn / street / hand after an action lands. */
function advance(s: TableState): TableState {
  const live = liveSeats(s);
  // Everyone folded but one -> immediate, uncontested win.
  if (live.length === 1) {
    return finishUncontested(s, live[0]);
  }

  if (!roundClosed(s)) {
    const next = nextSeat(s, s.toAct, ['active']);
    s.toAct = next;
    return s;
  }

  // Round closed. If only one (or zero) seat can still act voluntarily, run
  // the remaining board out and go to showdown.
  return nextStreet(s);
}

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

function nextStreet(s: TableState): TableState {
  // Reset per-street betting bookkeeping.
  for (const seat of s.seats) {
    seat.committedThisStreet = 0;
    if (seat.status === 'active') seat.hasActed = false;
  }
  s.currentBet = 0;
  s.minRaise = s.bigBlind;

  // If at most one seat can still act, deal the rest of the board and showdown.
  const canAct = actableCount(s);

  const order = STREET_ORDER.indexOf(s.currentStreet);
  const advanceTo = order + 1;
  const newStreet = STREET_ORDER[advanceTo];

  if (newStreet === 'flop') {
    s.deck.shift(); // burn
    s.board.push(s.deck.shift()!, s.deck.shift()!, s.deck.shift()!);
    s.currentStreet = 'flop';
    s.log.push(`플랍: ${s.board.map(cardToString).join(' ')}`);
  } else if (newStreet === 'turn') {
    s.deck.shift();
    s.board.push(s.deck.shift()!);
    s.currentStreet = 'turn';
    s.log.push(`턴: ${cardToString(s.board[3])}`);
  } else if (newStreet === 'river') {
    s.deck.shift();
    s.board.push(s.deck.shift()!);
    s.currentStreet = 'river';
    s.log.push(`리버: ${cardToString(s.board[4])}`);
  } else {
    // Past the river -> showdown.
    return showdown(s);
  }

  // If nobody can voluntarily act (all-in situation), keep dealing.
  if (canAct < 2) {
    return nextStreet(s);
  }

  // First to act postflop: first active seat left of the button.
  s.toAct = nextSeat(s, s.button, ['active']);
  return s;
}

function finishUncontested(s: TableState, winner: Seat): TableState {
  const total = s.pots[0].amount;
  winner.stack += total;
  s.pots = [{ amount: total, eligible: [winner.id] }];
  s.winners = [{ seatId: winner.id, amount: total, potIndex: 0, hand: 'uncontested' }];
  s.log.push(`${winner.name} 승리 (+${total}), 쇼다운 없음`);
  s.currentStreet = 'showdown';
  s.toAct = -1;
  s.handInProgress = false;
  return s;
}

// ---------- side pots & showdown ----------

/**
 * Build main + side pots from each seat's total committed chips. Players only
 * compete for the layers they paid into. Folded players' chips stay in the
 * pots (dead money) but they're never eligible to win.
 */
export function buildPots(seats: Seat[]): Pot[] {
  // Distinct positive contribution levels, ascending.
  const contributors = seats.filter((s) => s.committedTotal > 0);
  const levels = [...new Set(contributors.map((s) => s.committedTotal))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layer = level - prev;
    let amount = 0;
    const eligible: string[] = [];
    for (const s of contributors) {
      if (s.committedTotal >= level) {
        amount += layer;
        // Only non-folded seats can win this layer.
        if (s.status === 'active' || s.status === 'allin') eligible.push(s.id);
      } else if (s.committedTotal > prev) {
        // Partial contribution into this layer (folded all-in-for-less etc.).
        amount += s.committedTotal - prev;
      }
    }
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  // Merge adjacent pots with identical eligibility (cleaner display).
  const merged: Pot[] = [];
  for (const p of pots) {
    const last = merged[merged.length - 1];
    if (last && sameSet(last.eligible, p.eligible)) last.amount += p.amount;
    else merged.push({ amount: p.amount, eligible: [...p.eligible] });
  }
  return merged.length ? merged : [{ amount: 0, eligible: [] }];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

const CAT_NAMES = [
  '하이카드',
  '원페어',
  '투페어',
  '트립스',
  '스트레이트',
  '플러시',
  '풀하우스',
  '포카드',
  '스트레이트 플러시',
];

function handLabel(score: number): string {
  const cat = Math.floor(score / 16 ** 5);
  return CAT_NAMES[cat] ?? '하이카드';
}

function showdown(s: TableState): TableState {
  s.currentStreet = 'showdown';
  s.toAct = -1;
  s.handInProgress = false;

  const contenders = liveSeats(s);

  // Return any uncalled excess: chips a seat committed beyond what any live
  // contender could match (e.g. a big bet only a since-folded/forfeited seat
  // covered). Without this, buildPots would create a top layer with an empty
  // eligible list that showdown then drops, permanently destroying those chips.
  const liveMax = Math.max(...contenders.map((c) => c.committedTotal));
  for (const seat of s.seats) {
    if (seat.committedTotal > liveMax) {
      const excess = seat.committedTotal - liveMax;
      seat.committedTotal = liveMax;
      seat.stack += excess;
      s.log.push(`${seat.name} 콜되지 않은 베팅 ${excess} 반환`);
    }
  }

  // Score each contender's best 7-card hand.
  const scores = new Map<string, number>();
  for (const seat of contenders) {
    scores.set(seat.id, evaluate7([...seat.holeCards, ...s.board]));
  }

  s.pots = buildPots(s.seats);
  const winners: Winner[] = [];

  s.pots.forEach((potObj, potIndex) => {
    const eligible = potObj.eligible.filter((id) => scores.has(id));
    if (!eligible.length) return;
    let best = -1;
    for (const id of eligible) best = Math.max(best, scores.get(id)!);
    const champs = eligible.filter((id) => scores.get(id) === best);

    // Split the pot; give odd chips to the earliest seats left of the button.
    const share = Math.floor(potObj.amount / champs.length);
    let remainder = potObj.amount - share * champs.length;
    const ordered = orderFromButton(s, champs);
    for (const id of ordered) {
      let award = share;
      if (remainder > 0) {
        award += 1;
        remainder -= 1;
      }
      const seat = s.seats[seatIndex(s, id)];
      seat.stack += award;
      winners.push({ seatId: id, amount: award, potIndex, hand: handLabel(scores.get(id)!) });
    }
  });

  s.winners = winners;
  // Human-readable showdown log.
  for (const seat of contenders) {
    s.log.push(`${seat.name} 쇼다운: ${handLabel(scores.get(seat.id)!)}`);
  }
  for (const w of winners) {
    const seat = s.seats[seatIndex(s, w.seatId)];
    s.log.push(`${seat.name} 팟${w.potIndex} 획득 +${w.amount} (${w.hand})`);
  }
  return s;
}

/** Order seat ids by seat position starting left of the button. */
function orderFromButton(s: TableState, ids: string[]): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  const n = s.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (s.button + i) % n;
    if (set.has(s.seats[idx].id)) out.push(s.seats[idx].id);
  }
  return out;
}

// ---------- view helpers (for the server to redact opponents' cards) ----------

/**
 * Return a copy of the state with hole cards hidden for everyone except the
 * given viewer, unless the hand has reached showdown (then non-folded hands are
 * revealed). `viewerId` undefined hides all unrevealed cards.
 */
export function redactFor(state: TableState, viewerId?: string): TableState {
  const s = cloneState(state);
  // Never ship the undealt deck or the RNG seed to clients: the deck reveals
  // every upcoming board/opponent card, and the seed reproduces this hand and —
  // via shuffle(seed + handNumber) — every future hand. Strip both always.
  s.deck = [];
  s.seed = 0;
  // Reveal hole cards only at a genuine showdown, never on an uncontested
  // (fold-around) win, which also sets currentStreet to 'showdown'.
  const reveal = s.currentStreet === 'showdown' && !s.winners.some((w) => w.hand === 'uncontested');
  for (const seat of s.seats) {
    if (seat.holeCards.length === 0) continue;
    const isViewer = seat.id === viewerId;
    const showAtShowdown = reveal && (seat.status === 'active' || seat.status === 'allin');
    if (!isViewer && !showAtShowdown) {
      // Replace with face-down sentinels (-1) so the client knows the count.
      seat.holeCards = seat.holeCards.map(() => -1);
    }
  }
  return s;
}
