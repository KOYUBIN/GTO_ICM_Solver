/**
 * Range-vs-range matchup analysis — a GTO-Wizard-style "range advantage" view.
 *
 * Given 2..4 ranges (as concrete combos) and an optional board, computes:
 *
 *   - rangeEquities: the aggregate Monte-Carlo equity of each range vs the
 *     others (multiway supported; ties split evenly, sums to ~1),
 *   - distributions: per 13x13-grid-label equity for every range, sorted
 *     strongest-first — the data behind an equity-distribution curve,
 *   - nutPct / strongPct: the combo-weighted fraction of each range with
 *     label equity >= 0.80 ("nut advantage") / >= 0.65 ("strong hands").
 *
 * APPROXIMATION (kept deliberately browser-friendly): the distribution works
 * at grid-label level, sampling ONE representative combo per label (see
 * `sampleCombosPerLabel` to average more) and running a modest per-label
 * Monte-Carlo — max(400, iterations/40) iterations each. Suit-symmetric spots
 * (preflop, rainbow boards) are near-exact; on two-tone/monotone boards the
 * representative combo may not capture every suit configuration of a label.
 */

import { Card, cardRank, cardSuit, parseCards } from './cards.js';
import { calcEquity } from './equity.js';
import { Combo, gridLabel } from './range.js';

export interface RangeMatchupOptions {
  /** 2..4 ranges, each as expanded concrete combos (see rangeToCombos). */
  ranges: Combo[][];
  /** Fixed community cards: 0 (preflop), 3, 4 or 5. */
  board?: string;
  /** Total Monte-Carlo budget for the aggregate equities. Default 10000. */
  iterations?: number;
  /** Seed for reproducible results (per-label seeds are derived from it). */
  seed?: number;
  /** Representative combos sampled per grid label. Default 1 (fast). */
  sampleCombosPerLabel?: number;
}

export interface LabelEquity {
  /** Canonical grid label, e.g. "AKs". */
  label: string;
  /** Monte-Carlo equity of this label vs all other ranges (0..1). */
  equity: number;
  /** Combos of this label present in the range (after board filtering). */
  weightCombos: number;
}

export interface RangeMatchupResult {
  /** Aggregate equity per range (same order as opts.ranges, sums to ~1). */
  rangeEquities: number[];
  /** Per range: label equities sorted descending by equity. */
  distributions: LabelEquity[][];
  /** Combo-weighted fraction of each range with label equity >= 0.80. */
  nutPct: number[];
  /** Combo-weighted fraction of each range with label equity >= 0.65. */
  strongPct: number[];
}

export const NUT_EQUITY_THRESHOLD = 0.8;
export const STRONG_EQUITY_THRESHOLD = 0.65;

/** FNV-1a string hash — mixes the label into a deterministic per-label seed. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function comboLabel(combo: Combo): string {
  const hi = cardRank(combo[0]);
  const lo = cardRank(combo[1]);
  const suited = cardSuit(combo[0]) === cardSuit(combo[1]);
  return gridLabel(hi, lo, hi === lo ? null : suited);
}

export function rangeMatchup(opts: RangeMatchupOptions): RangeMatchupResult {
  const n = opts.ranges?.length ?? 0;
  if (n < 2 || n > 4) throw new Error('레인지는 2~4개가 필요합니다.');

  const boardCards: Card[] = opts.board ? parseCards(opts.board) : [];
  if (![0, 3, 4, 5].includes(boardCards.length)) {
    throw new Error('보드는 0장(프리플랍) 또는 3·4·5장이어야 합니다.');
  }
  const boardSet = new Set(boardCards);
  if (boardSet.size !== boardCards.length) {
    throw new Error('보드에 중복 카드가 있습니다.');
  }

  // Drop combos that collide with the board; every range must keep something.
  const ranges: Combo[][] = opts.ranges.map((r, i) => {
    if (!r || r.length === 0) {
      throw new Error(`${i + 1}번 레인지가 비어 있습니다.`);
    }
    const filtered = r.filter((c) => !boardSet.has(c[0]) && !boardSet.has(c[1]));
    if (filtered.length === 0) {
      throw new Error(`${i + 1}번 레인지의 모든 콤보가 보드 카드와 겹칩니다.`);
    }
    return filtered;
  });

  const iterations = opts.iterations ?? 10000;
  const seed = ((opts.seed ?? (Math.random() * 2 ** 31) | 0) >>> 0) || 1;
  const samplePerLabel = Math.max(1, Math.floor(opts.sampleCombosPerLabel ?? 1));
  const perLabelIters = Math.max(400, Math.floor(iterations / 40));

  // 1) Aggregate range-vs-range equities on the given board.
  const agg = calcEquity(
    ranges.map((combos) => ({ combos })),
    { board: opts.board, iterations, seed },
  );

  // 2) Per-label equity distribution for each range (label-level approximation).
  const distributions: LabelEquity[][] = [];
  const nutPct: number[] = [];
  const strongPct: number[] = [];

  for (let i = 0; i < n; i++) {
    const groups = new Map<string, Combo[]>();
    for (const combo of ranges[i]) {
      const label = comboLabel(combo);
      const g = groups.get(label);
      if (g) g.push(combo);
      else groups.set(label, [combo]);
    }

    const others = ranges.filter((_, j) => j !== i).map((combos) => ({ combos }));
    const dist: LabelEquity[] = [];
    for (const [label, combos] of groups) {
      const k = Math.min(samplePerLabel, combos.length);
      let eqSum = 0;
      for (let s = 0; s < k; s++) {
        // Spread the k samples across the label's combos.
        const rep = combos[Math.floor((s * combos.length) / k)];
        const labelSeed = ((seed ^ hashStr(`${i}:${label}:${s}`)) >>> 0) || 1;
        const res = calcEquity([{ combos: [rep] }, ...others], {
          board: opts.board,
          iterations: perLabelIters,
          seed: labelSeed,
        });
        eqSum += res.equities[0];
      }
      dist.push({ label, equity: eqSum / k, weightCombos: combos.length });
    }
    // Strongest first; label tiebreak keeps the order fully deterministic.
    dist.sort((a, b) => b.equity - a.equity || a.label.localeCompare(b.label));
    distributions.push(dist);

    const total = dist.reduce((s, d) => s + d.weightCombos, 0) || 1;
    const weightAbove = (threshold: number) =>
      dist.reduce((s, d) => (d.equity >= threshold ? s + d.weightCombos : s), 0) / total;
    nutPct.push(weightAbove(NUT_EQUITY_THRESHOLD));
    strongPct.push(weightAbove(STRONG_EQUITY_THRESHOLD));
  }

  return { rangeEquities: agg.equities, distributions, nutPct, strongPct };
}
