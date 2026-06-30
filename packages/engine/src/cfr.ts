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
    for (let iter = 0; iter < 10000; iter++) {
      const i = (rnd() * oop.length) | 0;
      const j = (rnd() * ip.length) | 0;
      const a = oop[i];
      const b = ip[j];
      if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) return [i, j];
    }
    throw new Error('서로 충돌하지 않는 핸드 조합을 찾을 수 없습니다. 레인지를 확인해주세요.');
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

/* ======================================================================= *
 * Multi-street postflop solver (flop / turn / river) via MCCFR with chance
 * sampling. Non-river streets, once betting closes, deal the next board card
 * at a chance node and recurse into the next street's betting tree. Single
 * bet size per street (no raises) and no stack/all-in modeling, so it is an
 * approximation — but it genuinely solves flop→turn→river, not just the river.
 * The reported strategy is the first (input) street's OOP decision, which is
 * visited every iteration and so converges best.
 * ======================================================================= */

export interface PostflopSolveConfig {
  board: string; // 3, 4, or 5 cards
  oopRange: Combo[];
  ipRange: Combo[];
  pot: number;
  betFraction?: number; // bet as a fraction of the pot (default 0.66)
  iterations?: number;
  seed?: number;
}

export interface PostflopSolveResult {
  street: 'flop' | 'turn' | 'river';
  /** OOP strategy on the input street, per combo. */
  oopStrategy: { combo: Combo; check: number; bet: number }[];
  oopBetFreq: number;
  ipCallVsBetFreq: number;
  oopEV: number;
  iterations: number;
}

export function solvePostflop(config: PostflopSolveConfig): PostflopSolveResult {
  const initBoard = parseCards(config.board);
  if (![3, 4, 5].includes(initBoard.length)) throw new Error('보드는 3, 4, 5장이어야 합니다.');
  const betFraction = config.betFraction ?? 0.66;
  const iterations = config.iterations ?? 20000;
  const rnd = mulberry32(config.seed ?? 0x51b3);
  const deadPot = config.pot;

  const boardSet0 = new Set(initBoard);
  const oop = config.oopRange.filter((c) => !boardSet0.has(c[0]) && !boardSet0.has(c[1]));
  const ip = config.ipRange.filter((c) => !boardSet0.has(c[0]) && !boardSet0.has(c[1]));
  if (!oop.length || !ip.length) throw new Error('보드 제거 후 레인지가 비었습니다.');

  interface Info {
    regret: number[];
    strat: number[];
  }
  const infosets = new Map<string, Info>();
  const getInfo = (key: string): Info => {
    let d = infosets.get(key);
    if (!d) {
      d = { regret: [0, 0], strat: [0, 0] };
      infosets.set(key, d);
    }
    return d;
  };
  const regretMatch = (d: Info): [number, number] => {
    const r0 = d.regret[0] > 0 ? d.regret[0] : 0;
    const r1 = d.regret[1] > 0 ? d.regret[1] : 0;
    const s = r0 + r1;
    return s > 0 ? [r0 / s, r1 / s] : [0.5, 0.5];
  };
  const sampleCard = (used: Set<number>): number => {
    for (;;) {
      const c = (rnd() * 52) | 0;
      if (!used.has(c)) return c;
    }
  };
  const handKey = (player: Player, h0: Combo, h1: Combo) =>
    player === 0 ? `${h0[0]}.${h0[1]}` : `${h1[0]}.${h1[1]}`;

  function payoff(c0: number, c1: number, winner: Player | 'tie', tr: Player): number {
    const total = deadPot + c0 + c1;
    const cTr = tr === 0 ? c0 : c1;
    if (winner === 'tie') return total / 2 - cTr;
    return (winner === tr ? total : 0) - cTr;
  }

  function closeStreet(board: number[], c0: number, c1: number, hist: string, tr: Player, h0: Combo, h1: Combo, t: number): number {
    if (board.length === 5) {
      const s0 = evaluate7([h0[0], h0[1], ...board]);
      const s1 = evaluate7([h1[0], h1[1], ...board]);
      const w: Player | 'tie' = s0 > s1 ? 0 : s1 > s0 ? 1 : 'tie';
      return payoff(c0, c1, w, tr);
    }
    const used = new Set<number>([...board, h0[0], h0[1], h1[0], h1[1]]);
    const nb = [...board, sampleCard(used)];
    return cfr(nb, c0, c1, 0, false, hist + '/', tr, h0, h1, t);
  }

  function cfr(board: number[], c0: number, c1: number, player: Player, facing: boolean, hist: string, tr: Player, h0: Combo, h1: Combo, t: number): number {
    const key = `${board.join('-')}|${hist}|${player}|${handKey(player, h0, h1)}`;
    const d = getInfo(key);
    const strat = regretMatch(d);

    const act = (a: number): number => {
      if (!facing) {
        if (a === 0) {
          return player === 0
            ? cfr(board, c0, c1, 1, false, hist + 'x', tr, h0, h1, t)
            : closeStreet(board, c0, c1, hist + 'x', tr, h0, h1, t);
        }
        const bet = Math.max(1, Math.round((deadPot + c0 + c1) * betFraction));
        return player === 0
          ? cfr(board, c0 + bet, c1, 1, true, hist + 'b', tr, h0, h1, t)
          : cfr(board, c0, c1 + bet, 0, true, hist + 'b', tr, h0, h1, t);
      }
      if (a === 0) return payoff(c0, c1, player === 0 ? 1 : 0, tr); // fold
      return player === 0
        ? closeStreet(board, c1, c1, hist + 'c', tr, h0, h1, t)
        : closeStreet(board, c0, c0, hist + 'c', tr, h0, h1, t);
    };

    if (player === tr) {
      const u0 = act(0);
      const u1 = act(1);
      const nodeUtil = strat[0] * u0 + strat[1] * u1;
      d.regret[0] = Math.max(0, d.regret[0] + (u0 - nodeUtil));
      d.regret[1] = Math.max(0, d.regret[1] + (u1 - nodeUtil));
      return nodeUtil;
    }
    d.strat[0] += t * strat[0];
    d.strat[1] += t * strat[1];
    return act(rnd() < strat[0] ? 0 : 1);
  }

  function sampleHands(): [Combo, Combo] {
    for (let iter = 0; iter < 10000; iter++) {
      const a = oop[(rnd() * oop.length) | 0];
      const b = ip[(rnd() * ip.length) | 0];
      if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) return [a, b];
    }
    throw new Error('서로 충돌하지 않는 핸드 조합을 찾을 수 없습니다. 레인지를 확인해주세요.');
  }

  for (let it = 0; it < iterations; it++) {
    const [h0, h1] = sampleHands();
    cfr(initBoard, 0, 0, 0, false, '', 0, h0, h1, it + 1);
    cfr(initBoard, 0, 0, 0, false, '', 1, h0, h1, it + 1);
  }

  const avg = (key: string): [number, number] => {
    const d = infosets.get(key);
    if (!d) return [0.5, 0.5];
    const s = d.strat[0] + d.strat[1];
    return s > 0 ? [d.strat[0] / s, d.strat[1] / s] : [0.5, 0.5];
  };
  const base = initBoard.join('-');
  const oopStrategy = oop.map((combo) => {
    const [check, bet] = avg(`${base}||0|${combo[0]}.${combo[1]}`);
    return { combo, check, bet };
  });
  const oopBetFreq = oopStrategy.reduce((s, r) => s + r.bet, 0) / (oopStrategy.length || 1);
  let ipCall = 0;
  for (const combo of ip) ipCall += avg(`${base}|b|1|${combo[0]}.${combo[1]}`)[1];
  const ipCallVsBetFreq = ip.length ? ipCall / ip.length : 0;

  // EV (for OOP) estimated by playing the average strategy over sampled runouts.
  function playEV(board: number[], c0: number, c1: number, player: Player, facing: boolean, hist: string, h0: Combo, h1: Combo): number {
    const s = avg(`${board.join('-')}|${hist}|${player}|${handKey(player, h0, h1)}`);
    const a = rnd() < s[0] ? 0 : 1;
    if (!facing) {
      if (a === 0)
        return player === 0 ? playEV(board, c0, c1, 1, false, hist + 'x', h0, h1) : closeEV(board, c0, c1, hist + 'x', h0, h1);
      const bet = Math.max(1, Math.round((deadPot + c0 + c1) * betFraction));
      return player === 0
        ? playEV(board, c0 + bet, c1, 1, true, hist + 'b', h0, h1)
        : playEV(board, c0, c1 + bet, 0, true, hist + 'b', h0, h1);
    }
    if (a === 0) {
      const total = deadPot + c0 + c1;
      return player === 1 ? total - c0 : -c0; // OOP net on a fold
    }
    return player === 0 ? closeEV(board, c1, c1, hist + 'c', h0, h1) : closeEV(board, c0, c0, hist + 'c', h0, h1);
  }
  function closeEV(board: number[], c0: number, c1: number, hist: string, h0: Combo, h1: Combo): number {
    const total = deadPot + c0 + c1;
    if (board.length === 5) {
      const a0 = evaluate7([h0[0], h0[1], ...board]);
      const a1 = evaluate7([h1[0], h1[1], ...board]);
      if (a0 > a1) return total - c0;
      if (a1 > a0) return -c0;
      return total / 2 - c0;
    }
    const used = new Set<number>([...board, h0[0], h0[1], h1[0], h1[1]]);
    return playEV([...board, sampleCard(used)], c0, c1, 0, false, hist + '/', h0, h1);
  }

  let evSum = 0;
  const evIters = 8000;
  for (let i = 0; i < evIters; i++) {
    const [h0, h1] = sampleHands();
    evSum += playEV(initBoard, 0, 0, 0, false, '', h0, h1);
  }

  return {
    street: initBoard.length === 5 ? 'river' : initBoard.length === 4 ? 'turn' : 'flop',
    oopStrategy,
    oopBetFreq,
    ipCallVsBetFreq,
    oopEV: evSum / evIters,
    iterations,
  };
}
