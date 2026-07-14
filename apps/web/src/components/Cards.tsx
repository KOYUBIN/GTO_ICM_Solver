import React from 'react';

const RED = new Set(['h', 'd']);
const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

/** Render a string of cards like "AsKh" as little card chips. */
export function PlayingCards({ cards }: { cards: string }) {
  const clean = cards.replace(/\s+/g, '');
  const out: React.ReactNode[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const rank = clean[i].toUpperCase();
    const suit = clean[i + 1].toLowerCase();
    out.push(
      <span key={i} className={`playing-card suit-${suit}`}>
        {rank}
        {SUIT_GLYPH[suit] ?? suit}
      </span>,
    );
  }
  return <span>{out}</span>;
}
