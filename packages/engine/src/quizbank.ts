/**
 * Precomputed quiz bank (chip-EV preflop + ICM push/fold).
 *
 * The JSON consumed here is assembled from two generator scripts:
 *   - scripts/gen-quiz-preflop.mjs -> generated/quiz-preflop.json (chip-EV)
 *   - scripts/gen-quiz-icm.mjs     -> generated/quiz-icm.json     (ICM)
 * which are merged into generated/quiz-bank.json. Regenerate with:
 *
 *   npm run build:engine
 *   node packages/engine/scripts/gen-quiz-preflop.mjs
 *   node packages/engine/scripts/gen-quiz-icm.mjs
 *   (then re-assemble generated/quiz-bank.json)
 *
 * Honest caveat: these are chip-EV Monte-Carlo approximations plus a
 * directional first-in ICM shove model (see spotev.ts / mtt.ts), NOT full GTO
 * equilibria. See DATA_SOURCES.md at the repo root for full provenance.
 */

import quizBankJson from './generated/quiz-bank.json' with { type: 'json' };

/** A single chip-EV preflop quiz item. */
export interface ChipEvQuiz {
  id: string;
  line: 'RFI' | 'vs-RFI' | 'vs-3bet';
  heroPos: string;
  villainPos?: string;
  stackBB: number;
  hand: string;
  actions: string[];
  gtoMix: { raise?: number; call?: number; fold?: number };
  evBB?: { raise?: number; fold?: number };
  best: 'raise' | 'call' | 'fold';
  isShove?: boolean;
  note?: string;
}

/** A single ICM push/fold quiz item. */
export interface IcmQuiz {
  id: string;
  scenario: string;
  payoutName: string;
  payouts: number[];
  stacks: number[];
  heroIdx: number;
  heroPos: string;
  blinds: { sb: number; bb: number; ante?: number };
  hand: string;
  decision: 'shove' | 'fold';
  evChipShoveBB?: number;
  evIcmShove: number;
  evIcmFold: number;
  deltaIcm: number;
  bubbleFactor?: number;
  note?: string;
}

export interface QuizBankMeta {
  generatedAt: string;
  chipEvCount: number;
  icmCount: number;
}

/** The full assembled quiz bank. */
export interface QuizBank {
  meta: QuizBankMeta;
  chipEv: ChipEvQuiz[];
  icm: IcmQuiz[];
}

const bank = quizBankJson as unknown as QuizBank;

/** The full precomputed quiz bank. */
export function getQuizBank(): QuizBank {
  return bank;
}

/** Number of chip-EV and ICM quiz items in the bank. */
export function quizBankCounts(): { chipEv: number; icm: number } {
  return { chipEv: bank.chipEv.length, icm: bank.icm.length };
}

/**
 * Deterministic seeded sample of up to `n` items from `items` (optionally
 * filtered). Deterministic so callers/tests get stable output; a Fisher-Yates
 * shuffle driven by a small mulberry32 PRNG spreads the pick across the bank
 * rather than always returning the first `n`.
 */
function sampleFrom<T>(items: readonly T[], n: number, filter?: (item: T) => boolean): T[] {
  const pool = filter ? items.filter(filter) : items.slice();
  if (n >= pool.length) return pool.slice();
  if (n <= 0) return [];

  // mulberry32 PRNG with a fixed seed derived from the pool size.
  let s = (pool.length * 0x9e3779b1) >>> 0;
  const rnd = (): number => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const arr = pool.slice();
  // Partial Fisher-Yates: only the first n positions need to be finalized.
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rnd() * (arr.length - i));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, n);
}

/** Sample up to `n` chip-EV quiz items, optionally filtered by a predicate. */
export function sampleChipEvQuizzes(
  n: number,
  filter?: (q: ChipEvQuiz) => boolean,
): ChipEvQuiz[] {
  return sampleFrom(bank.chipEv, n, filter);
}

/** Sample up to `n` ICM quiz items, optionally filtered by a predicate. */
export function sampleIcmQuizzes(n: number, filter?: (q: IcmQuiz) => boolean): IcmQuiz[] {
  return sampleFrom(bank.icm, n, filter);
}
