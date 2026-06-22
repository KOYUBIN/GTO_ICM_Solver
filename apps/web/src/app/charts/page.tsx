'use client';

import { useMemo, useState } from 'react';
import {
  getChart,
  POSITIONS_6MAX,
  availableVsRfi,
  type Position,
  type ActionLine,
  type PreflopAction,
} from '@gto/engine';
import { ActionGrid } from '@/components/ActionGrid';

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
    for (const [label, f] of strategy.hands) {
      m.set(label, f as Record<PreflopAction, number>);
    }
    return m;
  }, [strategy]);

  // Aggregate frequencies across the grid (combo-weighted would need counts;
  // here we report simple share of hands taking each action > 0).
  const summary = useMemo(() => {
    let raise = 0;
    let call = 0;
    for (const f of strategy.hands.values()) {
      raise += f.raise;
      call += f.call;
    }
    return { raise, call };
  }, [strategy]);

  return (
    <div className="container">
      <h1>프리플랍 차트 · 상황 선택기</h1>
      <p className="subtitle">
        GTO Wizard 스타일로 스팟을 선택하면 해당 전략(레인지·믹스)을 보여줍니다. 100bb 6맥스 GTO
        근사 차트입니다.
      </p>

      <div className="card">
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
          <div>
            <label>히어로 포지션</label>
            <select value={heroPos} onChange={(e) => setHeroPos(e.target.value as Position)}>
              {POSITIONS_6MAX.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {line === 'vs-RFI' && (
            <div>
              <label>빌런(오프너) 포지션</label>
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
            <input
              type="number"
              value={stackBB}
              onChange={(e) => setStackBB(Number(e.target.value) || 100)}
            />
          </div>
        </div>

        {line === 'vs-RFI' && (
          <div style={{ marginTop: 12 }}>
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

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{strategy.label}</h2>
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
        <ActionGrid data={gridData} colors={ACTION_COLORS} />
        <div style={{ marginTop: 14 }}>
          <div className="stat">
            <span>레이즈/3벳 (그리드 합)</span>
            <span className="val">{summary.raise.toFixed(1)}</span>
          </div>
          <div className="stat">
            <span>콜 (그리드 합)</span>
            <span className="val">{summary.call.toFixed(1)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
