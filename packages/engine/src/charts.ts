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

export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';
export const POSITIONS_6MAX: Position[] = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];

export type GameType = 'cash' | 'mtt';
export type ActionLine = 'RFI' | 'vs-RFI' | 'RFI-vs-3bet';

export type PreflopAction = 'fold' | 'call' | 'raise';

export interface SituationSpec {
  gameType: GameType;
  /** Effective stack in big blinds. */
  stackBB: number;
  heroPos: Position;
  /** The opener / aggressor the hero is responding to (for vs-RFI lines). */
  villainPos?: Position;
  line: ActionLine;
}

/** Strategy result: per 169-hand label -> action frequencies (summing to 1). */
export interface ChartStrategy {
  /** label -> { fold, call, raise } frequencies. */
  hands: Map<string, Record<PreflopAction, number>>;
  /** Short human description of the spot. */
  label: string;
  /** Whether this came from a stored chart or a heuristic fallback. */
  source: 'chart' | 'heuristic';
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

/* ----------------------------------------------------------------------- */

function pureRaise(range: ReturnType<typeof parseRange>): Map<string, Record<PreflopAction, number>> {
  const out = new Map<string, Record<PreflopAction, number>>();
  for (const [label, w] of range) {
    out.set(label, { fold: 1 - w, call: 0, raise: w });
  }
  return out;
}

/** Build a vs-RFI strategy from a call range + 3bet range. */
function buildResponse(entry: VsRfiEntry): Map<string, Record<PreflopAction, number>> {
  const call = parseRange(entry.call);
  const raise = parseRange(entry.threeBet);
  const out = new Map<string, Record<PreflopAction, number>>();
  const labels = new Set([...call.keys(), ...raise.keys()]);
  for (const label of labels) {
    const r = raise.get(label) ?? 0;
    const c = (call.get(label) ?? 0) * (1 - r); // 3bet takes priority
    out.set(label, { fold: Math.max(0, 1 - r - c), call: c, raise: r });
  }
  return out;
}

/**
 * Resolve a situation to a strategy. Uses stored charts when available and
 * falls back to a Chen-strength heuristic (tightening for deeper stacks and
 * earlier positions) otherwise.
 */
export function getChart(spec: SituationSpec): ChartStrategy {
  const posOrder = POSITIONS_6MAX.indexOf(spec.heroPos);

  if (spec.line === 'RFI') {
    const str = RFI_100BB[spec.heroPos];
    if (str) {
      return {
        hands: pureRaise(parseRange(str)),
        label: `${spec.heroPos} RFI · ${spec.stackBB}bb`,
        source: 'chart',
      };
    }
  }

  if (spec.line === 'vs-RFI' && spec.villainPos) {
    const key = `${spec.heroPos}_${spec.villainPos}` as const;
    const entry = VS_RFI_100BB[key];
    if (entry) {
      return {
        hands: buildResponse(entry),
        label: `${spec.heroPos} vs ${spec.villainPos} RFI · ${spec.stackBB}bb`,
        source: 'chart',
      };
    }
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
