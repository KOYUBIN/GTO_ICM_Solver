/**
 * Preflop GTO-approximation charts + a GTO-Wizard-style situation selector.
 *
 * The ranges below approximate published 100bb 6-max cash solutions. They are
 * a practical reference, not an exact solve — encoded as solver shorthand and
 * expanded through the range parser. Each spot can carry mixed frequencies via
 * the `:weight` syntax (e.g. "AJo:0.5").
 *
 * The situation model mirrors GTO Wizard's spot picker: pick a game type,
 * stack depth, hero position and an action line, and get back the strategy.
 */

import { parseRange } from './range.js';
import { simRfiRange } from './simdata.js';

export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';
export const POSITIONS_6MAX: Position[] = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];

export type GameType = 'cash' | 'mtt';
export type ActionLine = 'RFI' | 'vs-RFI' | 'RFI-vs-3bet';

export type PreflopAction = 'fold' | 'call' | 'raise';

/**
 * Where a strategy came from: a hand-authored chart, our own Monte-Carlo
 * simulation data (RFI at MTT depths), or the Chen-strength heuristic.
 */
export type ChartSource = 'chart' | 'heuristic' | 'sim';

/**
 * MTT stack depths covered by the self-simulation data (rfi-sim.json) that do
 * NOT have a hand-authored chart — RFI at these depths resolves to `source:
 * 'sim'`. 100bb is also simulated but keeps the hand chart.
 */
export const SIM_BACKED_STACKS = [5, 10, 15, 20, 25, 30, 40, 50, 70] as const;
export type SimBackedStackBB = (typeof SIM_BACKED_STACKS)[number];

export interface SituationSpec {
  gameType: GameType;
  /** Effective stack in big blinds. */
  stackBB: number;
  heroPos: Position;
  /**
   * The opener / aggressor the hero is responding to (for vs-RFI lines), or
   * the 3-bettor the hero faces after opening (for RFI-vs-3bet lines).
   */
  villainPos?: Position;
  line: ActionLine;
}

/** Strategy result: per 169-hand label -> action frequencies (summing to 1). */
export interface ChartStrategy<S extends ChartSource = ChartSource> {
  /** label -> { fold, call, raise } frequencies. */
  hands: Map<string, Record<PreflopAction, number>>;
  /** Short human description of the spot. */
  label: string;
  /** Whether this came from a stored chart, sim data or a heuristic fallback. */
  source: S;
}

/* ----------------------------------------------------------------------- *
 * 100bb 6-max RFI (open-raise) ranges — GTO approximation.
 * ----------------------------------------------------------------------- */

const RFI_100BB: Record<Position, string> = {
  UTG:
    '55+, A2s+, KTs+, QTs+, JTs, T9s, 98s, 87s, 76s, 65s, AJo+, KQo',
  MP:
    '44+, A2s+, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, ATo+, KJo+, QJo',
  CO:
    '22+, A2s+, K6s+, Q8s+, J8s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, 43s, A8o+, A5o-A2o, K9o+, Q9o+, J9o+, T9o, 98o',
  BTN:
    '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K7o+, Q8o+, J8o+, T8o+, 97o+, 87o, 76o',
  SB:
    '22+, A2s+, K4s+, Q6s+, J7s+, T7s+, 96s+, 85s+, 74s+, 64s+, 53s+, A2o+, K8o+, Q9o+, J9o+, T9o, 98o',
  // BB never "opens" (it can only defend); treated as no RFI.
  BB: '',
};

/* ----------------------------------------------------------------------- *
 * vs-RFI responses (heads-up to the raiser). For each (hero, villain) we
 * store a value-3bet range and a flat-call range; everything else folds.
 * These are approximations for the most common spots; missing spots fall
 * back to a heuristic.
 * ----------------------------------------------------------------------- */

interface VsRfiEntry {
  call: string;
  threeBet: string; // mix of value + bluffs
}

const VS_RFI_100BB: Partial<Record<`${Position}_${Position}`, VsRfiEntry>> = {
  // BB defending vs a steal.
  BB_BTN: {
    call:
      '22-99, A2s-A9s, K2s-KTs, Q4s-QTs, J6s-JTs, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, A2o-A9o, K8o-KJo, Q9o+, J9o+, T9o, 98o',
    threeBet: 'TT+, AJs+, A5s-A2s, KQs, AQo+, A5o:0.5, K9s:0.4',
  },
  BB_CO: {
    call:
      '22-99, A2s-ATs, K7s-KTs, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, A8o-ATo, KTo+, QTo+, JTo',
    threeBet: 'JJ+, AQs+, A5s-A4s, KQs, AKo, AQo:0.5',
  },
  BB_SB: {
    call:
      '22-TT, A2s-AJs, K5s-KTs, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o-ATo, K9o+, Q9o+, J9o+, T9o',
    threeBet: 'JJ+, AQs+, A5s-A2s, KJs+, AJo+, KQo, K9s:0.4',
  },
  // SB defending vs BTN.
  SB_BTN: {
    call: '55-TT, AJs-ATs, KTs-KQs, QTs+, JTs, AQo, KQo',
    threeBet: 'TT+, AJs+, A5s-A2s, KQs, AQo+, A4s:0.5',
  },
  // CO vs UTG / BTN vs CO etc. (IP cold-call/3bet).
  BTN_CO: {
    call: '22-TT, ATs-AJs, KTs+, QTs+, JTs, T9s, AQo, KQo',
    threeBet: 'JJ+, AQs+, A5s-A4s, KQs, AKo, A9s:0.4',
  },
  CO_UTG: {
    call: '55-JJ, AJs-AQs, KQs, QJs, JTs, AQo',
    threeBet: 'QQ+, AKs, AKo, A5s:0.5, KJs:0.4',
  },
};

/* ----------------------------------------------------------------------- *
 * RFI-vs-3bet responses: hero opened at heroPos, villain 3-bet from
 * villainPos, hero now responds (raise = 4bet, call, fold). Anchor charts
 * for the most common matchups at 100bb; other pairs use a heuristic.
 * 4bet ranges are premium value (QQ+/AK) plus A5s-type blocker bluffs;
 * calls are strong suited broadways / mid pairs; everything else folds.
 * ----------------------------------------------------------------------- */

interface RfiVs3betEntry {
  call: string;
  fourBet: string; // value + blocker bluffs
}

const RFI_VS_3BET_100BB: Partial<Record<`${Position}_${Position}`, RfiVs3betEntry>> = {
  // BTN opened, SB 3-bet (hero in position).
  BTN_SB: {
    fourBet: 'QQ+, AKs, AKo, A5s:0.5, A4s:0.35',
    call:
      'JJ-77, 66:0.5, AQs, AJs, ATs, A5s, KQs, KJs, KTs:0.5, QJs, JTs, T9s, 98s:0.5, AQo:0.6',
  },
  // BTN opened, BB 3-bet (BB 3bets more polar -> BTN defends wider).
  BTN_BB: {
    fourBet: 'QQ+, AKs, AKo, A5s:0.5, A4s:0.5, KJs:0.2',
    call:
      'JJ-55, AQs, AJs, ATs, A9s:0.5, A5s, A4s, KQs, KJs, KTs, QJs, QTs:0.5, JTs, T9s, 98s:0.5, AQo, AJo:0.5, KQo:0.5',
  },
  // CO opened, BTN 3-bet (hero out of position -> tighter flats).
  CO_BTN: {
    fourBet: 'QQ+, AKs, AKo, A5s:0.5, A4s:0.25',
    call:
      'JJ-88, 77:0.4, AQs, AJs, ATs:0.5, A5s:0.5, KQs, KJs:0.5, QJs:0.6, JTs:0.5, T9s:0.4, AQo:0.5',
  },
  // UTG opened, BB 3-bet (both ranges tight; hero continues narrow).
  UTG_BB: {
    fourBet: 'KK+, QQ:0.5, AKs, AKo:0.6, A5s:0.4',
    call: 'QQ, JJ, TT, 99:0.6, AQs+, AJs:0.5, ATs:0.3, A5s:0.6, KQs, QJs:0.3, JTs:0.4, AKo',
  },
};

/* ----------------------------------------------------------------------- */

function pureRaise(range: ReturnType<typeof parseRange>): Map<string, Record<PreflopAction, number>> {
  const out = new Map<string, Record<PreflopAction, number>>();
  for (const [label, w] of range) {
    out.set(label, { fold: 1 - w, call: 0, raise: w });
  }
  return out;
}

/** Build a facing-a-raise strategy from a call range + re-raise range. */
function buildResponse(callStr: string, raiseStr: string): Map<string, Record<PreflopAction, number>> {
  const call = parseRange(callStr);
  const raise = parseRange(raiseStr);
  const out = new Map<string, Record<PreflopAction, number>>();
  const labels = new Set([...call.keys(), ...raise.keys()]);
  for (const label of labels) {
    const r = raise.get(label) ?? 0;
    const c = (call.get(label) ?? 0) * (1 - r); // re-raise takes priority
    out.set(label, { fold: Math.max(0, 1 - r - c), call: c, raise: r });
  }
  return out;
}

/**
 * Heuristic response to a 3bet: continue with a tightened slice of the
 * opening range by hand strength — the top slice 4bets, the next calls,
 * everything else folds. Mirrors the Chen-strength style of the other
 * heuristics; per-label frequencies always sum to 1.
 */
function heuristicVs3bet(posOrder: number, stackBB: number): Map<string, Record<PreflopAction, number>> {
  const openPct = heuristicOpenPercent(posOrder, stackBB);
  const continuePct = Math.max(4, openPct * 0.38); // defend ~38% of opens
  const fourBetPct = Math.max(2.5, openPct * 0.11);
  const cont = topNByStrength(continuePct);
  const raise = topNByStrength(Math.min(fourBetPct, continuePct));
  const out = new Map<string, Record<PreflopAction, number>>();
  for (const [label, w] of cont) {
    const r = Math.min(w, raise.get(label) ?? 0);
    const c = Math.max(0, w - r);
    out.set(label, { fold: Math.max(0, 1 - r - c), call: c, raise: r });
  }
  return out;
}

/**
 * How far (in bb) a requested depth may sit from a simulated depth (or from
 * the 100bb hand chart) and still use that data instead of the heuristic.
 */
const SIM_STACK_TOLERANCE_BB = 2;

/**
 * The self-simulated RFI strategy for a position/depth, or null when the sim
 * data does not cover the requested depth (within the tolerance) or position.
 * Labels with simulated EV > 0 open at full frequency; everything else folds.
 */
function simRfiStrategy(heroPos: Position, stackBB: number): ChartStrategy | null {
  if (heroPos === 'BB') return null; // BB never opens
  let sim: ReturnType<typeof simRfiRange>;
  try {
    sim = simRfiRange(heroPos, stackBB);
  } catch {
    return null; // no simulated data at all (e.g. stub JSON before gen:preflop)
  }
  if (Math.abs(sim.stackBB - stackBB) > SIM_STACK_TOLERANCE_BB) return null;
  if (sim.labels.length === 0) return null;
  const hands = new Map<string, Record<PreflopAction, number>>();
  for (const label of sim.labels) hands.set(label, { fold: 0, call: 0, raise: 1 });
  const label =
    sim.model === 'shove-EV'
      ? `${heroPos} 올인 오픈 (자체 시뮬 푸시/폴드) · ${sim.stackBB}bb`
      : `${heroPos} 오픈 (자체 시뮬) · ${sim.stackBB}bb`;
  return { hands, label, source: 'sim' };
}

/**
 * Resolve a situation to a strategy. Uses stored charts when available, the
 * self-simulation data for RFI at MTT depths without a hand-authored chart,
 * and falls back to a Chen-strength heuristic (tightening for deeper stacks
 * and earlier positions) otherwise.
 *
 * Typing note: the first overload keeps `source` wide ('sim' possible) for
 * calls at sim-backed literal depths; the second keeps the historical
 * 'chart' | 'heuristic' type for 100bb-style call sites. At runtime a dynamic
 * non-literal `stackBB` that lands on a sim-backed depth still returns
 * `source: 'sim'` — annotate such results as `ChartStrategy` when narrowing
 * on the source.
 */
export function getChart(spec: SituationSpec & { stackBB: SimBackedStackBB }): ChartStrategy;
export function getChart(spec: SituationSpec): ChartStrategy<'chart' | 'heuristic'>;
export function getChart(spec: SituationSpec): ChartStrategy {
  const posOrder = POSITIONS_6MAX.indexOf(spec.heroPos);

  if (spec.line === 'RFI') {
    const str = RFI_100BB[spec.heroPos];
    // The hand-authored RFI charts are 100bb solutions — only use them there.
    if (str && Math.abs(spec.stackBB - 100) <= SIM_STACK_TOLERANCE_BB) {
      return {
        hands: pureRaise(parseRange(str)),
        label: `${spec.heroPos} RFI · ${spec.stackBB}bb`,
        source: 'chart',
      };
    }
    // Other depths: self-simulated RFI data when it covers the depth.
    const sim = simRfiStrategy(spec.heroPos, spec.stackBB);
    if (sim) return sim;
    // No sim coverage -> heuristic fallback below.
  }

  if (spec.line === 'vs-RFI' && spec.villainPos) {
    const key = `${spec.heroPos}_${spec.villainPos}` as const;
    const entry = VS_RFI_100BB[key];
    if (entry) {
      return {
        hands: buildResponse(entry.call, entry.threeBet),
        label: `${spec.heroPos} vs ${spec.villainPos} RFI · ${spec.stackBB}bb`,
        source: 'chart',
      };
    }
  }

  if (spec.line === 'RFI-vs-3bet') {
    if (spec.villainPos) {
      const key = `${spec.heroPos}_${spec.villainPos}` as const;
      const entry = RFI_VS_3BET_100BB[key];
      if (entry) {
        return {
          hands: buildResponse(entry.call, entry.fourBet),
          label: `${spec.heroPos} 오픈 vs ${spec.villainPos} 3벳 · ${spec.stackBB}bb`,
          source: 'chart',
        };
      }
    }
    // Heuristic: hand strength vs the 3-bettor's tightened range.
    return {
      hands: heuristicVs3bet(posOrder, spec.stackBB),
      label: `${spec.heroPos} 오픈 vs ${spec.villainPos ?? '?'} 3벳 · ${spec.stackBB}bb (근사)`,
      source: 'heuristic',
    };
  }

  // Heuristic fallback: open the top-N% based on position & stack depth.
  const openPct = heuristicOpenPercent(posOrder, spec.stackBB);
  return {
    hands: pureRaise(topNByStrength(openPct)),
    label: `${spec.heroPos} ${spec.line} · ${spec.stackBB}bb (근사)`,
    source: 'heuristic',
  };
}

function heuristicOpenPercent(posOrder: number, stackBB: number): number {
  // Later position -> wider; deeper -> a touch tighter for value clarity.
  const byPos = [15, 18, 27, 45, 40, 0][posOrder] ?? 20;
  const depthAdj = stackBB < 40 ? (40 - stackBB) * 0.3 : 0; // shorter = a bit wider shove-y
  return Math.min(85, byPos + depthAdj);
}

// Lazy import to avoid a cycle at module-eval time.
import { topPercentRange } from './preflop.js';
function topNByStrength(pct: number): ReturnType<typeof parseRange> {
  return topPercentRange(pct);
}

/** All RFI chart positions that have stored data. */
export function availableRfiPositions(): Position[] {
  return POSITIONS_6MAX.filter((p) => RFI_100BB[p]);
}

/** All stored vs-RFI matchups as [hero, villain] pairs. */
export function availableVsRfi(): [Position, Position][] {
  return Object.keys(VS_RFI_100BB).map((k) => k.split('_') as [Position, Position]);
}

/** All stored RFI-vs-3bet matchups (hero opened, villain 3-bet). */
export function availableRfiVs3bet(): { hero: Position; villain: Position }[] {
  return Object.keys(RFI_VS_3BET_100BB).map((k) => {
    const [hero, villain] = k.split('_') as [Position, Position];
    return { hero, villain };
  });
}
