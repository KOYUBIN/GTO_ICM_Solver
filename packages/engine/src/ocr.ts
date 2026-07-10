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

// A rank+suit token. The gap is at most one space/tab (never a newline, so a
// rank and suit can't straddle a line break), and the suit must be followed by a
// boundary or the start of another card token — so words like "The"/"Ask"/"Add"
// don't become Th/As/Ad and "Level 9 starts" doesn't yield 9s, while joined hole
// cards ("KsKc" / "KsKcQd") still chain.
const CARD_BODY = '(?:10|[2-9TJQKAtjqka])[ \\t]?[shdcSHDC♠♤♥♡♦♢♣♧]';
const CARD_RE = new RegExp(
  `(10|[2-9TJQKAtjqka])[ \\t]?([shdcSHDC♠♤♥♡♦♢♣♧])(?=$|[^0-9A-Za-z]|${CARD_BODY})`,
  'g',
);
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
  const spans: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  let prevEnd = -1;
  CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(raw)) !== null) {
    const start = m.index;
    const before = start > 0 ? raw[start - 1] : '';
    const okStart = start === 0 || !/[A-Za-z]/.test(before) || start === prevEnd;
    if (!okStart) continue;
    const end = start + m[0].length;
    prevEnd = end;
    const rank = normRank(m[1]);
    const suit = SUIT_MAP[m[2].toLowerCase()] ?? SUIT_MAP[m[2]];
    if (!suit) continue;
    spans.push({ start, end });
    const tok = `${rank}${suit}`;
    if (!seen.has(tok)) {
      seen.add(tok);
      cards.push(tok);
    }
  }

  // Bare ranks (rank tokens not captured as a full card). Blank out only the
  // spans we ACCEPTED as cards (not okStart-rejected matches), preserving offsets
  // so e.g. the "9" in "Level 9 starts" is still available as a loose rank.
  const chars = raw.split('');
  for (const { start, end } of spans) for (let i = start; i < end; i++) chars[i] = ' ';
  const withoutCards = chars.join('');
  const looseRanks: string[] = [];
  const rankRe = /(?:^|[^0-9A-Za-z])(10|[2-9TJQKA])(?=$|[^0-9A-Za-z])/g;
  let rm: RegExpExecArray | null;
  while ((rm = rankRe.exec(withoutCards)) !== null) looseRanks.push(normRank(rm[1]));

  // Amounts.
  const amounts: number[] = [];
  let am: RegExpExecArray | null;
  AMOUNT_RE.lastIndex = 0;
  while ((am = AMOUNT_RE.exec(raw)) !== null) {
    if (am.index > 0 && raw[am.index - 1] === '#') continue; // skip hand IDs, e.g. "Hand #210000000001"
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

  // Title: first line with enough NON-card letters, e.g. a tournament name.
  // Stripping card tokens first rejects board/hole-card rows like "Ah 7d 2c Ts".
  const title = lines.find((l) => {
    if (l.length < 4 || POT_HINT.test(l)) return false;
    const residual = l.replace(CARD_RE, ' ');
    return (residual.match(/[A-Za-z가-힣]/g) || []).length >= 3;
  });

  return { cards, looseRanks, pot, amounts, title, lines };
}
