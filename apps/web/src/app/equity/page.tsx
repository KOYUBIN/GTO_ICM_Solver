'use client';

import { useState } from 'react';
import { calcEquity, rangeToCombos, parseRange, type PlayerSpec } from '@gto/engine';
import { PlayingCards } from '@/components/Cards';
import { BoardPicker } from '@/components/Pickers';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const DEFAULT_PLAYERS = ['AsKs', 'QQ-99, AQs+'];

/** Card-string of an input, but only when it's exact cards (not a range). */
function exactCardsOf(input: string): string {
  const t = input.replace(/[\s,]/g, '');
  return /^([2-9TJQKA][cdhs])+$/i.test(t) ? t : '';
}

/** True when the input is exactly two specific cards like "AsKh". */
function isExactHand(input: string): boolean {
  return /^([2-9TJQKA][cdhs]){2}$/i.test(input.trim());
}

interface ResultRow {
  label: string;
  hand: string;
  exact: boolean;
}

interface Result {
  rows: ResultRow[];
  equities: number[];
  wins: number[];
  ties: number[];
  iterations: number;
  board: string;
}

export default function EquityPage() {
  const [players, setPlayers] = useState<string[]>(DEFAULT_PLAYERS);
  const [board, setBoard] = useState('');
  // Which picker is open: a player index, 'board', or none. Only one at once.
  const [openPicker, setOpenPicker] = useState<number | 'board' | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  function setPlayer(i: number, v: string) {
    setPlayers((ps) => ps.map((p, j) => (j === i ? v : p)));
  }

  function addPlayer() {
    if (players.length >= MAX_PLAYERS) return;
    setPlayers((ps) => [...ps, '']);
    setOpenPicker(null);
  }

  function removePlayer(i: number) {
    if (players.length <= MIN_PLAYERS) return;
    setPlayers((ps) => ps.filter((_, j) => j !== i));
    setOpenPicker(null);
  }

  /** Exact cards of every player except index `skip` (pass -1 to keep all). */
  function exactCardsExcept(skip: number): string {
    return players
      .filter((_, j) => j !== skip)
      .map(exactCardsOf)
      .join('');
  }

  function specFor(input: string, label: string): PlayerSpec {
    const t = input.trim();
    if (!t) throw new Error(`${label}의 핸드 또는 레인지를 입력하세요.`);
    // Exact 2-card hand like "AsKs" → fixed cards; anything else → range.
    if (isExactHand(t)) return { cards: t };
    const combos = rangeToCombos(parseRange(t)).map((x) => x.combo);
    if (!combos.length) throw new Error(`레인지/핸드를 해석할 수 없습니다: "${input}"`);
    return { combos };
  }

  /** Duplicate card among all exact hands + board, or null. */
  function findDuplicateCard(): string | null {
    const all = (exactCardsExcept(-1) + exactCardsOf(board)).match(/.{2}/g) ?? [];
    const seen = new Set<string>();
    for (const raw of all) {
      const tok = raw[0].toUpperCase() + raw[1].toLowerCase();
      if (seen.has(tok)) return tok;
      seen.add(tok);
    }
    return null;
  }

  function run() {
    setError('');
    setBusy(true);
    setTimeout(() => {
      try {
        const dup = findDuplicateCard();
        if (dup) throw new Error(`중복된 카드가 있습니다: ${dup}`);
        const labels = players.map((_, i) => `플레이어 ${i + 1}`);
        const specs = players.map((p, i) => specFor(p, labels[i]));
        const res = calcEquity(specs, {
          board: board.trim() || undefined,
          iterations: 20000,
          seed: 12345,
        });
        setResult({
          rows: players.map((p, i) => ({
            label: labels[i],
            hand: p.trim(),
            exact: isExactHand(p),
          })),
          equities: res.equities,
          wins: res.wins,
          ties: res.ties,
          iterations: res.iterations,
          board: board.trim(),
        });
      } catch (e) {
        setError((e as Error).message);
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 10);
  }

  function reset() {
    setPlayers(['', '']);
    setBoard('');
    setOpenPicker(null);
    setResult(null);
    setError('');
  }

  const maxEquity = result ? Math.max(...result.equities) : 0;

  return (
    <div className="container">
      <h1>에쿼티 계산기</h1>
      <p className="subtitle">
        플레이어별로 정확한 핸드(예: <code>AsKh</code>) 또는 레인지(예: <code>QQ+, AKs</code>)를
        입력하세요. 최대 {MAX_PLAYERS}명까지 지원합니다. (레인지 입력은 계산이 다소 느릴 수 있습니다)
      </p>

      <div className="card">
        {players.map((v, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <label>플레이어 {i + 1}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={v}
                onChange={(e) => setPlayer(i, e.target.value)}
                placeholder="AsKh 또는 QQ+, AKs"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setOpenPicker(openPicker === i ? null : i)}
                style={{ padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
              >
                선택 {openPicker === i ? '▲' : '▼'}
              </button>
              {players.length > MIN_PLAYERS && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => removePlayer(i)}
                  aria-label={`플레이어 ${i + 1} 삭제`}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                >
                  ✕
                </button>
              )}
            </div>
            {openPicker === i && (
              <div style={{ marginTop: 8 }}>
                <BoardPicker
                  value={exactCardsOf(v)}
                  onChange={(nv) => setPlayer(i, nv)}
                  max={2}
                  used={exactCardsExcept(i) + exactCardsOf(board)}
                />
              </div>
            )}
          </div>
        ))}

        {players.length < MAX_PLAYERS && (
          <button
            type="button"
            className="secondary"
            onClick={addPlayer}
            style={{ padding: '4px 12px', fontSize: 13 }}
          >
            + 플레이어 추가
          </button>
        )}

        <div style={{ marginTop: 16 }}>
          <label>보드 (선택, 예: Ah7d2c)</label>
          <input type="text" value={board} onChange={(e) => setBoard(e.target.value)} />
          <button
            type="button"
            className="secondary"
            onClick={() => setOpenPicker(openPicker === 'board' ? null : 'board')}
            style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }}
          >
            카드로 선택 {openPicker === 'board' ? '▲' : '▼'}
          </button>
          {openPicker === 'board' && (
            <div style={{ marginTop: 8 }}>
              <BoardPicker value={board} onChange={setBoard} max={5} used={exactCardsExcept(-1)} />
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={run} disabled={busy}>
            {busy ? '계산 중…' : '계산'}
          </button>
          <button type="button" className="secondary" onClick={reset} disabled={busy}>
            초기화
          </button>
        </div>
        {error && (
          <p style={{ color: 'var(--danger)', marginTop: 12 }} className="muted">
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="card">
          <h2>결과 ({result.iterations.toLocaleString()} 시뮬레이션)</h2>
          {result.board && (
            <div style={{ marginBottom: 12 }}>
              <span className="muted" style={{ marginRight: 8 }}>
                보드
              </span>
              <PlayingCards cards={result.board} />
            </div>
          )}
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px 6px 0' }}>플레이어</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>카드/레인지</th>
                  <th style={{ padding: '6px 8px' }}>승률</th>
                  <th style={{ padding: '6px 8px' }}>무승부</th>
                  <th style={{ textAlign: 'left', padding: '6px 0 6px 12px', minWidth: 120 }}>
                    에쿼티
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => {
                  const eq = result.equities[i] * 100;
                  const tie = (result.ties[i] / result.iterations) * 100;
                  const isBest = result.equities[i] === maxEquity;
                  return (
                    <tr
                      key={i}
                      style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}
                    >
                      <td style={{ textAlign: 'left', padding: '8px 8px 8px 0' }}>{row.label}</td>
                      <td style={{ textAlign: 'left', padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        {row.exact ? <PlayingCards cards={row.hand} /> : <code>{row.hand}</code>}
                      </td>
                      <td
                        style={{
                          padding: '8px 8px',
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          color: isBest ? 'var(--accent)' : undefined,
                        }}
                      >
                        {eq.toFixed(2)}%
                      </td>
                      <td style={{ padding: '8px 8px', fontVariantNumeric: 'tabular-nums' }}>
                        {tie.toFixed(2)}%
                      </td>
                      <td style={{ padding: '8px 0 8px 12px' }}>
                        <div className="bar" style={{ minWidth: 110 }}>
                          <span style={{ width: `${eq}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
