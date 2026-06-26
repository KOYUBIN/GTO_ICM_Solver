'use client';

import { useEffect, useState } from 'react';
import { streetEquities, parseCards, type StreetEquity } from '@gto/engine';
import { PlayingCards } from '@/components/Cards';

const POSITIONS = ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const STREET_KO: Record<string, string> = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' };

interface Player {
  name: string;
  pos: string;
  cards: string;
}

// Prefilled with a WPL-style example: KK vs 88 all-in, 88 spikes a set.
const DEFAULT_PLAYERS: Player[] = [
  { name: 'ubin', pos: 'BTN', cards: 'KsKc' },
  { name: 'Forgiven', pos: 'BB', cards: '8h8d' },
];

function isCards(s: string, n: number): boolean {
  const t = s.replace(/\s+/g, '');
  if (t.length !== n * 2) return false;
  try {
    return parseCards(t).length === n;
  } catch {
    return false;
  }
}

export default function ReplayPage() {
  const [title, setTitle] = useState('클래식 200억 GTD');
  const [pot, setPot] = useState('599114');
  const [board, setBoard] = useState('8s7c2d Qh 3s');
  const [players, setPlayers] = useState<Player[]>(DEFAULT_PLAYERS);
  const [result, setResult] = useState<{ rows: StreetEquity[]; players: Player[]; board: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fromOcr, setFromOcr] = useState(false);

  // Apply an OCR handoff from /analyze (best-effort: hole cards then board).
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('replayPrefill');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      sessionStorage.removeItem('replayPrefill');
    } catch {
      /* ignore */
    }
    try {
      const p = JSON.parse(raw) as { title?: string; pot?: string; cards?: string[] };
      if (p.title) setTitle(p.title);
      if (p.pot) setPot(p.pot);
      const cards = (p.cards ?? []).filter((c) => typeof c === 'string');
      if (cards.length >= 4) {
        // Guess: first two pairs are the two players' hole cards, rest is board.
        setPlayers([
          { name: 'P1', pos: 'BTN', cards: cards.slice(0, 2).join('') },
          { name: 'P2', pos: 'BB', cards: cards.slice(2, 4).join('') },
        ]);
        const board = cards.slice(4, 9);
        if (board.length >= 3) setBoard(board.join(' '));
        else setBoard('');
      }
      setFromOcr(true);
    } catch {
      /* ignore malformed prefill */
    }
  }, []);

  function setPlayer(i: number, patch: Partial<Player>) {
    setPlayers(players.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addPlayer() {
    if (players.length < 6) setPlayers([...players, { name: `P${players.length + 1}`, pos: 'CO', cards: '' }]);
  }
  function removePlayer(i: number) {
    if (players.length > 2) setPlayers(players.filter((_, idx) => idx !== i));
  }

  function analyze() {
    setError('');
    const hands = players.map((p) => p.cards.replace(/\s+/g, ''));
    for (const [i, h] of hands.entries()) {
      if (!isCards(h, 2)) {
        setError(`${players[i].name || `P${i + 1}`}의 홀카드가 올바르지 않습니다 (예: KsKc).`);
        return;
      }
    }
    const b = board.replace(/\s+/g, '');
    if (b.length && (b.length % 2 !== 0 || b.length > 10 || !isCards(b, b.length / 2))) {
      setError('보드가 올바르지 않습니다 (0/3/4/5장, 예: 8s7c2d Qh 3s).');
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        const rows = streetEquities(hands, b, { iterations: 30000 });
        setResult({ rows, players: [...players], board: b });
      } catch (e) {
        setError((e as Error).message);
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 10);
  }

  const finalEq = result?.rows[result.rows.length - 1]?.equities ?? [];
  const winnerIdx = finalEq.length ? finalEq.indexOf(Math.max(...finalEq)) : -1;
  const preEq = result?.rows.find((r) => r.street === 'preflop')?.equities;

  return (
    <div className="container" style={{ maxWidth: 980 }}>
      <h1>핸드 리플레이 · 올인 에쿼티 분석</h1>
      <p className="subtitle">
        WPL식으로 올인 핸드를 입력하면 스트리트별 에쿼티(예: 88 vs KK = 19.5%)와 승자·결과를 보여줍니다.
      </p>

      {fromOcr && (
        <div
          className="card"
          style={{ borderColor: 'var(--accent)', background: 'rgba(88,166,255,0.06)', marginBottom: 14 }}
        >
          <strong>스크린샷에서 불러왔습니다 (베타)</strong>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            카드 무늬는 OCR 인식이 불완전할 수 있고, 홀카드/보드 배치는 추정입니다. 아래 값을 확인·수정한 뒤
            분석하세요.
          </p>
        </div>
      )}

      <div className="card">
        <div className="row">
          <div style={{ flex: 2 }}>
            <label>핸드/토너먼트 (선택)</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label>팟 (선택)</label>
            <input type="text" value={pot} onChange={(e) => setPot(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>보드 (0/3/4/5장 · 예: 8s7c2d Qh 3s)</label>
          <input type="text" value={board} onChange={(e) => setBoard(e.target.value)} />
          {board.trim() && (
            <div style={{ marginTop: 8 }}>
              <PlayingCards cards={board} />
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <label>플레이어 (올인 참가자)</label>
          {players.map((p, i) => (
            <div key={i} className="row" style={{ marginTop: 8, alignItems: 'center' }}>
              <input
                type="text"
                value={p.name}
                placeholder="이름"
                onChange={(e) => setPlayer(i, { name: e.target.value })}
                style={{ flex: '0 0 110px' }}
              />
              <select value={p.pos} onChange={(e) => setPlayer(i, { pos: e.target.value })} style={{ flex: '0 0 90px' }}>
                {POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={p.cards}
                placeholder="홀카드 (예: KsKc)"
                onChange={(e) => setPlayer(i, { cards: e.target.value })}
              />
              {p.cards.replace(/\s+/g, '').length === 4 && isCards(p.cards, 2) && <PlayingCards cards={p.cards} />}
              <button
                className="secondary"
                onClick={() => removePlayer(i)}
                disabled={players.length <= 2}
                style={{ flex: '0 0 auto', padding: '6px 10px' }}
              >
                삭제
              </button>
            </div>
          ))}
          <button className="secondary" style={{ marginTop: 8 }} onClick={addPlayer} disabled={players.length >= 6}>
            + 플레이어
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={analyze} disabled={busy}>
            {busy ? '분석 중…' : '분석'}
          </button>
        </div>
        {error && (
          <p className="muted" style={{ color: 'var(--danger)', marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{title || '핸드'}</h2>
            {pot.trim() && <span className="muted">팟 {Number(pot).toLocaleString()}</span>}
          </div>
          {result.board && (
            <div style={{ marginBottom: 12 }}>
              <PlayingCards cards={result.board} />
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>플레이어</th>
                  {result.rows.map((r) => (
                    <th key={r.cards} style={{ padding: '6px 8px' }}>
                      {STREET_KO[r.street]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.players.map((p, pi) => {
                  const isWinner = pi === winnerIdx;
                  return (
                    <tr
                      key={pi}
                      style={{
                        borderTop: '1px solid var(--border)',
                        background: isWinner ? 'rgba(63,185,80,0.08)' : undefined,
                      }}
                    >
                      <td style={{ padding: '8px', textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ minWidth: 70 }}>
                            <strong>{p.name || `P${pi + 1}`}</strong>
                            <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                              {p.pos}
                            </span>
                          </span>
                          <PlayingCards cards={p.cards} />
                          {isWinner && (
                            <span className="pill push" style={{ marginLeft: 4 }}>
                              승
                            </span>
                          )}
                        </div>
                      </td>
                      {result.rows.map((r) => {
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preEq && winnerIdx >= 0 && (
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              올인 시점(프리플랍) 에쿼티 — {result.players.map((p, i) => `${p.name || `P${i + 1}`} ${(preEq[i] * 100).toFixed(1)}%`).join(' · ')}.
              {' '}최종 승자: <strong style={{ color: 'var(--accent)' }}>{result.players[winnerIdx].name || `P${winnerIdx + 1}`}</strong>
              {preEq[winnerIdx] < 0.5 ? ' (언더독 역전 — 배드빗)' : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
