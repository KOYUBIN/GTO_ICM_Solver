/**
 * Spot EV — practical chip-EV approximations for the GTO-Wizard-style
 * "Strategy + EV" view.
 *
 * These are approximations (a push/fold chip-EV model), not exact solver
 * output. They give each hand a defensible shove-vs-fold EV by combining:
 *   - fold equity: probability everyone behind folds, from an assumed call %
 *   - showdown equity: the hand's equity against that calling range
 * Postflop-heavy lines (small raises) are out of scope for this estimate.
 */

import { topPercentRange } from './preflop.js';
import { labelToCombos } from './range.js';
import { cardsToString } from './cards.js';
import { equityVsRanges } from './equity.js';

export interface ShoveEvParams {
  /** Effective stack the hero risks, in big blinds. */
  stackBB: number;
  /** Dead money already in the middle (blinds + antes), in bb. Default 1.5. */
  potBB?: number;
  /** Villains call a shove with the top this-% of hands. */
  callPercent: number;
  /** Number of players left to act who could call. */
  playersBehind: number;
  /** Monte-Carlo iterations for the equity term. */
  iterations?: number;
  seed?: number;
}

export interface ShoveEvResult {
  /** Chip EV of shoving, in bb (relative to folding = 0). */
  evShove: number;
  /** EV of folding (baseline). */
  evFold: number;
  /** Probability the table folds to the shove. */
  foldEquity: number;
  /** Hero equity vs the assumed calling range. */
  equityVsCall: number;
  /** 'shove' when evShove > evFold, else 'fold'. */
  best: 'shove' | 'fold';
}

/**
 * Approximate shove EV for a starting-hand class (e.g. "AKs", "99", "72o").
 *
 *   EV(shove) = fe * pot + (1 - fe) * ( eq * (pot + 2*stack) - stack )
 *   EV(fold)  = 0
 */
export function shoveEv(label: string, p: ShoveEvParams): ShoveEvResult {
  const potBB = p.potBB ?? 1.5;
  const callRange = topPercentRange(p.callPercent);
  const combos = labelToCombos(label);
  const hero = cardsToString(combos[0]); // representative combo (preflop ~ symmetric)

  const eq = equityVsRanges(hero, [callRange], {
    iterations: p.iterations ?? 4000,
    seed: p.seed ?? 2024,
  });
  const equityVsCall = eq.equities[0];

  const callFrac = Math.max(0, Math.min(1, p.callPercent / 100));
  const foldEquity = Math.pow(1 - callFrac, Math.max(1, p.playersBehind));

  const evShove =
    foldEquity * potBB + (1 - foldEquity) * (equityVsCall * (potBB + 2 * p.stackBB) - p.stackBB);

  return {
    evShove,
    evFold: 0,
    foldEquity,
    equityVsCall,
    best: evShove > 0 ? 'shove' : 'fold',
  };
}

export interface RaiseEvParams {
  /** Raise size in bb (e.g. 2.5). */
  raiseTo: number;
  /** Dead money already in the middle (blinds + antes), in bb. Default 1.5. */
  potBB?: number;
  /** Players behind continue (call/3bet) with the top this-% of hands. */
  continuePercent: number;
  /** Number of players left to act. */
  playersBehind: number;
  /**
   * Equity-realization factor when called (postflop): how much of raw equity
   * the hero actually realizes. ~0.85 in position, less out of position.
   */
  realization?: number;
  iterations?: number;
  seed?: number;
}

/**
 * Approximate chip-EV of opening (small raise). Folds behind win the dead pot;
 * when called, the hero realizes a fraction of equity on the inflated pot.
 * This is a coarse single-caller model — directionally useful, not exact.
 *
 *   EV = fe * pot + (1 - fe) * ( realization * eq * potIfCalled - raiseTo )
 */
export function openRaiseEv(label: string, p: RaiseEvParams): number {
  const potBB = p.potBB ?? 1.5;
  const realization = p.realization ?? 0.85;
  const continueRange = topPercentRange(p.continuePercent);
  const combos = labelToCombos(label);
  const hero = cardsToString(combos[0]);

  const eq = equityVsRanges(hero, [continueRange], {
    iterations: p.iterations ?? 4000,
    seed: p.seed ?? 777,
  });
  const equityVsContinue = eq.equities[0];

  const contFrac = Math.max(0, Math.min(1, p.continuePercent / 100));
  const fe = Math.pow(1 - contFrac, Math.max(1, p.playersBehind));

  const potIfCalled = potBB + 2 * p.raiseTo; // hero + one caller
  const evCalled = realization * equityVsContinue * potIfCalled - p.raiseTo;

  return fe * potBB + (1 - fe) * evCalled;
}
