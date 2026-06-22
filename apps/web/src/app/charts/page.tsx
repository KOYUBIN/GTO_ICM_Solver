'use client';

import { useMemo, useState } from 'react';
import {
  getChart,
  shoveEv,
  labelToCombos,
  cardsToString,
  POSITIONS_6MAX,
  availableVsRfi,
  type Position,
  type ActionLine,
  type PreflopAction,
} from '@gto/engine';
import { ActionGrid } from '@/components/ActionGrid';
import { PlayingCards } from '@/components/Cards';

const ACTION_COLORS = [
  { action: 'raise', color: '#f85149', label: '레이즈/3벳' },
  { action: 'call', color: '#3fb950', label: '콜' },
  { action: 'fold', color: '#2a323d', label: '폴드' },
];

const LINES: { value: ActionLine; label: string }[] = [
  { value: 'RFI', label: 'RFI (오픈)' },
  { value: 'vs-RFI', label: 'vs RFI (오픈 대응)' },
];

export default function ChartsPage() {
  const [line, setLine] = useState<ActionLine>('RFI');
  const [heroPos, setHeroPos] = useState<Position>('BTN');
  const [villainPos, setVillainPos] = useState<Position>('CO');
  const [stackBB, setStackBB] = useState(100);
  const [callPercent, setCallPercent] = useState(18);
  const [selected, setSelected] = useState<string | null>('AA');

  const vsRfiPairs = useMemo(() => availableVsRfi(), []);

  const strategy = useMemo(
    () =>
      getChart({
        gameType: 'cash',
        stackBB,
        heroPos,
        villainPos: line === 'vs-RFI' ? villainPos : undefined,
        line,
      }),
    [line, heroPos, villainPos, stackBB],
  );

  const gridData = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const [label, f] of strategy.hands) m.set(label, f as Record<PreflopAction, number>);
    return m;
  }, [strategy]);

  const playersBehind = useMemo(() => {
    const idx = POSITIONS_6MAX.indexOf(heroPos);
    return Math.max(1, POSITIONS_6MAX.length - 1 - idx);
  }, [heroPos]);

  // Approximate shove EV for the selected hand.
  const ev = useMemo(() => {
    if (!selected) return null;
    return shoveEv(selected, { stackBB, callPercent, playersBehind, iterations: 4000 });
  }, [selected, stackBB, callPercent, playersBehind]);

  const selFreqs = selected ? strategy.hands.get(selected) : undefined;
  const combos = selected ? labelToCombos(selected) : [];

  return (
    <div className="container" style={{ maxWidth: 1180 }}>
      <h1>프리플랍 차트 · 전략 + EV</h1>
      <p className="subtitle">
        GTO Wizard 스타일로 스팟을 고르면 전략 그리드를, 핸드를 클릭하면 콤보별 EV를 봅니다. 100bb
        6맥스 GTO 근사 + 셔브 EV 근사입니다.
      </p>

      {/* Spot / action bar */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {POSITIONS_6MAX.map((p) => {
            const isHero = p === heroPos;
            const isVillain = line === 'vs-RFI' && p === villainPos;
            return (
              <div
                key={p}
                onClick={() => setHeroPos(p)}
                style={{
                  cursor: 'pointer',
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: isHero ? 'var(--accent-dim)' : isVillain ? 'rgba(88,166,255,0.15)' : 'var(--bg-elevated)',
                  color: isHero ? '#fff' : 'var(--text)',
                  fontWeight: 600,
                  fontSize: 13,
                  textAlign: 'center',
                  minWidth: 64,
                }}
              >
                <div>{p}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>
                  {isHero ? '히어로' : isVillain ? '오프너' : `${stackBB}bb`}
                </div>
              </div>
            );
          })}
        </div>
        <div className="row">
          <div>
            <label>액션 라인</label>
            <select value={line} onChange={(e) => setLine(e.target.value as ActionLine)}>
              {LINES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          {line === 'vs-RFI' && (
            <div>
              <label>오프너 포지션</label>
              <select value={villainPos} onChange={(e) => setVillainPos(e.target.value as Position)}>
                {POSITIONS_6MAX.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label>유효 스택 (BB)</label>
            <input type="number" value={stackBB} onChange={(e) => setStackBB(Number(e.target.value) || 100)} />
          </div>
          <div>
            <label>상대 콜 빈도(EV용): {callPercent}%</label>
            <input
              type="range"
              min={5}
              max={60}
              value={callPercent}
              onChange={(e) => setCallPercent(Number(e.target.value))}
              style={{ padding: 0 }}
            />
          </div>
        </div>
        {line === 'vs-RFI' && (
          <div style={{ marginTop: 10 }}>
            <span className="muted">차트 보유 매치업: </span>
            {vsRfiPairs.map(([h, v]) => (
              <button
                key={`${h}_${v}`}
                className="secondary"
                style={{ margin: '4px 4px 0 0', padding: '4px 10px', fontSize: 13 }}
                onClick={() => {
                  setHeroPos(h);
                  setVillainPos(v);
                }}
              >
                {h} vs {v}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid + EV panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(260px, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>{strategy.label}</h2>
            <span
              className="pill"
              style={{
                background: strategy.source === 'chart' ? 'rgba(63,185,80,0.15)' : 'rgba(210,153,34,0.15)',
                color: strategy.source === 'chart' ? 'var(--accent)' : 'var(--warn)',
              }}
            >
              {strategy.source === 'chart' ? '차트 데이터' : '휴리스틱 근사'}
            </span>
          </div>
          <ActionGrid data={gridData} colors={ACTION_COLORS} selected={selected} onSelect={setSelected} />
          <p className="muted" style={{ marginTop: 10 }}>
            핸드를 클릭하면 오른쪽에 EV가 표시됩니다.
          </p>
        </div>

        {/* EV panel */}
        <div className="card">
          {selected ? (
            <>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>{selected} · 전략 + EV</h2>

              {/* chart action mix */}
              {selFreqs && (
                <div style={{ marginBottom: 14 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>차트 전략 (믹스)</div>
                  {(['raise', 'call', 'fold'] as PreflopAction[]).map((a) => {
                    const f = selFreqs[a] ?? 0;
                    const color = ACTION_COLORS.find((c) => c.action === a)!;
                    return (
                      <div key={a} className="stat" style={{ borderBottom: 'none', padding: '4px 0' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: color.color }} />
                          {color.label}
                        </span>
                        <span className="val">{(f * 100).toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* approximate shove EV */}
              {ev && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    셔브 EV 근사 (chip-EV, bb) · 상대 콜 {callPercent}%
                  </div>
                  <div className="stat">
                    <span style={{ fontWeight: 700, color: ev.best === 'shove' ? 'var(--accent)' : 'var(--text)' }}>
                      Allin {stackBB}
                    </span>
                    <span className="val" style={{ color: ev.evShove >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                      {ev.evShove >= 0 ? '+' : ''}
                      {ev.evShove.toFixed(2)}
                    </span>
                  </div>
                  <div className="stat">
                    <span style={{ fontWeight: ev.best === 'fold' ? 700 : 400 }}>Fold</span>
                    <span className="val">0.00</span>
                  </div>
                  <div className="stat">
                    <span>폴드 에쿼티</span>
                    <span className="val">{(ev.foldEquity * 100).toFixed(0)}%</span>
                  </div>
                  <div className="stat">
                    <span>콜 레인지 상대 에쿼티</span>
                    <span className="val">{(ev.equityVsCall * 100).toFixed(1)}%</span>
                  </div>
                  <div
                    className="pill"
                    style={{
                      marginTop: 10,
                      background: ev.best === 'shove' ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
                      color: ev.best === 'shove' ? 'var(--accent)' : 'var(--danger)',
                    }}
                  >
                    {ev.best === 'shove' ? '셔브 +EV' : '폴드'}
                  </div>
                </div>
              )}

              {/* combos */}
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div className="muted" style={{ marginBottom: 8 }}>콤보 ({combos.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {combos.map((c, i) => (
                    <PlayingCards key={i} cards={cardsToString(c)} />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="muted">그리드에서 핸드를 클릭하세요.</p>
          )}
        </div>
      </div>
    </div>
  );
}
