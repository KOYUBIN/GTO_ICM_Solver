/**
 * Equity calculation via Monte-Carlo simulation.
 *
 * Supports hand-vs-hand and hand-vs-range, with an optional fixed board.
 * Returns win / tie / equity for each player. "Equity" splits ties evenly.
 */

import { Card, fullDeck, mulberry32, parseCards } from './cards.js';
import { evaluate7 } from './handEval.js';
import { Combo, rangeToCombos } from './range.js';

export interface EquityResult {
  equities: number[]; // 0..1 per player, sums to ~1
  wins: number[];
  ties: number[];
  iterations: number;
}

export interface PlayerSpec {
  /** Exact hole cards, e.g. "AsKh". */
  cards?: string;
  /** Or a weighted set of combos (e.g. expanded from a range). */
  combos?: Combo[];
}

export interface EquityOptions {
  board?: string; // 0, 3, 4 or 5 community cards
  iterations?: number;
  seed?: number;
}

function pickFromDeck(available: Card[], rnd: () => number, used: Set<number>): Card {
  // Rejection sampling against already-used cards.
  for (;;) {
    const c = available[(rnd() * available.length) | 0];
    if (!used.has(c)) return c;
  }
}

export function calcEquity(players: PlayerSpec[], opts: EquityOptions = {}): EquityResult {
  const iterations = opts.iterations ?? 25000;
  const rnd = mulberry32(opts.seed ?? (Math.random() * 2 ** 31) | 0);
  const fixedBoard = opts.board ? parseCards(opts.board) : [];

  const n = players.length;
  const wins = new Array(n).fill(0);
  const ties = new Array(n).fill(0);
  const equities = new Array(n).fill(0);

  // Pre-expand combos for each player.
  const playerCombos: Combo[][] = players.map((p) => {
    if (p.cards) return [parseCards(p.cards) as Combo];
    if (p.combos && p.combos.length) return p.combos;
    throw new Error('Each player needs cards or combos');
  });

  const deck = fullDeck();

  for (let it = 0; it < iterations; it++) {
    const used = new Set<number>();
    let valid = true;
    const holes: Combo[] = [];

    // Deal each player's hole cards (sampling a combo, skipping conflicts).
    for (let p = 0; p < n; p++) {
      const choices = playerCombos[p];
      let chosen: Combo | null = null;
      for (let tries = 0; tries < 20; tries++) {
        const cand = choices[(rnd() * choices.length) | 0];
        if (!used.has(cand[0]) && !used.has(cand[1])) {
          chosen = cand;
          break;
        }
      }
      if (!chosen) {
        valid = false;
        break;
      }
      used.add(chosen[0]);
      used.add(chosen[1]);
      holes.push(chosen);
    }
    if (!valid) continue;

    // Board: keep fixed cards, fill the rest randomly.
    const board: Card[] = [];
    for (const c of fixedBoard) {
      used.add(c);
      board.push(c);
    }
    while (board.length < 5) {
      const c = pickFromDeck(deck, rnd, used);
      used.add(c);
      board.push(c);
    }

    // Score and award.
    let best = -1;
    let bestPlayers: number[] = [];
    for (let p = 0; p < n; p++) {
      const score = evaluate7([holes[p][0], holes[p][1], ...board]);
      if (score > best) {
        best = score;
        bestPlayers = [p];
      } else if (score === best) {
        bestPlayers.push(p);
      }
    }

    if (bestPlayers.length === 1) {
      wins[bestPlayers[0]]++;
      equities[bestPlayers[0]] += 1;
    } else {
      const share = 1 / bestPlayers.length;
      for (const p of bestPlayers) {
        ties[p]++;
        equities[p] += share;
      }
    }
  }

  const total = equities.reduce((a, b) => a + b, 0) || 1;
  return {
    equities: equities.map((e) => e / total),
    wins,
    ties,
    iterations,
  };
}

/** Convenience: equity for a single hand against one or more ranges. */
export function equityVsRanges(
  hero: string,
  villainRanges: Map<string, number>[],
  opts: EquityOptions = {},
): EquityResult {
  const players: PlayerSpec[] = [
    { cards: hero },
    ...villainRanges.map((r) => ({ combos: rangeToCombos(r).map((x) => x.combo) })),
  ];
  return calcEquity(players, opts);
}
