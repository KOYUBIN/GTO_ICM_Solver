/**
 * Card representation and deck utilities.
 *
 * A card is encoded as an integer 0..51 where:
 *   rank = card % 13   (0 = deuce ... 12 = ace)
 *   suit = (card / 13) | 0   (0=clubs, 1=diamonds, 2=hearts, 3=spades)
 *
 * This compact representation keeps the Monte-Carlo equity loop fast.
 */

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export type Card = number; // 0..51

export function makeCard(rank: number, suit: number): Card {
  return suit * 13 + rank;
}

export function cardRank(card: Card): number {
  return card % 13;
}

export function cardSuit(card: Card): number {
  return (card / 13) | 0;
}

/** Parse a card like "As", "Td", "2c" into its integer encoding. */
export function parseCard(str: string): Card {
  const s = str.trim();
  if (s.length !== 2) throw new Error(`Invalid card: "${str}"`);
  const rank = RANKS.indexOf(s[0].toUpperCase());
  const suit = SUITS.indexOf(s[1].toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`Invalid card: "${str}"`);
  return makeCard(rank, suit);
}

/** Parse a string of cards like "AsKh" or "As Kh Qd". */
export function parseCards(str: string): Card[] {
  const cleaned = str.replace(/\s+/g, '');
  const out: Card[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    out.push(parseCard(cleaned.slice(i, i + 2)));
  }
  return out;
}

export function cardToString(card: Card): string {
  return RANKS[cardRank(card)] + SUITS[cardSuit(card)];
}

export function cardsToString(cards: Card[]): string {
  return cards.map(cardToString).join('');
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  return deck;
}

/**
 * Mulberry32 — a tiny, fast, seedable PRNG so equity/solver runs are
 * reproducible when a seed is supplied.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
