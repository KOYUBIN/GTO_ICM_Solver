/**
 * Self-simulated preflop RFI data (Monte-Carlo chip-EV).
 *
 * The JSON consumed here is produced by our own pipeline
 * (`scripts/gen-preflop.mjs`): for every 6-max open position and MTT stack
 * depth (5-100bb) it scores all 169 starting hands with a depth-aware model —
 * `openRaiseEv` against a position-keyed continue range at 20bb+ ("raise-EV")
 * and a push/fold `shoveEv` against a position-keyed calling range at 15bb
 * and below ("shove-EV"). Regenerate with:
 *
 *   npm run build:engine && npm run gen:preflop -w @gto/engine
 *
 * Honest caveat: this is a chip-EV Monte-Carlo approximation (single caller,
 * heuristic continue/call ranges and equity realization) — NOT a full GTO
 * equilibrium. See DATA_SOURCES.md at the repo root for full provenance.
 */

import rfiSim from './generated/rfi-sim.json' with { type: 'json' };

/** Which EV model produced a simulated block. */
export type SimRfiModel = 'shove-EV' | 'raise-EV';

export interface SimRfiMeta {
  generatedAt: string;
  /** Monte-Carlo iterations per hand evaluation. */
  iterationsPerHand: number;
  model: string;
  raiseTo?: number;
  potBB?: number;
  handsEvaluated?: number;
  /** Total board rollouts = handsEvaluated x iterationsPerHand. */
  totalIterations?: number;
}

interface SimRfiFile {
  meta: SimRfiMeta;
  /** `${position}-${stackBB}` -> which EV model scored that block. */
  blockMeta?: Record<string, string>;
  /** `${position}-${stackBB}` -> label -> EV in bb (fold = 0). */
  data: Record<string, Record<string, number>>;
}

const file = rfiSim as unknown as SimRfiFile;

export type SimPosition = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB';

export interface SimRfiRange {
  position: string;
  /** Simulated stack depth actually used (nearest available). */
  stackBB: number;
  /** The depth the caller asked for. */
  requestedStackBB: number;
  /**
   * EV model behind this block: 'shove-EV' = push/fold (the open is an
   * all-in), 'raise-EV' = small open raise vs a continue range.
   */
  model: SimRfiModel;
  /** Derived RFI range: every label with simulated EV > 0, best EV first. */
  labels: string[];
  /** Simulated open EV (bb) for a label, or undefined if unknown. */
  evOf(label: string): number | undefined;
  meta: SimRfiMeta;
}

/** Stack depths available in the simulated data for a position, ascending. */
export function simRfiStacks(position: string): number[] {
  const prefix = `${position}-`;
  return Object.keys(file.data)
    .filter((k) => k.startsWith(prefix))
    .map((k) => Number(k.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/**
 * The self-simulated RFI range for a position at (the nearest simulated)
 * stack depth. Throws if the position has no simulated data at all.
 */
export function simRfiRange(position: SimPosition | string, stackBB: number): SimRfiRange {
  const stacks = simRfiStacks(position);
  if (stacks.length === 0) {
    throw new Error(`No simulated RFI data for position "${position}" — run gen:preflop first`);
  }

  let nearest = stacks[0];
  for (const s of stacks) {
    if (Math.abs(s - stackBB) < Math.abs(nearest - stackBB)) nearest = s;
  }

  const key = `${position}-${nearest}`;
  const table = file.data[key];
  const labels = Object.keys(table)
    .filter((l) => table[l] > 0)
    .sort((a, b) => table[b] - table[a]);

  // Per-block model from the JSON; older files without blockMeta fall back to
  // the pipeline's depth rule (<= 15bb blocks are push/fold).
  const raw = file.blockMeta?.[key];
  const model: SimRfiModel =
    raw === 'shove-EV' || raw === 'raise-EV' ? raw : nearest <= 15 ? 'shove-EV' : 'raise-EV';

  return {
    position,
    stackBB: nearest,
    requestedStackBB: stackBB,
    model,
    labels,
    evOf: (label: string): number | undefined => table[label],
    meta: file.meta,
  };
}
