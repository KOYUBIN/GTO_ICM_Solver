/**
 * Exact equity by full enumeration of the remaining board.
 *
 * This is the "ground truth" that Monte-Carlo equity converges toward. It is
 * used by the learning lab to measure Monte-Carlo error vs sample size. For
 * heads-up with no board this enumerates C(48,5) ≈ 1.7M runouts, so it is a
 * tool/offline function rather than something to call on every UI keystroke.
 */

import { Card, fullDeck, parseCards } from './cards.js';
import { evaluate7 } from './handEval.js';

export interface ExactEquityResult {
  equities: [number, number];
  wins: [number, number];
  ties: number;
  combinations: number;
}

/** Exact heads-up equity for two known hands with an optional partial board. */
export function exactEquity(hero: string, villain: string, board = ''): ExactEquityResult {
  const h = parseCards(hero);
  const v = parseCards(villain);
  const b = board ? parseCards(board) : [];
  const used = new Set<number>([...h, ...v, ...b]);
  const remaining = fullDeck().filter((c) => !used.has(c));
  const need = 5 - b.length;

  let win0 = 0;
  let win1 = 0;
  let tie = 0;
  let count = 0;

  const pick: Card[] = [];
  const recurse = (start: number, depth: number) => {
    if (depth === need) {
      const full = [...b, ...pick];
      const s0 = evaluate7([h[0], h[1], ...full]);
      const s1 = evaluate7([v[0], v[1], ...full]);
      if (s0 > s1) win0++;
      else if (s1 > s0) win1++;
      else tie++;
      count++;
      return;
    }
    for (let i = start; i < remaining.length; i++) {
      pick.push(remaining[i]);
      recurse(i + 1, depth + 1);
      pick.pop();
    }
  };
  recurse(0, 0);

  const total = count || 1;
  return {
    equities: [(win0 + tie / 2) / total, (win1 + tie / 2) / total],
    wins: [win0, win1],
    ties: tie,
    combinations: count,
  };
}
