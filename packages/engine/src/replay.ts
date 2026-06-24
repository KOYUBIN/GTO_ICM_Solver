/**
 * Hand-replay helpers — street-by-street all-in equity.
 *
 * Given each player's known hole cards and the final board, compute the equity
 * each player held at every revealed street (preflop, flop, turn, river). This
 * reproduces the all-in equity a replay screen shows (e.g. 88 vs KK ≈ 19.5%
 * preflop) and adds how it evolved as the board ran out.
 */

import { parseCards, cardsToString } from './cards.js';
import { calcEquity, type PlayerSpec } from './equity.js';

export interface StreetEquity {
  /** Number of board cards revealed: 0 (preflop), 3 (flop), 4 (turn), 5 (river). */
  cards: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  /** Equity 0..1 per player, in input order. */
  equities: number[];
}

const STREET_NAMES = { 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' } as const;

/**
 * All-in equity for known hands at each street up to the given board.
 * `hands` are 2-card strings (e.g. "KsKc"); `board` is 0..5 cards. When the
 * river is complete the result is exact (no unknown cards remain).
 */
export function streetEquities(hands: string[], board = '', opts: { iterations?: number; seed?: number } = {}): StreetEquity[] {
  const b = parseCards(board);
  const players: PlayerSpec[] = hands.map((h) => ({ cards: h }));
  const points = ([0, 3, 4, 5] as const).filter((n) => n <= b.length);
  const out: StreetEquity[] = [];
  for (const n of points) {
    const partial = cardsToString(b.slice(0, n));
    // A complete board is deterministic, so a single pass is exact.
    const iterations = n === 5 ? 1 : opts.iterations ?? 30000;
    const res = calcEquity(players, { board: partial || undefined, iterations, seed: opts.seed ?? 7 });
    out.push({ cards: n, street: STREET_NAMES[n], equities: res.equities });
  }
  return out;
}
