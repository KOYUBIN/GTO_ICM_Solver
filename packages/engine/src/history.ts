/**
 * Hand-history parser.
 *
 * Parses common online-poker hand-history text (PokerStars-style, which most
 * sites and converters emulate) into a structured object that the analyzer can
 * reason about. Image uploads are handled at the UI layer by running OCR to
 * extract this same text, then feeding it here.
 *
 * The parser is intentionally tolerant: missing sections are simply omitted.
 */

export interface ParsedAction {
  street: 'preflop' | 'flop' | 'turn' | 'river';
  player: string;
  action: string; // folds | checks | calls | bets | raises
  amount?: number;
}

export interface ParsedHand {
  site?: string;
  stakes?: string;
  heroName?: string;
  heroCards?: string; // e.g. "AsKh"
  board: string; // up to 5 cards, space-free e.g. "Ah7d2cTs9h"
  players: { name: string; stack?: number; seat?: number }[];
  actions: ParsedAction[];
  potPreflop?: number;
  /** Notes about anything the parser couldn't interpret. */
  warnings: string[];
}

const CARD_RE = /[2-9TJQKA][cdhs]/g;

function grabCards(text: string): string {
  const m = text.match(CARD_RE);
  return m ? m.join('') : '';
}

export function parseHandHistory(raw: string): ParsedHand {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const hand: ParsedHand = { board: '', players: [], actions: [], warnings: [] };

  let street: ParsedAction['street'] = 'preflop';
  const boardParts: string[] = [];

  for (const line of lines) {
    if (!line) continue;

    // Header: site + stakes.
    const header = line.match(/^(\w[\w\s]*?Hand).*\(([^)]+)\)/i);
    if (header) {
      hand.site = header[1].replace(/\s*Hand$/i, '').trim();
      hand.stakes = header[2].trim();
      continue;
    }

    // Seats / stacks.
    const seat = line.match(/^Seat\s+(\d+):\s+(.+?)\s+\(\$?([\d.]+)/i);
    if (seat) {
      hand.players.push({ seat: Number(seat[1]), name: seat[2].trim(), stack: Number(seat[3]) });
      continue;
    }

    // Hero hole cards.
    const dealt = line.match(/^Dealt to\s+(.+?)\s+\[([^\]]+)\]/i);
    if (dealt) {
      hand.heroName = dealt[1].trim();
      hand.heroCards = grabCards(dealt[2]);
      continue;
    }

    // Street markers (and their board cards).
    if (/\*\*\*\s*FLOP/i.test(line)) {
      street = 'flop';
      boardParts.push(grabCards(line));
      continue;
    }
    if (/\*\*\*\s*TURN/i.test(line)) {
      street = 'turn';
      // Turn line shows the prior board then the new card; take the last card.
      const all = grabCards(line);
      boardParts.push(all.slice(-2));
      continue;
    }
    if (/\*\*\*\s*RIVER/i.test(line)) {
      street = 'river';
      const all = grabCards(line);
      boardParts.push(all.slice(-2));
      continue;
    }
    if (/\*\*\*\s*(HOLE CARDS|SHOW DOWN|SUMMARY)/i.test(line)) {
      continue;
    }

    // Actions.
    const act = line.match(/^(.+?):\s+(folds|checks|calls|bets|raises)\b(?:.*?\$?([\d.]+))?/i);
    if (act) {
      hand.actions.push({
        street,
        player: act[1].trim(),
        action: act[2].toLowerCase(),
        amount: act[3] ? Number(act[3]) : undefined,
      });
      continue;
    }
  }

  hand.board = boardParts.join('');
  if (!hand.heroCards) hand.warnings.push('히어로 홀카드를 찾지 못했습니다.');
  if (!hand.board) hand.warnings.push('보드 카드를 찾지 못했습니다.');
  if (!hand.players.length) hand.warnings.push('플레이어/좌석 정보를 찾지 못했습니다.');

  return hand;
}

/** A short human summary of a parsed hand. */
export function summarizeHand(h: ParsedHand): string {
  const parts: string[] = [];
  if (h.site) parts.push(h.site);
  if (h.stakes) parts.push(h.stakes);
  if (h.heroName) parts.push(`히어로: ${h.heroName}`);
  if (h.heroCards) parts.push(`핸드: ${h.heroCards}`);
  if (h.board) parts.push(`보드: ${h.board}`);
  parts.push(`액션 ${h.actions.length}개 · 플레이어 ${h.players.length}명`);
  return parts.join(' · ');
}
