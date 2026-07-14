'use client';

import { useMemo, useState } from 'react';
import { cardsToString, cardToString, streetEquities, type TableState } from '@gto/engine';

const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RED = new Set(['h', 'd']);
const STREET_KO: Record<string, string> = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' };

function MiniCard({ card, small }: { card: number; small?: boolean }) {
  const w = small ? 24 : 30;
  const h = small ? 34 : 42;
  if (card < 0) {
    return (
      <span
        className="playing-card"
        style={{ width: w, height: h, background: 'linear-gradient(135deg,#2a3a55,#1a2030)', color: '#5a6a85' }}
      >
        ?
      </span>
    );
  }
  const str = cardToString(card);
  return (
    <span className={`playing-card suit-${str[1]}`} style={{ width: w, height: h }}>
      {str[0]}
      {SUIT_GLYPH[str[1]]}
    </span>
  );
}

/**
 * WPL-style post-hand result overlay. Appears at showdown showing the board, the
 * revealed contenders' hole cards and final hands, who won how much, and — for
 * contested all-in-style pots — the street-by-street equity swing with a
 * bad-beat flag when the winner was an underdog at the point of commitment.
 */
export function HandResult({ state, youId }: { state: TableState; youId: string | null }) {
  const handNo = state.handNumber;
  const isShowdown = state.currentStreet === 'showdown' && state.winners.length > 0;
  const [dismissedHand, setDismissedHand] = useState<number | null>(null);

  // Contenders whose cards are actually revealed (not folded / not redacted).
  const contenders = state.seats.filter(
    (s) =>
      s.status !== 'folded' &&
      s.status !== 'empty' &&
      s.holeCards.length === 2 &&
      s.holeCards.every((c) => c >= 0),
  );

  const boardStr = cardsToString(state.board);
  const handsKey = contenders.map((s) => `${s.id}:${cardsToString(s.holeCards)}`).join('|');

  // Compute the per-street equity once per hand (river is exact).
  const eqRows = useMemo(() => {
    if (contenders.length < 2) return null;
    try {
      // Runs synchronously during render, so keep it cheap — this is an
      // at-a-glance overview (the river row is exact regardless of iterations).
      return streetEquities(
        contenders.map((s) => cardsToString(s.holeCards)),
        boardStr,
        { iterations: 2000, seed: handNo + 1 },
      );
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handNo, handsKey, boardStr]);

  if (!isShowdown || dismissedHand === handNo) return null;

  const winnerIds = new Set(state.winners.map((w) => w.seatId));
  const wonBy = (id: string) => state.winners.filter((w) => w.seatId === id).reduce((a, w) => a + w.amount, 0);
  const uncontested = state.winners.some((w) => w.hand === 'uncontested');
  const finalEq = eqRows?.[eqRows.length - 1]?.equities;
  const preEq = eqRows?.find((r) => r.street === 'preflop')?.equities;
  const totalWon = state.winners.reduce((a, w) => a + w.amount, 0);

  // Bad beat: a winner who was the underdog at the commitment street (preflop).
  let badBeat = false;
  if (preEq && contenders.length >= 2) {
    const maxPre = Math.max(...preEq);
    contenders.forEach((s, i) => {
      if (winnerIds.has(s.id) && preEq[i] < maxPre - 1e-9) badBeat = true;
    });
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
      onClick={() => setDismissedHand(handNo)}
    >
      <div
        className="card"
        style={{ maxWidth: 620, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>핸드 #{handNo} 결과</h2>
          <button className="secondary" onClick={() => setDismissedHand(handNo)} style={{ padding: '4px 12px' }}>
            닫기
          </button>
        </div>

        {state.board.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '12px 0' }}>
            {state.board.map((c, i) => (
              <MiniCard key={`${i}-${c}`} card={c} />
            ))}
          </div>
        )}

        {uncontested ? (
          <p style={{ textAlign: 'center', margin: '12px 0' }}>
            상대가 모두 폴드 — {' '}
            <strong style={{ color: 'var(--warn)' }}>
              {state.seats.find((s) => winnerIds.has(s.id))?.name ?? '승자'}
            </strong>{' '}
            +{totalWon.toLocaleString()} 획득 (쇼다운 없음)
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>플레이어</th>
                  {(eqRows ?? []).map((r) => (
                    <th key={r.cards} style={{ padding: '6px 8px' }}>
                      {STREET_KO[r.street]}
                    </th>
                  ))}
                  <th style={{ padding: '6px 8px' }}>결과</th>
                </tr>
              </thead>
              <tbody>
                {contenders.map((seat, pi) => {
                  const isWinner = winnerIds.has(seat.id);
                  const isYou = !!youId && seat.id === youId;
                  return (
                    <tr
                      key={seat.id}
                      style={{
                        borderTop: '1px solid var(--border)',
                        background: isWinner ? 'rgba(210,153,34,0.10)' : undefined,
                      }}
                    >
                      <td style={{ padding: '8px', textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>
                            <strong>{seat.name}</strong>
                            {isYou ? ' (나)' : ''}
                          </span>
                          <span style={{ display: 'flex', gap: 3 }}>
                            {seat.holeCards.map((c, i) => (
                              <MiniCard key={i} card={c} small />
                            ))}
                          </span>
                        </div>
                      </td>
                      {(eqRows ?? []).map((r) => {
                        const eq = r.equities[pi];
                        const best = eq === Math.max(...r.equities);
                        return (
                          <td
                            key={r.cards}
                            style={{
                              padding: '8px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: best ? 700 : 400,
                              color: best ? 'var(--accent)' : 'var(--text)',
                            }}
                          >
                            {(eq * 100).toFixed(1)}%
                          </td>
                        );
                      })}
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {isWinner ? (
                          <span style={{ color: 'var(--warn)', fontWeight: 700 }}>+{wonBy(seat.id).toLocaleString()}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!uncontested && (
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            {state.winners
              .map((w) => {
                const nm = state.seats.find((s) => s.id === w.seatId)?.name ?? '?';
                return `${nm} +${w.amount.toLocaleString()} (${w.hand})`;
              })
              .join(' · ')}
            {finalEq && badBeat && (
              <strong style={{ color: 'var(--danger)' }}> · 언더독 역전 — 배드빗!</strong>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
