/**
 * Self-simulated preflop RFI data (Monte-Carlo chip-EV).
 *
 * The JSON consumed here is produced by our own pipeline
 * (`scripts/gen-preflop.mjs`): for every 6-max open position and stack depth
 * it scores all 169 starting hands with `openRaiseEv` against a
 * position-keyed continue range. Regenerate with:
 *
 *   npm run build:engine && npm run gen:preflop -w @gto/engine
 *
 * Honest caveat: this is a chip-EV Monte-Carlo approximation (single caller,
 * heuristic continue ranges and equity realization) — NOT a full GTO
 * equilibrium. See DATA_SOURCES.md at the repo root for full provenance.
 */

import rfiSim from './generated/rfi-sim.json' with { type: 'json' };

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

  const table = file.data[`${position}-${nearest}`];
  const labels = Object.keys(table)
    .filter((l) => table[l] > 0)
    .sort((a, b) => table[b] - table[a]);

  return {
    position,
    stackBB: nearest,
    requestedStackBB: stackBB,
    labels,
    evOf: (label: string): number | undefined => table[label],
    meta: file.meta,
  };
}
