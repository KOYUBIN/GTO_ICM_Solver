'use client';

import { useMemo, useState } from 'react';
import {
  getChart,
  shoveEv,
  openRaiseEv,
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
  { action: 'fold', color: '#3b6fb0', label: '폴드' },
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
  const [raiseTo, setRaiseTo] = useState(2.5);
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

  // Per-action approximate EVs for the selected hand (combos are ~symmetric
  // preflop, so the whole class shares these numbers — as in GTO Wizard).
  const actionEvs = useMemo(() => {
    if (!selected) return null;
    const allin = shoveEv(selected, { stackBB, callPercent, playersBehind, iterations: 4000 }).evShove;
    const raise = openRaiseEv(selected, {
      raiseTo,
      continuePercent: callPercent,
      playersBehind,
      iterations: 4000,
    });
    const rows = [
      { key: 'raise', label: `레이즈 ${raiseTo}`, ev: raise, color: '#f85149' },
      { key: 'allin', label: `올인 ${stackBB}`, ev: allin, color: '#f0883e' },
      { key: 'fold', label: '폴드', ev: 0, color: '#3b6fb0' },
    ];
    const best = rows.reduce((m, r) => (r.ev > m.ev ? r : m), rows[0]).key;
    return { rows, best };
  }, [selected, stackBB, callPercent, raiseTo, playersBehind]);

  const selFreqs = selected ? strategy.hands.get(selected) : undefined;
  const combos = selected ? labelToCombos(selected) : [];
  const bestColor = actionEvs?.rows.find((r) => r.key === actionEvs.best)?.color ?? '#2a323d';

  return (
    <div className="container" style={{ maxWidth: 1180 }}>
      <h1>프리플랍 차트 · 전략 + EV</h1>
      <p className="subtitle">
        스팟을 고르면 GTO 전략 그리드를, 핸드를 클릭하면 콤보별 액션 EV를 봅니다. 100bb 6맥스 GTO 근사
        + 칩EV 근사입니다.
      </p>

      {/* Action-sequence / spot bar */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            캐시 · {stackBB}bb
          </div>
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
                  border: isHero ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: isHero ? 'rgba(63,185,80,0.12)' : isVillain ? 'rgba(88,166,255,0.12)' : 'var(--bg-elevated)',
                  color: 'var(--text)',
                  fontWeight: 600,
                  fontSize: 13,
                  textAlign: 'center',
                  minWidth: 64,
                }}
              >
                <div>{p}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {isHero ? (line === 'RFI' ? '오픈?' : '대응?') : isVillain ? '오프너' : `${stackBB}`}
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
            <label>레이즈 사이즈 (BB)</label>
            <input
              type="number"
              step={0.5}
              value={raiseTo}
              onChange={(e) => setRaiseTo(Number(e.target.value) || 2.5)}
            />
          </div>
          <div>
            <label>상대 콜/디펜드 %: {callPercent}</label>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
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
            셀 색은 GTO 액션 비율(레이즈/콜/폴드 %)대로 칠해집니다. 핸드를 클릭하면 →
          </p>
        </div>

        {/* EV panel — GTO-Wizard-style combo cards */}
        <div className="card">
          {selected ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 style={{ marginTop: 0, fontSize: 16 }}>{selected}</h2>
                <span className="muted">전략 + EV</span>
              </div>

              {/* GTO action mix (this colors the grid) */}
              {selFreqs && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  {(['raise', 'call', 'fold'] as PreflopAction[]).map((a) => {
                    const f = selFreqs[a] ?? 0;
                    const c = ACTION_COLORS.find((x) => x.action === a)!;
                    return (
                      <div key={a} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ height: 6, borderRadius: 3, background: c.color, opacity: f > 0 ? 1 : 0.25 }} />
                        <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700 }}>{(f * 100).toFixed(0)}%</div>
                        <div className="muted" style={{ fontSize: 11 }}>{c.label}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                콤보별 액션 EV (chip-EV, bb · 근사)
              </div>

              {/* Per-combo cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {combos.map((combo, i) => (
                  <div
                    key={i}
                    style={{
                      border: `1px solid var(--border)`,
                      borderLeft: `4px solid ${bestColor}`,
                      borderRadius: 8,
                      padding: 8,
                      background: 'var(--bg-elevated)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <PlayingCards cards={cardsToString(combo)} />
                      <span className="muted" style={{ fontSize: 11 }}>EV</span>
                    </div>
                    {actionEvs?.rows.map((r) => {
                      const isBest = r.key === actionEvs.best;
                      return (
                        <div
                          key={r.key}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 12,
                            padding: '2px 4px',
                            borderRadius: 4,
                            background: isBest ? `${r.color}22` : 'transparent',
                            fontWeight: isBest ? 700 : 400,
                          }}
                        >
                          <span style={{ color: isBest ? r.color : 'var(--text)' }}>{r.label}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {r.ev >= 0 ? '+' : ''}
                            {r.ev.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
                * 레이즈/올인 EV는 푸시폴드·오픈레이즈 칩EV 근사입니다. 최고 EV 액션이 강조됩니다.
              </p>
            </>
          ) : (
            <p className="muted">그리드에서 핸드를 클릭하세요.</p>
          )}
        </div>
      </div>
    </div>
  );
}
