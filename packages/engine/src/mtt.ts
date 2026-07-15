/**
 * MTT (multi-table tournament) helpers built on top of the ICM module:
 *
 *   - PAYOUT_PRESETS / payoutsFor: representative standard payout structures
 *   - bubbleFactor: the classic ICM bubble factor (risk/reward asymmetry)
 *   - icmShoveEv: a simple ICM-aware open-shove EV model (documented
 *     simplifications, directional — not a full solver)
 *
 * Everything works in prize-pool fractions: `payouts` sum to ~1 and all ICM
 * EVs returned here are fractions of the total prize pool.
 */

import { icm } from './icm.js';
import { calcEquity } from './equity.js';
import { labelToCombos, parseRange, rangePercent, rangeToCombos } from './range.js';
import { cardsToString } from './cards.js';

// ---------------------------------------------------------------------------
// 1) Payout presets
// ---------------------------------------------------------------------------

export interface PayoutPreset {
  id: string;
  name: string;
  /** Inclusive field-size range this preset is intended for. */
  minPlayers: number;
  maxPlayers: number;
  /**
   * Prize-pool fractions by finish place (index 0 = winner), descending and
   * summing to ~1.
   */
  payouts: number[];
}

/** Expand flat payout tiers ([places, % each]) into a per-place fraction array. */
function ladder(tiers: Array<[places: number, pctEach: number]>): number[] {
  const out: number[] = [];
  for (const [places, pct] of tiers) {
    for (let i = 0; i < places; i++) out.push(pct / 100);
  }
  return out;
}

/**
 * Representative standard payout structures.
 *
 * These are widely-used *representative* percentages (SNG 50/30/20 and 65/35
 * are de-facto standards; the MTT ladders follow the typical online shape of
 * ~20-30% for 1st with flat tiers below, paying roughly the top 10-15% of the
 * field). Real venues vary — treat these as sensible defaults, not gospel.
 */
export const PAYOUT_PRESETS: PayoutPreset[] = [
  {
    id: 'heads-up',
    name: 'Heads-Up (winner takes all)',
    minPlayers: 2,
    maxPlayers: 2,
    payouts: [1],
  },
  {
    id: 'sng-6max',
    name: '6-max SNG (65/35)',
    minPlayers: 3,
    maxPlayers: 6,
    payouts: [0.65, 0.35],
  },
  {
    id: 'sng-9max',
    name: '9-max SNG (50/30/20)',
    minPlayers: 7,
    maxPlayers: 10,
    payouts: [0.5, 0.3, 0.2],
  },
  {
    id: 'mtt-9-18',
    name: 'MTT 9-18 players (50/30/20)',
    minPlayers: 9,
    maxPlayers: 18,
    payouts: [0.5, 0.3, 0.2],
  },
  {
    id: 'mtt-19-45',
    name: 'MTT 19-45 players (5 paid)',
    minPlayers: 19,
    maxPlayers: 45,
    payouts: [0.4, 0.27, 0.18, 0.1, 0.05],
  },
  {
    // 10 places paid (~top 10-15% of a 46-100 field). Sums to exactly 100%.
    id: 'mtt-46-100',
    name: 'MTT 46-100 players (10 paid)',
    minPlayers: 46,
    maxPlayers: 100,
    payouts: ladder([
      [1, 30],
      [1, 20],
      [1, 13.5],
      [1, 9.5],
      [1, 7],
      [1, 5.5],
      [1, 4.5],
      [1, 3.75],
      [1, 3.25],
      [1, 3],
    ]),
  },
  {
    // 27 places paid (~top 10-15% of a 101-300 field), flat 3-seat tiers
    // below 9th, as is typical online. Sums to exactly 100%.
    id: 'mtt-101-300',
    name: 'MTT 101-300 players (27 paid)',
    minPlayers: 101,
    maxPlayers: 300,
    payouts: ladder([
      [1, 23],
      [1, 14.5],
      [1, 10],
      [1, 7.5],
      [1, 5.75],
      [1, 4.5],
      [1, 3.6],
      [1, 3],
      [1, 2.5],
      [3, 2],
      [3, 1.7],
      [3, 1.45],
      [3, 1.25],
      [3, 1.1],
      [3, 1.05],
    ]),
  },
  {
    // 63 places paid (~top 6-20% of a 301-1000 field), flat 3- and 9-seat
    // tiers, typical big-field online shape. Sums to exactly 100%.
    id: 'mtt-301-1000',
    name: 'MTT 301-1000 players (63 paid)',
    minPlayers: 301,
    maxPlayers: 1000,
    payouts: ladder([
      [1, 18.5],
      [1, 11.5],
      [1, 8],
      [1, 6],
      [1, 4.6],
      [1, 3.6],
      [1, 2.9],
      [1, 2.35],
      [1, 1.9],
      [3, 1.5],
      [3, 1.25],
      [3, 1.05],
      [9, 0.9],
      [9, 0.75],
      [9, 0.62],
      [9, 0.52],
      [9, 0.46],
    ]),
  },
];

/**
 * Payout fractions for a given field size.
 *
 * - With `preset`, looks the preset up by id (throws when unknown).
 * - Without it, picks the first preset whose [minPlayers, maxPlayers] range
 *   contains `fieldSize`; fields larger than 1000 fall back to the biggest
 *   ladder.
 * - If the preset pays more places than there are players (e.g. a 2-player
 *   field with the 50/30/20 preset), the list is trimmed to `fieldSize`
 *   places and renormalized so it still sums to 1.
 */
export function payoutsFor(fieldSize: number, preset?: string): number[] {
  if (!Number.isFinite(fieldSize) || fieldSize < 2) {
    throw new Error(`fieldSize must be >= 2, got ${fieldSize}`);
  }
  let p: PayoutPreset | undefined;
  if (preset !== undefined) {
    p = PAYOUT_PRESETS.find((x) => x.id === preset);
    if (!p) throw new Error(`Unknown payout preset: ${preset}`);
  } else {
    p =
      PAYOUT_PRESETS.find((x) => fieldSize >= x.minPlayers && fieldSize <= x.maxPlayers) ??
      PAYOUT_PRESETS[PAYOUT_PRESETS.length - 1];
  }
  if (p.payouts.length <= fieldSize) return p.payouts.slice();
  const trimmed = p.payouts.slice(0, fieldSize);
  const sum = trimmed.reduce((a, b) => a + b, 0);
  return trimmed.map((x) => x / sum);
}

// ---------------------------------------------------------------------------
// 2) Bubble factor
// ---------------------------------------------------------------------------

/**
 * ICM bubble factor for an all-in between hero and villain:
 *
 *   BF = (hero's ICM equity loss when losing) / (equity gain when winning)
 *
 * The all-in is for the effective stack min(hero, villain); the winner takes
 * that amount from the loser. In chip-EV terms BF is exactly 1; tournament
 * payout pressure makes it >= 1 in typical spots (you must win more often
 * than pot odds suggest). It grows when the villain covers the hero, because
 * losing then costs the hero's tournament life.
 */
export function bubbleFactor(
  stacks: number[],
  payouts: number[],
  heroIdx: number,
  villainIdx: number,
): number {
  const amount = Math.min(stacks[heroIdx], stacks[villainIdx]);
  const base = icm(stacks, payouts).equities[heroIdx];

  const winStacks = stacks.slice();
  winStacks[heroIdx] += amount;
  winStacks[villainIdx] -= amount;
  const gain = icm(winStacks, payouts).equities[heroIdx] - base;

  const loseStacks = stacks.slice();
  loseStacks[heroIdx] -= amount;
  loseStacks[villainIdx] += amount;
  const loss = base - icm(loseStacks, payouts).equities[heroIdx];

  // Degenerate spot (nothing to gain): infinite risk/reward ratio.
  if (gain <= 0) return Number.POSITIVE_INFINITY;
  return loss / gain;
}

// ---------------------------------------------------------------------------
// 3) ICM shove EV (open-shove, first-in caller model)
// ---------------------------------------------------------------------------

export interface IcmShoveEvOptions {
  /** Current chip stacks, table order. */
  stacks: number[];
  /** Prize-pool fractions per finish place (see payoutsFor). */
  payouts: number[];
  heroIdx: number;
  /** Hero's hand: a grid label ("AA", "AKs", "72o") or exact cards ("AsKh"). */
  heroHand: string;
  /**
   * Players left to act behind the shove, in action order, each with the
   * range they call the shove with (range-string syntax from range.ts).
   */
  callerRanges: { idx: number; range: string }[];
  sb: number;
  bb: number;
  ante?: number;
  /** Monte-Carlo iterations per caller matchup. Default 5000. */
  iterations?: number;
  seed?: number;
}

export interface IcmShoveEvResult {
  /** Hero's ICM equity (prize-pool fraction) when folding. */
  evFoldICM: number;
  /** Hero's ICM equity when open-shoving. */
  evShoveICM: number;
  /** evShoveICM - evFoldICM. */
  deltaICM: number;
  /** true when shoving beats folding under this model. */
  shoveOk: boolean;
}

/** Resolve "AA"/"AKs"/"72o" labels to a representative combo, pass exact cards through. */
function heroHandToCards(heroHand: string): string {
  if (/^([2-9TJQKA][cdhs]){2}$/i.test(heroHand.trim())) return heroHand.trim();
  const combos = labelToCombos(heroHand.trim());
  if (!combos.length) throw new Error(`Invalid hero hand: ${heroHand}`);
  // Preflop all-in equity is suit-symmetric, so one representative combo is fine.
  return cardsToString(combos[0]);
}

/**
 * ICM EV of an open-shove vs folding, in prize-pool fractions.
 *
 * This is a deliberately SIMPLE model — a directional shove/fold indicator,
 * not a solver. The simplifications:
 *
 *  1. Fold baseline: evFoldICM is the ICM equity of the CURRENT stacks. We do
 *     not deduct blinds/antes the hero may have posted (or is about to post),
 *     so "fold" costs nothing. This slightly flatters folding for the blinds
 *     and ignores blind pressure on future hands (no future-game simulation).
 *  2. First-in caller model: callers are considered in the given order; each
 *     calls with probability = his range's combo fraction (rangePercent),
 *     independently of the others and without card-removal effects from the
 *     hero's hand. Exactly one caller (the first to call) plays the all-in;
 *     everyone behind him folds. Multiway all-ins are ignored.
 *  3. Dead money: the pot contains sb + bb + ante * N as dead money credited
 *     to whoever wins the hand WITHOUT debiting the posters. This keeps the
 *     model position-free (we don't know which seat posted what) at the cost
 *     of slightly inflating the winner's share; if the caller is the big
 *     blind his blind is double-counted by one bb. The bias is small while
 *     blinds are small relative to stacks.
 *  4. Ties/chops: hero's Monte-Carlo equity already counts ties as half-wins,
 *     so a chop is modeled as a fractional win/loss instead of a separate
 *     split-pot ICM branch.
 *  5. Range weights: weighted range entries ("AKs:0.5") count toward the call
 *     frequency, but the equity term samples the caller's combos uniformly.
 */
export function icmShoveEv(opts: IcmShoveEvOptions): IcmShoveEvResult {
  const { stacks, payouts, heroIdx } = opts;
  const n = stacks.length;
  const deadMoney = opts.sb + opts.bb + (opts.ante ?? 0) * n;
  const heroCards = heroHandToCards(opts.heroHand);

  // Simplification 1: folding keeps the stacks as they are.
  const evFoldICM = icm(stacks, payouts).equities[heroIdx];

  let evShoveICM = 0;
  let pNoCallYet = 1; // probability everyone considered so far has folded

  for (const caller of opts.callerRanges) {
    const range = parseRange(caller.range);
    const callFrac = Math.max(0, Math.min(1, rangePercent(range) / 100));
    const pThisCalls = pNoCallYet * callFrac; // first caller to act ends the model
    pNoCallYet *= 1 - callFrac;
    if (pThisCalls <= 0) continue;

    // Hero's all-in equity vs this caller's range.
    const combos = rangeToCombos(range).map((x) => x.combo);
    const eq = calcEquity([{ cards: heroCards }, { combos }], {
      iterations: opts.iterations ?? 5000,
      seed: opts.seed ?? 2026,
    });
    const pWin = eq.equities[0];

    // Winner takes the effective stack from the loser plus the dead money.
    const eff = Math.min(stacks[heroIdx], stacks[caller.idx]);
    const winStacks = stacks.slice();
    winStacks[heroIdx] += eff + deadMoney;
    winStacks[caller.idx] -= eff;
    const loseStacks = stacks.slice();
    loseStacks[heroIdx] -= eff;
    loseStacks[caller.idx] += eff + deadMoney;

    const evWin = icm(winStacks, payouts).equities[heroIdx];
    const evLose = icm(loseStacks, payouts).equities[heroIdx];
    evShoveICM += pThisCalls * (pWin * evWin + (1 - pWin) * evLose);
  }

  // Everyone folds: hero picks up the dead money (simplification 3).
  const foldOutStacks = stacks.slice();
  foldOutStacks[heroIdx] += deadMoney;
  evShoveICM += pNoCallYet * icm(foldOutStacks, payouts).equities[heroIdx];

  const deltaICM = evShoveICM - evFoldICM;
  return { evFoldICM, evShoveICM, deltaICM, shoveOk: deltaICM > 0 };
}

// ---------------------------------------------------------------------------
// 4) 몬스터 게임 (파이널 나인 홀덤펍) — Korean-pub monster tournament helper
// ---------------------------------------------------------------------------

/**
 * 파이널 나인 홀덤펍 "몬스터 게임"의 실제 구조 상수.
 *
 * - buyIn / rebuyFee: 바이인·리바이 모두 3만원, 전액 프라이즈풀에 포함.
 * - startStack / rebuyStack: 스타트 250만 칩, 리바이 300만 칩 (참고용, ICM 계산엔
 *   실제 현재 스택을 입력).
 * - lateRegLevel: 레이트 레지스트레이션(리바이) 마감 레벨.
 */
export const MONSTER_GAME = {
  buyIn: 30000,
  rebuyFee: 30000,
  startStack: 2_500_000,
  rebuyStack: 3_000_000,
  lateRegLevel: 10,
} as const;

/**
 * 지급 인원 = floor(엔트리 / 7) (7엔트리당 1명 지급), 최소 1명.
 * 예: 21→3, 28→4, 35→5, 20→2, 14→2, 7→1, 6→1.
 */
export function monsterPaidCount(entries: number): number {
  return Math.max(1, Math.floor(entries / 7));
}

/**
 * 프라이즈풀 = 엔트리 수 × 바이인 + 리바이 수 × 리바이 요금.
 * 바이인/리바이 요금은 기본값(각 3만원, MONSTER_GAME)에서 가져오며 필요 시 재정의.
 * 예: monsterPrizePool(21, 15) = (21 + 15) × 30,000 = 1,080,000원.
 */
export function monsterPrizePool(
  entries: number,
  rebuys: number,
  buyIn: number = MONSTER_GAME.buyIn,
  rebuyFee: number = MONSTER_GAME.rebuyFee,
): number {
  return entries * buyIn + rebuys * rebuyFee;
}

/**
 * 지급 인원별 표준 프라이즈풀 배분율 (index 0 = 우승), 내림차순, 합계 정확히 1.
 *
 * 홀덤펍 몬스터 게임에서 흔한 상위 집중형 분배를 앵커로 두고, 지급 인원이 6명을
 * 넘으면 상위 6자리는 톱헤비를 유지한 채 그 아래는 플랫한 미니멈 캐시 꼬리를 붙입니다.
 * 어떤 인원이든 마지막에 합계 1로 재정규화합니다.
 */
export function monsterPayouts(paidCount: number): number[] {
  const n = Math.max(0, Math.floor(paidCount));
  if (n <= 0) return [];

  // 1~6명: 표준 몬스터 앵커(각 합계 1). 7명 이상: 상위 6자리 톱헤비 + 플랫 미니캐시 꼬리.
  const anchors: Record<number, number[]> = {
    1: [1],
    2: [0.65, 0.35],
    3: [0.5, 0.3, 0.2],
    4: [0.45, 0.27, 0.18, 0.1],
    5: [0.4, 0.25, 0.17, 0.11, 0.07],
    6: [0.38, 0.23, 0.16, 0.11, 0.07, 0.05],
  };

  let raw: number[];
  if (n <= 6) {
    raw = anchors[n].slice();
  } else {
    raw = anchors[6].slice();
    // 6위(0.05)보다 낮은 플랫 미니멈 캐시 — 상위 집중 유지, 내림차순 보존.
    const minCash = 0.035;
    for (let i = 6; i < n; i++) raw.push(minCash);
  }

  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / sum);
}
