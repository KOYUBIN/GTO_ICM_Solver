'use client';

import { useMemo, useState } from 'react';
import {
  getChart,
  shoveEv,
  openRaiseEv,
  realizationFor,
  topPercentRange,
  parseRange,
  rangePercent,
  labelToCombos,
  comboCount,
  cardsToString,
  equityVsRanges,
  allGridLabels,
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

type Tab = 'ev' | 'equity' | 'validate';

// Approximate heads-up Nash SB-shove percentages (commonly cited reference).
const NASH_HU_SHOVE: Record<number, number> = { 6: 48, 8: 42, 10: 37, 12: 33, 15: 28, 20: 23 };
const ALL_LABELS = allGridLabels();

/** Build a real BB-defense continue range vs hero's open, if charted. */
function bbDefenseRange(heroPos: Position, stackBB: number): Map<string, number> | null {
  const s = getChart({ gameType: 'cash', stackBB, heroPos: 'BB', villainPos: heroPos, line: 'vs-RFI' });
  if (s.source !== 'chart') return null;
  const m = new Map<string, number>();
  for (const [label, f] of s.hands) {
    const cont = (f.call ?? 0) + (f.raise ?? 0);
    if (cont > 0) m.set(label, Math.min(1, cont));
  }
  return m.size ? m : null;
}

export default function ChartsPage() {
  const [tab, setTab] = useState<Tab>('ev');
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

  // Position-aware continue range (real BB defense when available).
  const continueRange = useMemo(
    () => bbDefenseRange(heroPos, stackBB) ?? topPercentRange(callPercent),
    [heroPos, stackBB, callPercent],
  );

  // Per-action approximate EVs for the selected hand.
  const actionEvs = useMemo(() => {
    if (!selected) return null;
    const realization = realizationFor(playersBehind);
    const allin = shoveEv(selected, { stackBB, callPercent, playersBehind, iterations: 4000 }).evShove;
    const raise = openRaiseEv(selected, {
      raiseTo,
      continueRange,
      continuePercent: callPercent,
      playersBehind,
      realization,
      iterations: 4000,
    });
    const rows = [
      { key: 'raise', label: `레이즈 ${raiseTo}`, ev: raise, color: '#f85149' },
      { key: 'allin', label: `올인 ${stackBB}`, ev: allin, color: '#f0883e' },
      { key: 'fold', label: '폴드', ev: 0, color: '#3b6fb0' },
    ];
    const best = rows.reduce((m, r) => (r.ev > m.ev ? r : m), rows[0]).key;
    return { rows, best, realization };
  }, [selected, stackBB, callPercent, raiseTo, playersBehind, continueRange]);

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

      {/* Spot bar */}
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
                  background: isHero
                    ? 'rgba(63,185,80,0.12)'
                    : isVillain
                      ? 'rgba(88,166,255,0.12)'
                      : 'var(--bg-elevated)',
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {([
          ['ev', '전략 + EV'],
          ['equity', '에쿼티 차트'],
          ['validate', '검증'],
        ] as [Tab, string][]).map(([t, lbl]) => (
          <button key={t} className={tab === t ? '' : 'secondary'} onClick={() => setTab(t)}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'ev' && (
        <div className="split-2col">
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

          <div className="card">
            {selected ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h2 style={{ marginTop: 0, fontSize: 16 }}>{selected}</h2>
                  <span className="muted">전략 + EV</span>
                </div>

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
                  콤보별 액션 EV (chip-EV, bb · 근사 · 실현계수 {actionEvs?.realization.toFixed(2)})
                </div>

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
                  * 레이즈 EV는 포지션별 BB 디펜드 레인지 + 실현계수를 반영한 칩EV 근사입니다.
                </p>
              </>
            ) : (
              <p className="muted">그리드에서 핸드를 클릭하세요.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'equity' && <EquityChart strategy={strategy} oppRange={continueRange} />}

      {tab === 'validate' && <Validation />}
    </div>
  );
}

/* ----------------------------- Equity chart ----------------------------- */

function EquityChart({
  strategy,
  oppRange,
}: {
  strategy: ReturnType<typeof getChart>;
  oppRange: Map<string, number>;
}) {
  const [rows, setRows] = useState<{ label: string; eq: number; weight: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Editable opponent range — defaults to a wide defend range; users can type
  // any solver-notation range to compute equity against it.
  const [oppText, setOppText] = useState('22+, A2s+, K9s+, Q9s+, J9s+, T9s, A8o+, KTo+, QJo');
  const [useCustomOpp, setUseCustomOpp] = useState(false);

  const customOpp = useMemo(() => {
    try {
      const r = parseRange(oppText);
      return r.size ? r : null;
    } catch {
      return null;
    }
  }, [oppText]);
  const opp = useCustomOpp && customOpp ? customOpp : oppRange;
  const oppPct = rangePercent(opp);

  const raiseHands = useMemo(
    () =>
      [...strategy.hands.entries()]
        .filter(([, f]) => (f.raise ?? 0) > 0)
        .map(([label, f]) => ({ label, weight: f.raise })),
    [strategy],
  );

  function compute() {
    setBusy(true);
    setTimeout(() => {
      const out = raiseHands.map(({ label, weight }) => {
        const hero = cardsToString(labelToCombos(label)[0]);
        const eq = equityVsRanges(hero, [opp], { iterations: 1200, seed: 99 });
        return { label, eq: eq.equities[0], weight };
      });
      out.sort((a, b) => b.eq - a.eq);
      setRows(out);
      setBusy(false);
    }, 10);
  }

  const avg = rows
    ? rows.reduce((s, r) => s + r.eq * comboCount(r.label) * r.weight, 0) /
      (rows.reduce((s, r) => s + comboCount(r.label) * r.weight, 0) || 1)
    : 0;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>에쿼티 분포 — 오픈 레인지 vs 디펜드 레인지</h2>
        <button onClick={compute} disabled={busy || !raiseHands.length}>
          {busy ? '계산 중…' : '계산'}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        현재 스팟의 레이즈 레인지 각 핸드가 상대 레인지 대비 갖는 에쿼티를 정렬해 보여줍니다.
      </p>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={useCustomOpp}
            onChange={(e) => setUseCustomOpp(e.target.checked)}
            style={{ width: 'auto' }}
          />
          상대 레인지 직접 지정 ({useCustomOpp ? '사용자 지정' : '차트 디펜드 레인지'} · {oppPct.toFixed(1)}%)
        </label>
        <input
          type="text"
          value={oppText}
          onChange={(e) => setOppText(e.target.value)}
          disabled={!useCustomOpp}
          placeholder="예: 22+, ATs+, KQs, AJo+"
          style={{ opacity: useCustomOpp ? 1 : 0.5 }}
        />
        {useCustomOpp && !customOpp && (
          <p className="muted" style={{ color: 'var(--danger)', marginTop: 4 }}>
            레인지를 해석할 수 없습니다.
          </p>
        )}
      </div>

      {!rows && <p className="muted">«계산»을 눌러 몬테카를로 에쿼티 분포를 생성하세요.</p>}
      {rows && (
        <>
          <div className="stat">
            <span>레인지 평균 에쿼티</span>
            <span className="val">{(avg * 100).toFixed(1)}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 160, marginTop: 14 }}>
            {rows.map((r) => (
              <div
                key={r.label}
                title={`${r.label}: ${(r.eq * 100).toFixed(1)}%`}
                style={{
                  flex: 1,
                  height: `${r.eq * 100}%`,
                  background: r.eq >= 0.5 ? 'var(--accent)' : '#3b6fb0',
                  borderRadius: '2px 2px 0 0',
                  minWidth: 2,
                }}
              />
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            왼쪽=강함(높은 에쿼티) → 오른쪽=약함. 50% 기준 초록/파랑. (핸드 {rows.length}개, 각 1200 시뮬)
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------ Validation ------------------------------ */

function Validation() {
  const [rows, setRows] = useState<{ bb: number; mine: number; ref: number }[] | null>(null);
  const [busy, setBusy] = useState(false);

  function compute() {
    setBusy(true);
    setTimeout(() => {
      const stacks = [6, 8, 10, 12, 15, 20];
      const out = stacks.map((bb) => {
        // Heads-up (playersBehind=1) shove %: combo-weighted share of hands
        // whose shove EV beats folding, assuming a ~45% calling range.
        let combosShove = 0;
        for (const label of ALL_LABELS) {
          const r = shoveEv(label, { stackBB: bb, callPercent: 45, playersBehind: 1, iterations: 600 });
          if (r.best === 'shove') combosShove += comboCount(label);
        }
        return { bb, mine: (combosShove / 1326) * 100, ref: NASH_HU_SHOVE[bb] };
      });
      setRows(out);
      setBusy(false);
    }, 10);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>근사 검증 — 헤즈업 셔브% vs Nash 참고치</h2>
        <button onClick={compute} disabled={busy}>
          {busy ? '계산 중…' : '검증 실행'}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        헤즈업(SB 셔브, 상대 콜 45% 가정)에서 우리 모델의 셔브 레인지 %를, 통용되는 Nash 근사 참고치와
        비교합니다. 정확한 솔버 검증이 아닌 <b>방향성·러프 비교</b>입니다.
      </p>
      {!rows && <p className="muted">«검증 실행»을 누르세요. (169핸드 × 6스택 몬테카를로 — 몇 초 소요)</p>}
      {rows && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '6px 0' }}>스택(BB)</th>
              <th>우리 모델 셔브%</th>
              <th>Nash 참고%</th>
              <th>차이</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.mine - r.ref;
              return (
                <tr key={r.bb} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                  <td style={{ textAlign: 'left', padding: '7px 0' }}>{r.bb}</td>
                  <td>{r.mine.toFixed(0)}%</td>
                  <td>{r.ref}%</td>
                  <td style={{ color: Math.abs(diff) <= 8 ? 'var(--accent)' : 'var(--warn)' }}>
                    {diff >= 0 ? '+' : ''}
                    {diff.toFixed(0)}%p
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
        * 셔브가 단조적으로 넓어지고(스택↓) 프리미엄은 항상 셔브, 트래시는 폴드인지(질적 검증) + Nash
        참고치와의 편차(양적 러프 검증)를 함께 봅니다. 참고치는 통용되는 헤즈업 Nash 근사값입니다.
      </p>
    </div>
  );
}
