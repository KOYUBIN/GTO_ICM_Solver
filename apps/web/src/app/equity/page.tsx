'use client';

import { useState } from 'react';
import { calcEquity, rangeToCombos, parseRange, type PlayerSpec } from '@gto/engine';
import { PlayingCards } from '@/components/Cards';
import { BoardPicker } from '@/components/Pickers';

/** Card-string of an input, but only when it's exact cards (not a range). */
function exactCardsOf(input: string): string {
  const t = input.replace(/[\s,]/g, '');
  return /^([2-9TJQKA][cdhs])+$/i.test(t) ? t : '';
}

interface Result {
  labels: string[];
  equities: number[];
  wins: number[];
  ties: number[];
  iterations: number;
}

export default function EquityPage() {
  const [hero, setHero] = useState('AsKs');
  const [villain, setVillain] = useState('QQ-99, AQs+');
  const [board, setBoard] = useState('');
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  function specFor(input: string): PlayerSpec {
    const t = input.trim();
    // Treat as exact cards when it's a clean 2-card / 4-card hex like "AsKs".
    if (/^([2-9TJQKA][cdhs]){2}$/i.test(t)) return { cards: t };
    const combos = rangeToCombos(parseRange(t)).map((x) => x.combo);
    if (!combos.length) throw new Error(`레인지/핸드를 해석할 수 없습니다: "${input}"`);
    return { combos };
  }

  function run() {
    setError('');
    setBusy(true);
    setTimeout(() => {
      try {
        const players = [specFor(hero), specFor(villain)];
        const res = calcEquity(players, {
          board: board.trim() || undefined,
          iterations: 30000,
          seed: 12345,
        });
        setResult({
          labels: ['히어로', '빌런'],
          equities: res.equities,
          wins: res.wins,
          ties: res.ties,
          iterations: res.iterations,
        });
      } catch (e) {
        setError((e as Error).message);
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 10);
  }

  return (
    <div className="container">
      <h1>에쿼티 계산기</h1>
      <p className="subtitle">
        정확한 핸드(예: <code>AsKs</code>) 또는 레인지(예: <code>QQ-99, AQs+</code>)를 입력하세요.
      </p>

      <div className="card">
        <div className="row">
          <div>
            <label>히어로</label>
            <input type="text" value={hero} onChange={(e) => setHero(e.target.value)} />
          </div>
          <div>
            <label>빌런</label>
            <input type="text" value={villain} onChange={(e) => setVillain(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label>보드 (선택, 예: Ah7d2c)</label>
          <input type="text" value={board} onChange={(e) => setBoard(e.target.value)} />
          <button
            type="button"
            className="secondary"
            onClick={() => setShowBoardPicker((v) => !v)}
            style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }}
          >
            카드로 선택 {showBoardPicker ? '▲' : '▼'}
          </button>
          {showBoardPicker && (
            <div style={{ marginTop: 8 }}>
              <BoardPicker
                value={board}
                onChange={setBoard}
                max={5}
                used={exactCardsOf(hero) + exactCardsOf(villain)}
              />
            </div>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={run} disabled={busy}>
            {busy ? '계산 중…' : '에쿼티 계산'}
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
          {board.trim() && (
            <div style={{ marginBottom: 12 }}>
              <PlayingCards cards={board} />
            </div>
          )}
          {result.labels.map((label, i) => {
            const pct = result.equities[i] * 100;
            return (
              <div key={i} style={{ marginBottom: 14 }}>
                <div className="stat" style={{ border: 'none', paddingBottom: 4 }}>
                  <span>
                    <strong>{label}</strong>{' '}
                    <span className="muted">
                      {i === 0 ? <PlayingCards cards={hero} /> : null}
                    </span>
                  </span>
                  <span className="val">{pct.toFixed(2)}%</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  승 {result.wins[i].toLocaleString()} · 무 {result.ties[i].toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
