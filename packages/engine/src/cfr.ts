/**
 * River solver via Monte-Carlo Counterfactual Regret Minimization (MCCFR,
 * external sampling).
 *
 * This solves a simplified single-bet river spot between two ranges on a fixed
 * board, converging toward the Nash strategy. The river is a perfect-
 * information showdown (no future cards), so payoffs are exact — which makes
 * this an ideal, self-contained teaching example of how solvers actually work.
 *
 * Tree (OOP = out-of-position acts first):
 *   OOP: check | bet
 *     after OOP check  -> IP: check (showdown) | bet -> OOP: fold | call
 *     after OOP bet    -> IP: fold | call (showdown)
 */

import { parseCards, mulberry32 } from './cards.js';
import { evaluate7 } from './handEval.js';
import { Combo } from './range.js';

type Player = 0 | 1; // 0 = OOP, 1 = IP

interface TerminalNode {
  kind: 'term';
  /** payoff(p0Score, p1Score) -> [oopPayoff, ipPayoff]. */
  payoff: (s0: number, s1: number) => [number, number];
}

interface DecisionNode {
  kind: 'dec';
  id: string;
  player: Player;
  actions: string[];
  children: (TerminalNode | DecisionNode)[];
}

type Node = TerminalNode | DecisionNode;

function buildTree(pot: number, bet: number): DecisionNode {
  // Showdown over the given street investments.
  const showdown = (inv0: number, inv1: number): TerminalNode => ({
    kind: 'term',
    payoff: (s0, s1) => {
      const total = pot + inv0 + inv1;
      if (s0 > s1) return [total - inv0, -inv1];
      if (s1 > s0) return [-inv0, total - inv1];
      return [total / 2 - inv0, total / 2 - inv1];
    },
  });
  // A fold by `folder` who has invested `invF`; opponent wins the dead pot.
  const fold = (folder: Player, invF: number): TerminalNode => ({
    kind: 'term',
    payoff: () => (folder === 0 ? [-invF, pot + invF] : [pot + invF, -invF]),
  });

  return {
    kind: 'dec',
    id: 'R',
    player: 0,
    actions: ['check', 'bet'],
    children: [
      // OOP check -> IP decides.
      {
        kind: 'dec',
        id: 'R.x',
        player: 1,
        actions: ['check', 'bet'],
        children: [
          showdown(0, 0),
          // IP bets -> OOP fold|call.
          {
            kind: 'dec',
            id: 'R.x.b',
            player: 0,
            actions: ['fold', 'call'],
            children: [fold(0, 0), showdown(bet, bet)],
          },
        ],
      },
      // OOP bet -> IP fold|call.
      {
        kind: 'dec',
        id: 'R.b',
        player: 1,
        actions: ['fold', 'call'],
        children: [fold(1, 0), showdown(bet, bet)],
      },
    ],
  };
}

interface InfosetData {
  regret: number[];
  stratSum: number[];
}

export interface RiverSolveConfig {
  board: string; // exactly 5 cards
  oopRange: Combo[];
  ipRange: Combo[];
  pot: number;
  betFraction?: number; // bet size as fraction of pot (default 0.75)
  iterations?: number;
  seed?: number;
}

export interface RiverSolveResult {
  /** OOP root strategy aggregated to hand labels: label -> {check, bet}. */
  oopStrategy: { combo: Combo; check: number; bet: number }[];
  /** Aggregate frequencies across the OOP range. */
  oopBetFreq: number;
  /** IP response vs a bet: fold/call aggregate. */
  ipCallVsBetFreq: number;
  /** Expected value for OOP (chips) under the solved average strategies. */
  oopEV: number;
  iterations: number;
}

function regretMatch(node: InfosetData, nActions: number): number[] {
  let sum = 0;
  const s = new Array(nActions);
  for (let a = 0; a < nActions; a++) {
    s[a] = node.regret[a] > 0 ? node.regret[a] : 0;
    sum += s[a];
  }
  if (sum > 0) for (let a = 0; a < nActions; a++) s[a] /= sum;
  else for (let a = 0; a < nActions; a++) s[a] = 1 / nActions;
  return s;
}

export function solveRiver(config: RiverSolveConfig): RiverSolveResult {
  const board = parseCards(config.board);
  if (board.length !== 5) throw new Error('River solve needs exactly 5 board cards.');
  const boardSet = new Set(board);
  const bet = config.pot * (config.betFraction ?? 0.75);
  const tree = buildTree(config.pot, bet);
  const iterations = config.iterations ?? 20000;
  const rnd = mulberry32(config.seed ?? 0x5eed);

  // Filter ranges to combos that don't clash with the board.
  const oop = config.oopRange.filter((c) => !boardSet.has(c[0]) && !boardSet.has(c[1]));
  const ip = config.ipRange.filter((c) => !boardSet.has(c[0]) && !boardSet.has(c[1]));
  if (!oop.length || !ip.length) throw new Error('Ranges are empty after board removal.');

  // Precompute showdown scores per combo.
  const scoreOf = (c: Combo) => evaluate7([c[0], c[1], ...board]);
  const oopScore = oop.map(scoreOf);
  const ipScore = ip.map(scoreOf);

  const infosets = new Map<string, InfosetData>();
  const getInfoset = (id: string, player: Player, handIdx: number, n: number): InfosetData => {
    const key = `${id}|${player}|${handIdx}`;
    let d = infosets.get(key);
    if (!d) {
      d = { regret: new Array(n).fill(0), stratSum: new Array(n).fill(0) };
      infosets.set(key, d);
    }
    return d;
  };

  // External-sampling MCCFR walk for traverser `tr`, at iteration `t`.
  // Uses two CFR+ refinements: regret-matching+ (regrets floored at 0) and
  // linear averaging (strategy contributions weighted by iteration), which
  // speed up convergence over vanilla CFR.
  function walk(node: Node, tr: Player, h0: number, h1: number, t: number): number {
    if (node.kind === 'term') {
      const [p0, p1] = node.payoff(oopScore[h0], ipScore[h1]);
      return tr === 0 ? p0 : p1;
    }
    const hand = node.player === 0 ? h0 : h1;
    const data = getInfoset(node.id, node.player, hand, node.actions.length);
    const strat = regretMatch(data, node.actions.length);

    if (node.player === tr) {
      const util = new Array(node.actions.length);
      let nodeUtil = 0;
      for (let a = 0; a < node.actions.length; a++) {
        util[a] = walk(node.children[a], tr, h0, h1, t);
        nodeUtil += strat[a] * util[a];
      }
      for (let a = 0; a < node.actions.length; a++) {
        // Regret-matching+: keep cumulative regret non-negative.
        data.regret[a] = Math.max(0, data.regret[a] + (util[a] - nodeUtil));
      }
      return nodeUtil;
    } else {
      // Opponent node: accumulate (linearly weighted) average strategy and
      // sample one action.
      for (let a = 0; a < node.actions.length; a++) data.stratSum[a] += t * strat[a];
      let r = rnd();
      let a = 0;
      for (; a < node.actions.length - 1; a++) {
        if (r < strat[a]) break;
        r -= strat[a];
      }
      return walk(node.children[a], tr, h0, h1, t);
    }
  }

  // Sample a non-conflicting (oop, ip) hand pair.
  function sampleHands(): [number, number] {
    for (;;) {
      const i = (rnd() * oop.length) | 0;
      const j = (rnd() * ip.length) | 0;
      const a = oop[i];
      const b = ip[j];
      if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) return [i, j];
    }
  }

  for (let it = 0; it < iterations; it++) {
    const [h0, h1] = sampleHands();
    walk(tree, 0, h0, h1, it + 1);
    walk(tree, 1, h0, h1, it + 1);
  }

  // --- Reporting: read average strategies and compute exact EV/frequencies. ---
  const avg = (id: string, player: Player, handIdx: number, n: number): number[] => {
    const d = infosets.get(`${id}|${player}|${handIdx}`);
    if (!d) return new Array(n).fill(1 / n);
    const sum = d.stratSum.reduce((x, y) => x + y, 0);
    if (sum <= 0) return new Array(n).fill(1 / n);
    return d.stratSum.map((x) => x / sum);
  };

  // Exact EV for OOP and aggregate frequencies over all valid hand pairs.
  let evSum = 0;
  let pairCount = 0;
  let betWeighted = 0;
  let oopHandWeight = 0;
  let ipCallWeighted = 0;
  let ipBetFacedWeight = 0;

  function evP0(node: Node, h0: number, h1: number): number {
    if (node.kind === 'term') {
      const [p0] = node.payoff(oopScore[h0], ipScore[h1]);
      return p0;
    }
    const hand = node.player === 0 ? h0 : h1;
    const s = avg(node.id, node.player, hand, node.actions.length);
    let v = 0;
    for (let a = 0; a < node.actions.length; a++) v += s[a] * evP0(node.children[a], h0, h1);
    return v;
  }

  for (let i = 0; i < oop.length; i++) {
    const a = oop[i];
    const rootStrat = avg('R', 0, i, 2);
    for (let j = 0; j < ip.length; j++) {
      const b = ip[j];
      if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;
      evSum += evP0(tree, i, j);
      pairCount++;
    }
    betWeighted += rootStrat[1];
    oopHandWeight += 1;
  }

  // IP call-vs-bet frequency (facing the OOP bet line "R.b").
  for (let j = 0; j < ip.length; j++) {
    const s = avg('R.b', 1, j, 2); // [fold, call]
    ipCallWeighted += s[1];
    ipBetFacedWeight += 1;
  }

  const oopStrategy = oop.map((combo, i) => {
    const s = avg('R', 0, i, 2);
    return { combo, check: s[0], bet: s[1] };
  });

  return {
    oopStrategy,
    oopBetFreq: oopHandWeight ? betWeighted / oopHandWeight : 0,
    ipCallVsBetFreq: ipBetFacedWeight ? ipCallWeighted / ipBetFacedWeight : 0,
    oopEV: pairCount ? evSum / pairCount : 0,
    iterations,
  };
}
