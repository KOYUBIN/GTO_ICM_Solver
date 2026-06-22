/**
 * 7-card hand evaluator.
 *
 * Returns a single comparable integer where a larger value is a stronger
 * hand. The score packs a hand category in the high bits and up to five
 * rank tiebreakers in the low bits (base 16 per rank, ranks 0..12).
 *
 * This is a clarity-first evaluator (not a perfect-hash lookup), but it is
 * fast enough for tens of thousands of Monte-Carlo trials per equity query.
 */

import { Card, cardRank, cardSuit } from './cards.js';

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
} as const;

export const CATEGORY_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
];

const BASE = 16;
const CAT_MULT = BASE ** 5;

function packTiebreak(ranks: number[]): number {
  // ranks: most significant first, up to 5 entries.
  let v = 0;
  for (let i = 0; i < 5; i++) {
    v = v * BASE + (ranks[i] ?? 0);
  }
  return v;
}

/**
 * Highest straight top-card (rank 0..12) from a 13-bit rank mask, or -1.
 * Handles the wheel (A-2-3-4-5) by treating the ace as a low card too.
 */
function straightHigh(rankMask: number): number {
  const aceBit = (rankMask >> 12) & 1;
  // ext bit b corresponds to rank b-1; bit 0 is the "low ace".
  const ext = ((rankMask << 1) | aceBit) & 0x3fff;
  for (let top = 13; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((ext & need) === need) {
      return top - 1;
    }
  }
  return -1;
}

export function evaluate7(cards: Card[]): number {
  const rankCount = new Array(13).fill(0);
  const suitMask = [0, 0, 0, 0]; // per-suit rank bitmask
  const suitCount = [0, 0, 0, 0];
  let rankMask = 0;

  for (const c of cards) {
    const r = cardRank(c);
    const s = cardSuit(c);
    rankCount[r]++;
    rankMask |= 1 << r;
    suitMask[s] |= 1 << r;
    suitCount[s]++;
  }

  // Flush / straight flush.
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      flushSuit = s;
      break;
    }
  }

  if (flushSuit >= 0) {
    const sfHigh = straightHigh(suitMask[flushSuit]);
    if (sfHigh >= 0) {
      return HandCategory.StraightFlush * CAT_MULT + sfHigh;
    }
  }

  // Group ranks by count.
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    switch (rankCount[r]) {
      case 4:
        quads.push(r);
        break;
      case 3:
        trips.push(r);
        break;
      case 2:
        pairs.push(r);
        break;
      case 1:
        singles.push(r);
        break;
    }
  }

  // Four of a kind.
  if (quads.length) {
    const quad = quads[0];
    const kicker = highestExcept(rankMask, quad);
    return HandCategory.FourOfAKind * CAT_MULT + packTiebreak([quad, kicker]);
  }

  // Full house.
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const trip = trips[0];
    const pair = trips.length > 1 ? trips[1] : pairs[0];
    return HandCategory.FullHouse * CAT_MULT + packTiebreak([trip, pair]);
  }

  // Flush.
  if (flushSuit >= 0) {
    const top5 = topRanks(suitMask[flushSuit], 5);
    return HandCategory.Flush * CAT_MULT + packTiebreak(top5);
  }

  // Straight.
  const sHigh = straightHigh(rankMask);
  if (sHigh >= 0) {
    return HandCategory.Straight * CAT_MULT + sHigh;
  }

  // Three of a kind.
  if (trips.length) {
    const trip = trips[0];
    const kickers = topRanksExcept(rankMask, trip, 2);
    return HandCategory.ThreeOfAKind * CAT_MULT + packTiebreak([trip, ...kickers]);
  }

  // Two pair.
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const kicker = highestExcept(rankMask, p1, p2);
    return HandCategory.TwoPair * CAT_MULT + packTiebreak([p1, p2, kicker]);
  }

  // One pair.
  if (pairs.length === 1) {
    const p = pairs[0];
    const kickers = topRanksExcept(rankMask, p, 3);
    return HandCategory.Pair * CAT_MULT + packTiebreak([p, ...kickers]);
  }

  // High card.
  return HandCategory.HighCard * CAT_MULT + packTiebreak(topRanks(rankMask, 5));
}

export function categoryOf(score: number): number {
  return Math.floor(score / CAT_MULT);
}

function highestExcept(rankMask: number, ...exclude: number[]): number {
  let mask = rankMask;
  for (const e of exclude) mask &= ~(1 << e);
  for (let r = 12; r >= 0; r--) if (mask & (1 << r)) return r;
  return 0;
}

function topRanks(rankMask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) {
    if (rankMask & (1 << r)) out.push(r);
  }
  return out;
}

function topRanksExcept(rankMask: number, exclude: number, n: number): number[] {
  return topRanks(rankMask & ~(1 << exclude), n);
}
