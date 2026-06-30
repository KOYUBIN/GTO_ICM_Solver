// Heuristic parser for OCR text scraped from poker screenshots (WPL / WinJoy /
// PokerStars clients). OCR on graphical poker tables is unreliable for card
// SUITS (the pips are colored glyphs, not text), so this parser is best-effort
// and "beta": it extracts whatever rank+suit tokens it can, the bare ranks it
// can't pair with a suit, plus pot/stack amounts and candidate name/title lines.
// The UI lets the user correct the result before analyzing.

export interface OcrPokerResult {
  /** Fully-resolved card tokens, normalized to e.g. 'Ah', 'Ks', 'Td'. */
  cards: string[];
  /** Ranks detected without a readable suit (user must complete the suit). */
  looseRanks: string[];
  /** Best guess at the pot size. */
  pot?: number;
  /** All numeric amounts found (commas stripped), descending. */
  amounts: number[];
  /** Candidate title line (tournament / table name). */
  title?: string;
  /** Cleaned, non-empty source lines. */
  lines: string[];
}

const SUIT_MAP: Record<string, string> = {
  s: 's', h: 'h', d: 'd', c: 'c',
  '♠': 's', '♤': 's',
  '♥': 'h', '♡': 'h',
  '♦': 'd', '♢': 'd',
  '♣': 'c', '♧': 'c',
};

function normRank(r: string): string {
  if (r === '10') return 'T';
  return r.toUpperCase();
}

/** Pull a number out of a token like "1,234,567" or "599114". */
function toAmount(s: string): number | null {
  const cleaned = s.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const CARD_RE = /(10|[2-9TJQKAtjqka])\s*([shdcSHDC♠♤♥♡♦♢♣♧])/g;
const POT_HINT = /(pot|팟|총\s*팟|main\s*pot|메인\s*팟|total)/i;
const AMOUNT_RE = /\d[\d,]{2,}/g; // 3+ digit groups, optionally comma-separated

export function parseOcrPoker(raw: string): OcrPokerResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Card tokens with a readable suit. To avoid reading rank+suit out of ordinary
  // words ("GTD" → Td, "cash" → As), reject a token that starts inside an
  // alphabetic word — UNLESS it begins exactly where the previous card ended, so
  // joined hole cards like "KsKc" / "KsKcQd" still chain.
  const cards: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  let prevEnd = -1;
  CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(raw)) !== null) {
    const start = m.index;
    const before = start > 0 ? raw[start - 1] : '';
    const okStart = start === 0 || !/[A-Za-z]/.test(before) || start === prevEnd;
    if (!okStart) continue;
    prevEnd = start + m[0].length;
    const rank = normRank(m[1]);
    const suit = SUIT_MAP[m[2].toLowerCase()] ?? SUIT_MAP[m[2]];
    if (!suit) continue;
    const tok = `${rank}${suit}`;
    if (!seen.has(tok)) {
      seen.add(tok);
      cards.push(tok);
    }
  }

  // Bare ranks (rank tokens not already captured as a full card). We look at the
  // raw text with the matched cards removed so we don't double-count.
  const withoutCards = raw.replace(CARD_RE, ' ');
  const looseRanks: string[] = [];
  const rankRe = /(?:^|[^0-9A-Za-z])(10|[2-9TJQKA])(?=$|[^0-9A-Za-z])/g;
  let rm: RegExpExecArray | null;
  while ((rm = rankRe.exec(withoutCards)) !== null) looseRanks.push(normRank(rm[1]));

  // Amounts.
  const amounts: number[] = [];
  let am: RegExpExecArray | null;
  AMOUNT_RE.lastIndex = 0;
  while ((am = AMOUNT_RE.exec(raw)) !== null) {
    const n = toAmount(am[0]);
    if (n != null) amounts.push(n);
  }
  amounts.sort((a, b) => b - a);

  // Pot: prefer a number on a line that mentions "pot"/"팟", else the largest.
  let pot: number | undefined;
  for (const line of lines) {
    if (POT_HINT.test(line)) {
      const nums = line.match(AMOUNT_RE)?.map(toAmount).filter((x): x is number => x != null) ?? [];
      if (nums.length) {
        pot = Math.max(...nums);
        break;
      }
    }
  }
  if (pot == null && amounts.length) pot = amounts[0];

  // Title: first reasonably long line without card/amount noise, e.g. a GTD name.
  const title = lines.find(
    (l) => l.length >= 4 && /[A-Za-z가-힣]/.test(l) && !POT_HINT.test(l) && !/^\d/.test(l),
  );

  return { cards, looseRanks, pot, amounts, title, lines };
}
