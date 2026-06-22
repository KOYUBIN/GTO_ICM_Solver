/**
 * Preflop hand strength and a practical push/fold approximation.
 *
 * Hand strength uses the Chen formula (a well-known heuristic). The push/fold
 * model approximates Nash shoving ranges for short stacks: it shoves the top
 * fraction of hands, where the fraction tightens as stack depth grows and as
 * more players act behind. This is an approximation, not an exact Nash solve.
 */

import { RANKS } from './cards.js';
import { allGridLabels, comboCount } from './range.js';

/** Chen formula score for a grid label (e.g. "AKs"). Higher = stronger. */
export function chenScore(label: string): number {
  const hi = RANKS.indexOf(label[0]);
  const lo = RANKS.indexOf(label[1]);
  const suited = label[2] === 's';
  const pair = hi === lo;

  // Base score from the highest card.
  const baseFor = (rankIdx: number): number => {
    if (rankIdx === 12) return 10; // Ace
    if (rankIdx === 11) return 8; // King
    if (rankIdx === 10) return 7; // Queen
    if (rankIdx === 9) return 6; // Jack
    return (rankIdx + 2) / 2; // Ten and below = rank/2
  };

  let score: number;
  if (pair) {
    score = Math.max(5, baseFor(hi) * 2);
  } else {
    score = baseFor(Math.max(hi, lo));
    if (suited) score += 2;
    const gap = Math.abs(hi - lo) - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    // Straight bonus for low connectors with a gap of 0 or 1.
    if (gap <= 1 && Math.max(hi, lo) < 10) score += 1;
  }
  return Math.round(score * 2) / 2;
}

let cachedOrder: { label: string; score: number; combos: number }[] | null = null;

/** All 169 hands sorted strongest-first by Chen score. */
export function strengthOrder(): { label: string; score: number; combos: number }[] {
  if (cachedOrder) return cachedOrder;
  cachedOrder = allGridLabels()
    .map((label) => ({ label, score: chenScore(label), combos: comboCount(label) }))
    .sort((a, b) => b.score - a.score || b.combos - a.combos);
  return cachedOrder;
}

/**
 * The top `percent` of starting hands (by combo-weighted strength) as a set
 * of labels. Useful for rendering ranges or building a shove range.
 */
export function topPercentRange(percent: number): Map<string, number> {
  const target = (percent / 100) * 1326;
  const order = strengthOrder();
  const out = new Map<string, number>();
  let acc = 0;
  for (const h of order) {
    if (acc >= target) break;
    out.set(h.label, 1);
    acc += h.combos;
  }
  return out;
}

export interface PushFoldAdvice {
  action: 'push' | 'fold' | 'marginal';
  /** Approximate shove threshold (% of hands) for this spot. */
  thresholdPercent: number;
  handScore: number;
  thresholdScore: number;
}

/**
 * Approximate short-stack push/fold advice.
 *
 * stackBB: effective stack in big blinds.
 * playersBehind: number of players yet to act (more = tighter).
 */
export function pushFoldAdvice(label: string, stackBB: number, playersBehind: number): PushFoldAdvice {
  // Wider when very short, tighter as the stack grows and more players remain.
  // Anchor points roughly track Nash shove charts for heads-up-to-the-blinds.
  const base = 60; // ~60% shove at ~3bb headsup-ish
  const depthPenalty = Math.max(0, (stackBB - 3)) * 2.4; // tighten with depth
  const fieldPenalty = Math.max(0, playersBehind - 1) * 6; // tighten vs field
  const thresholdPercent = Math.max(4, Math.min(85, base - depthPenalty - fieldPenalty));

  const order = strengthOrder();
  const target = (thresholdPercent / 100) * 1326;
  let acc = 0;
  let thresholdScore = order[order.length - 1].score;
  for (const h of order) {
    acc += h.combos;
    if (acc >= target) {
      thresholdScore = h.score;
      break;
    }
  }

  const handScore = chenScore(label);
  let action: PushFoldAdvice['action'];
  if (handScore > thresholdScore) action = 'push';
  else if (handScore === thresholdScore) action = 'marginal';
  else action = 'fold';

  return { action, thresholdPercent, handScore, thresholdScore };
}
