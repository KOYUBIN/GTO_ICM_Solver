/**
 * Hand-strength description helpers.
 *
 * Pure, deterministic utilities layered on top of the existing evaluator:
 *   - describeHand(hole, board): Korean best-hand name + detail (with draw
 *     hints on 3/4-card boards).
 *   - bestFive(hole, board): the exact five card ints that form the best hand.
 *
 * These never mutate their inputs and use no randomness.
 */

import { Card, cardRank, cardSuit, RANKS } from './cards.js';
import { evaluate7, categoryOf, HandCategory } from './handEval.js';

/** Korean category names, indexed by HandCategory (0..8). */
const RANK_KO = [
  '하이카드',
  '원 페어',
  '투 페어',
  '트리플',
  '스트레이트',
  '플러시',
  '풀 하우스',
  '포카드',
  '스트레이트 플러시',
];

const ROYAL_KO = '로열 플러시';

function rankChar(r: number): string {
  return RANKS[r];
}

function repeatRank(r: number, n: number): string {
  return rankChar(r).repeat(n);
}

/**
 * Pick the exact five cards forming the best hand out of hole+board.
 *
 * Requires hole.length + board.length >= 5; returns [] otherwise (e.g.
 * preflop). Brute-forces every 5-card combination (at most C(7,5) = 21) and
 * scores each with evaluate7, which is also a correct 5-card evaluator (it
 * only counts ranks/suits, and a flush/straight still needs all five cards).
 *
 * The returned cards are sorted by descending rank (then suit) for stable,
 * display-friendly output. Ties between equal-scoring combinations resolve
 * deterministically by enumeration order over [...hole, ...board].
 */
export function bestFive(hole: number[], board: number[]): number[] {
  const cards: Card[] = [...hole, ...board];
  const n = cards.length;
  if (n < 5) return [];

  let bestScore = -1;
  let best: Card[] = [];
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = evaluate7(five);
            if (score > bestScore) {
              bestScore = score;
              best = five;
            }
          }
        }
      }
    }
  }

  return best
    .slice()
    .sort((x, y) => cardRank(y) - cardRank(x) || cardSuit(y) - cardSuit(x));
}

interface RankGroups {
  quads: number[];
  trips: number[];
  pairs: number[];
  singles: number[];
  ranks: number[]; // distinct ranks present, descending
}

function groupRanks(cards: Card[]): RankGroups {
  const count = new Array<number>(13).fill(0);
  for (const c of cards) count[cardRank(c)]++;
  const g: RankGroups = { quads: [], trips: [], pairs: [], singles: [], ranks: [] };
  for (let r = 12; r >= 0; r--) {
    if (count[r] === 0) continue;
    g.ranks.push(r);
    if (count[r] === 4) g.quads.push(r);
    else if (count[r] === 3) g.trips.push(r);
    else if (count[r] === 2) g.pairs.push(r);
    else g.singles.push(r);
  }
  return g;
}

/**
 * Top card of the straight formed by `ranks` (distinct, descending, exactly
 * the five cards of a made straight). Handles the wheel: A-2-3-4-5 tops at 5.
 */
function straightTop(ranks: number[]): number {
  if (ranks[0] === 12 && ranks[1] === 3) return 3; // wheel: A,5,4,3,2
  return ranks[0];
}

/** Korean detail text for a made hand consisting of exactly `cards`. */
function madeDetail(cat: number, cards: Card[]): string {
  const g = groupRanks(cards);
  switch (cat) {
    case HandCategory.StraightFlush: {
      const top = straightTop(g.ranks);
      if (top === 12) return ROYAL_KO;
      return `${RANK_KO[cat]} ${rankChar(top)} 하이`;
    }
    case HandCategory.FourOfAKind:
      return `${RANK_KO[cat]} ${repeatRank(g.quads[0], 4)}`;
    case HandCategory.FullHouse:
      return `${RANK_KO[cat]} ${repeatRank(g.trips[0], 3)}-${repeatRank(g.pairs[0], 2)}`;
    case HandCategory.Flush:
      return `${RANK_KO[cat]} ${rankChar(g.ranks[0])} 하이`;
    case HandCategory.Straight:
      return `${RANK_KO[cat]} ${rankChar(straightTop(g.ranks))} 하이`;
    case HandCategory.ThreeOfAKind:
      return `${RANK_KO[cat]} ${repeatRank(g.trips[0], 3)}`;
    case HandCategory.TwoPair:
      return `${RANK_KO[cat]} ${repeatRank(g.pairs[0], 2)}-${repeatRank(g.pairs[1], 2)}`;
    case HandCategory.Pair:
      return `${RANK_KO[cat]} ${repeatRank(g.pairs[0], 2)}`;
    default:
      return `${RANK_KO[HandCategory.HighCard]} ${rankChar(g.ranks[0])}`;
  }
}

/**
 * Draw hints over all seven (or six/five) known cards. Only meaningful when
 * cards are still to come, so callers gate this to 3/4-card boards.
 */
function drawHints(cards: Card[], cat: number): string[] {
  const suitCount = [0, 0, 0, 0];
  let rankMask = 0;
  for (const c of cards) {
    suitCount[cardSuit(c)]++;
    rankMask |= 1 << cardRank(c);
  }

  const hints: string[] = [];

  // Flush draw: exactly four of one suit, and no made flush already.
  if (
    cat < HandCategory.Flush &&
    suitCount.some((n) => n === 4)
  ) {
    hints.push('플러시 드로우');
  }

  // Open-ended straight draw: four consecutive ranks completable at BOTH
  // ends. Uses the same low-ace extension trick as the evaluator: ext bit b
  // is rank b-1, bit 0 the low ace. A run at bits b..b+3 is open-ended when
  // both bit b-1 and bit b+4 are valid card slots (b >= 1, b+4 <= 13).
  if (cat < HandCategory.Straight) {
    const aceBit = (rankMask >> 12) & 1;
    const ext = ((rankMask << 1) | aceBit) & 0x3fff;
    for (let b = 1; b + 4 <= 13; b++) {
      if (((ext >> b) & 0xf) === 0xf) {
        hints.push('양방 스트레이트 드로우');
        break;
      }
    }
  }

  return hints;
}

/**
 * Korean description of the best hand for hole(2) + board(0..5).
 *
 *   - rankKo: category name (하이카드 .. 로열 플러시); preflop a pocket pair
 *     reads '포켓 페어'.
 *   - detailKo: full text, e.g. '투 페어 AA-KK', '포켓 페어 QQ',
 *     '하이카드 A-K'. On 3/4-card boards, draw hints ('플러시 드로우',
 *     '양방 스트레이트 드로우') are appended when present.
 */
export function describeHand(
  hole: number[],
  board: number[],
): { rankKo: string; detailKo: string } {
  // Preflop: describe the two hole cards directly.
  if (board.length === 0 && hole.length === 2) {
    const r0 = cardRank(hole[0]);
    const r1 = cardRank(hole[1]);
    if (r0 === r1) {
      return { rankKo: '포켓 페어', detailKo: `포켓 페어 ${repeatRank(r0, 2)}` };
    }
    const hi = Math.max(r0, r1);
    const lo = Math.min(r0, r1);
    return { rankKo: '하이카드', detailKo: `하이카드 ${rankChar(hi)}-${rankChar(lo)}` };
  }

  const all: Card[] = [...hole, ...board];
  const cat = categoryOf(evaluate7(all));

  // Describe from the exact best five when available, else from all cards
  // (fewer than five known cards cannot make straights/flushes anyway).
  const described = all.length >= 5 ? bestFive(hole, board) : all;
  const detail = madeDetail(cat, described);
  const royal = cat === HandCategory.StraightFlush && detail === ROYAL_KO;
  const rankKo = royal ? ROYAL_KO : RANK_KO[cat];

  // Draw hints only while cards are still to come (flop/turn boards).
  const hints = board.length === 3 || board.length === 4 ? drawHints(all, cat) : [];
  const detailKo = hints.length ? `${detail}, ${hints.join(', ')}` : detail;

  return { rankKo, detailKo };
}
