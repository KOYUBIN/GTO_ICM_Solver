/**
 * Preflop range parsing and the 13x13 hand grid.
 *
 * Supports the standard shorthand used by solvers / GTO Wizard:
 *   "AA", "AKs", "AKo", "AK" (= AKs + AKo),
 *   "22+", "ATs+", "A5s-A2s", "JTs", "T9o",
 *   optional weights via "AKs:0.5",
 *   comma-separated combinations: "22+, AJs+, KQo".
 */

import { Card, makeCard, RANKS } from './cards.js';

export type Combo = [Card, Card];

export interface WeightedHand {
  /** Canonical grid label, e.g. "AKs", "QQ", "T9o". */
  label: string;
  weight: number; // 0..1
}

const R = 12; // ace index helper count (ranks are 0..12)

function rankIdx(ch: string): number {
  const i = RANKS.indexOf(ch.toUpperCase());
  if (i < 0) throw new Error(`Invalid rank: ${ch}`);
  return i;
}

/** Build the canonical label for two rank indices and a suitedness flag. */
export function gridLabel(hi: number, lo: number, suited: boolean | null): string {
  const a = Math.max(hi, lo);
  const b = Math.min(hi, lo);
  if (a === b) return RANKS[a] + RANKS[a];
  return RANKS[a] + RANKS[b] + (suited ? 's' : 'o');
}

/** Every label in the 169-cell grid (pairs, suited, offsuit). */
export function allGridLabels(): string[] {
  const labels: string[] = [];
  for (let i = R; i >= 0; i--) {
    for (let j = R; j >= 0; j--) {
      if (i === j) labels.push(gridLabel(i, j, null));
      else if (i > j) labels.push(gridLabel(i, j, true));
      else labels.push(gridLabel(j, i, false));
    }
  }
  return labels;
}

function expandPlus(hi: number, lo: number, suited: boolean | null): string[] {
  // "22+" -> all pairs >= 22; "ATs+" -> ATs,AJs,AQs,AKs.
  const out: string[] = [];
  if (hi === lo) {
    for (let r = lo; r <= R; r++) out.push(gridLabel(r, r, null));
  } else {
    for (let r = lo; r < hi; r++) out.push(gridLabel(hi, r, suited));
  }
  return out;
}

function expandDash(token: string): string[] {
  // "A5s-A2s" or "99-66" or "AQo-A9o".
  const [left, right] = token.split('-');
  const l = parseSingle(left);
  const r = parseSingle(right);
  if (!l || !r) return [];
  const out: string[] = [];
  if (l.hi === l.lo && r.hi === r.lo) {
    const top = Math.max(l.lo, r.lo);
    const bot = Math.min(l.lo, r.lo);
    for (let p = bot; p <= top; p++) out.push(gridLabel(p, p, null));
  } else if (l.hi === r.hi) {
    const top = Math.max(l.lo, r.lo);
    const bot = Math.min(l.lo, r.lo);
    for (let k = bot; k <= top; k++) out.push(gridLabel(l.hi, k, l.suited));
  }
  return out;
}

function parseSingle(token: string): { hi: number; lo: number; suited: boolean | null } | null {
  const t = token.trim();
  if (t.length < 2) return null;
  const hi = rankIdx(t[0]);
  const lo = rankIdx(t[1]);
  let suited: boolean | null = null;
  if (t[2] === 's' || t[2] === 'S') suited = true;
  else if (t[2] === 'o' || t[2] === 'O') suited = false;
  return { hi: Math.max(hi, lo), lo: Math.min(hi, lo), suited };
}

/** Parse a range string into a map of canonical label -> weight. */
export function parseRange(input: string): Map<string, number> {
  const result = new Map<string, number>();
  const tokens = input.split(',').map((s) => s.trim()).filter(Boolean);

  for (const tok of tokens) {
    const [body, weightStr] = tok.split(':');
    const weight = weightStr ? clamp01(parseFloat(weightStr)) : 1;
    const t = body.trim();
    let labels: string[] = [];

    if (t.includes('-')) {
      labels = expandDash(t);
    } else if (t.endsWith('+')) {
      const s = parseSingle(t.slice(0, -1));
      if (s) labels = expandPlus(s.hi, s.lo, s.suited);
    } else {
      const s = parseSingle(t);
      if (s) {
        if (s.hi !== s.lo && s.suited === null) {
          // "AK" with no suit flag means both suited and offsuit.
          labels = [gridLabel(s.hi, s.lo, true), gridLabel(s.hi, s.lo, false)];
        } else {
          labels = [gridLabel(s.hi, s.lo, s.suited)];
        }
      }
    }

    for (const l of labels) result.set(l, weight);
  }

  return result;
}

/** Enumerate the concrete card combos for a grid label (e.g. "AKs" -> 4). */
export function labelToCombos(label: string): Combo[] {
  const hi = rankIdx(label[0]);
  const lo = rankIdx(label[1]);
  const suited = label[2] === 's' ? true : label[2] === 'o' ? false : null;
  const combos: Combo[] = [];

  if (hi === lo) {
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = s1 + 1; s2 < 4; s2++)
        combos.push([makeCard(hi, s1), makeCard(lo, s2)]);
  } else if (suited === true) {
    for (let s = 0; s < 4; s++) combos.push([makeCard(hi, s), makeCard(lo, s)]);
  } else if (suited === false) {
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = 0; s2 < 4; s2++)
        if (s1 !== s2) combos.push([makeCard(hi, s1), makeCard(lo, s2)]);
  }
  return combos;
}

/** Expand a parsed range into weighted concrete combos. */
export function rangeToCombos(range: Map<string, number>): { combo: Combo; weight: number }[] {
  const out: { combo: Combo; weight: number }[] = [];
  for (const [label, weight] of range) {
    if (weight <= 0) continue;
    for (const combo of labelToCombos(label)) out.push({ combo, weight });
  }
  return out;
}

/** Number of combos a label represents (pairs=6, suited=4, offsuit=12). */
export function comboCount(label: string): number {
  if (label[0] === label[1]) return 6;
  return label[2] === 's' ? 4 : 12;
}

/** Total weighted combos in a range (useful for "% of hands"). */
export function rangePercent(range: Map<string, number>): number {
  let weighted = 0;
  for (const [label, w] of range) weighted += comboCount(label) * w;
  return (weighted / 1326) * 100;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 1;
  return Math.max(0, Math.min(1, x));
}
