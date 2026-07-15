'use client';

import { useEffect, useRef, useState } from 'react';
import {
  allGridLabels,
  availableRfiVs3bet,
  availableVsRfi,
  cardsToString,
  comboCount,
  getChart,
  labelToCombos,
  POSITIONS_6MAX,
  type ActionLine,
  type Position,
  type PreflopAction,
} from '@gto/engine';

/* ------------------------------ constants ------------------------------- */

const STATS_KEY = 'gto-trainer-stats';
const STACK_BB = 100;
const ALL_LABELS = allGridLabels();
const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

const ACTION_COLORS: Record<PreflopAction, string> = {
  raise: '#f85149',
  call: '#3fb950',
  fold: '#3b6fb0',
};

const LINES: ActionLine[] = ['RFI', 'vs-RFI', 'RFI-vs-3bet'];
const LINE_KO: Record<ActionLine, string> = {
  RFI: 'RFI (오픈)',
  'vs-RFI': 'vs RFI (오픈 대응)',
  'RFI-vs-3bet': 'vs 3벳 (오픈 후 대응)',
};
const LINE_SHORT: Record<ActionLine, string> = {
  RFI: 'RFI',
  'vs-RFI': 'vs RFI',
  'RFI-vs-3bet': 'vs 3벳',
};

type Mix = Record<PreflopAction, number>;

interface Spot {
  line: ActionLine;
  heroPos: Position;
  villainPos?: Position;
  /** 13x13 grid label, e.g. "AJo". */
  label: string;
  /** Concrete dealt combo, e.g. "AhJd". */
  combo: string;
  mix: Mix;
  chartLabel: string;
  source: 'chart' | 'heuristic';
}

interface WrongNote {
  line: ActionLine;
  heroPos: Position;
  villainPos?: Position;
  label: string;
  combo: string;
  picked: PreflopAction;
  mix: Mix;
  ts: number;
}

interface LineStat {
  total: number;
  correct: number;
}

interface TrainerStats {
  total: number;
  correct: number;
  streak: number;
  bestStreak: number;
  byLine: Record<ActionLine, LineStat>;
  /** Last 20 wrong answers, newest first. */
  wrong: WrongNote[];
}

/* ------------------------------- helpers -------------------------------- */

function emptyStats(): TrainerStats {
  return {
    total: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    byLine: {
      RFI: { total: 0, correct: 0 },
      'vs-RFI': { total: 0, correct: 0 },
      'RFI-vs-3bet': { total: 0, correct: 0 },
    },
    wrong: [],
  };
}

function loadStats(): TrainerStats {
  if (typeof window === 'undefined') return emptyStats();
  try {
    const raw = window.localStorage.getItem(STATS_KEY);
    if (!raw) return emptyStats();
    const p = JSON.parse(raw) as Partial<TrainerStats>;
    const base = emptyStats();
    return {
      ...base,
      ...p,
      byLine: { ...base.byLine, ...(p.byLine ?? {}) },
      wrong: Array.isArray(p.wrong) ? p.wrong.slice(0, 20) : [],
    };
  } catch {
    return emptyStats();
  }
}

function saveStats(s: TrainerStats) {
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    // localStorage unavailable (private mode) — session-only stats.
  }
}

/** Korean action name per line (raise = 오픈/3벳/4벳 depending on context). */
function actionName(line: ActionLine, a: PreflopAction): string {
  if (a === 'call') return '콜';
  if (a === 'fold') return '폴드';
  return line === 'RFI' ? '레이즈' : line === 'vs-RFI' ? '3벳' : '4벳';
}

/** Answer buttons offered per line (RFI has no call). */
function actionsFor(line: ActionLine): PreflopAction[] {
  return line === 'RFI' ? ['raise', 'fold'] : ['raise', 'call', 'fold'];
}

function mixFor(chart: ReturnType<typeof getChart>, label: string): Mix {
  const m = chart.hands.get(label);
  return { fold: m?.fold ?? 1, call: m?.call ?? 0, raise: m?.raise ?? 0 };
}

function bestActionOf(mix: Mix): PreflopAction {
  let best: PreflopAction = 'fold';
  for (const a of ['raise', 'call'] as PreflopAction[]) if (mix[a] > mix[best]) best = a;
  return best;
}

/** Combo-count-weighted random pick from a set of grid labels. */
function pickWeighted(labels: string[]): string {
  const total = labels.reduce((s, l) => s + comboCount(l), 0);
  let r = Math.random() * total;
  for (const l of labels) {
    r -= comboCount(l);
    if (r <= 0) return l;
  }
  return labels[labels.length - 1];
}

function spotFrom(
  line: ActionLine,
  heroPos: Position,
  villainPos: Position | undefined,
  label: string,
  chart: ReturnType<typeof getChart>,
): Spot {
  const combos = labelToCombos(label);
  const combo = cardsToString(combos[Math.floor(Math.random() * combos.length)]);
  return {
    line,
    heroPos,
    villainPos,
    label,
    combo,
    mix: mixFor(chart, label),
    chartLabel: chart.label,
    source: chart.source,
  };
}

/** Rebuild a drillable spot from a wrong-note (fresh random combo, same cell). */
function rebuildSpot(n: WrongNote): Spot {
  const chart = getChart({
    gameType: 'cash',
    stackBB: STACK_BB,
    heroPos: n.heroPos,
    villainPos: n.villainPos,
    line: n.line,
  });
  return spotFrom(n.line, n.heroPos, n.villainPos, n.label, chart);
}

/**
 * Random drill spot: random line + charted positions, then a hand label
 * sampled by combo count with ~60% bias toward decision-relevant cells
 * (mixed strategies: no action >= 0.85). Charts here carry only a handful
 * of truly mixed cells (and pure RFI charts none at all), so a tiny mixed
 * pool is widened with all in-range cells — otherwise the same 1-2 hands
 * would repeat on most drills.
 */
function randomSpot(): Spot {
  const line = LINES[Math.floor(Math.random() * LINES.length)];
  let heroPos: Position;
  let villainPos: Position | undefined;
  if (line === 'RFI') {
    const pool = POSITIONS_6MAX.filter((p) => p !== 'BB');
    heroPos = pool[Math.floor(Math.random() * pool.length)];
  } else if (line === 'vs-RFI') {
    const pairs = availableVsRfi();
    const [h, v] = pairs[Math.floor(Math.random() * pairs.length)];
    heroPos = h;
    villainPos = v;
  } else {
    const pairs = availableRfiVs3bet();
    const p = pairs[Math.floor(Math.random() * pairs.length)];
    heroPos = p.hero;
    villainPos = p.villain;
  }

  const chart = getChart({ gameType: 'cash', stackBB: STACK_BB, heroPos, villainPos, line });
  const mixed: string[] = [];
  for (const l of ALL_LABELS) {
    const m = mixFor(chart, l);
    if (Math.max(m.fold, m.call, m.raise) < 0.85) mixed.push(l);
  }
  let relevant = mixed;
  if (relevant.length < 12) {
    const inRange = ALL_LABELS.filter((l) => {
      const m = mixFor(chart, l);
      return m.raise > 0 || m.call > 0;
    });
    relevant = [...new Set([...mixed, ...inRange])];
  }
  const purePool = ALL_LABELS.filter((l) => !relevant.includes(l));
  const usePool =
    Math.random() < 0.6 && relevant.length ? relevant : purePool.length ? purePool : ALL_LABELS;
  return spotFrom(line, heroPos, villainPos, pickWeighted(usePool), chart);
}

function situationText(spot: Spot): string {
  if (spot.line === 'RFI')
    return `당신은 ${spot.heroPos}입니다. 앞선 플레이어는 모두 폴드 — 첫 액션입니다. 오픈할까요?`;
  if (spot.line === 'vs-RFI')
    return `당신은 ${spot.heroPos}, ${spot.villainPos}가 오픈했습니다. 액션은?`;
  return `당신은 ${spot.heroPos}에서 오픈했고, ${spot.villainPos}가 3벳했습니다. 액션은?`;
}

function mixSummary(line: ActionLine, mix: Mix): string {
  const parts = [`${actionName(line, 'raise')} ${Math.round(mix.raise * 100)}%`];
  if (line !== 'RFI') parts.push(`콜 ${Math.round(mix.call * 100)}%`);
  parts.push(`폴드 ${Math.round(mix.fold * 100)}%`);
  return parts.join(' · ');
}

/* ----------------------------- tiny renderers --------------------------- */

/** One suit-styled card chip like the replay stage. */
function CardSpan({ cs, w = 48 }: { cs: string; w?: number }) {
  const suit = (cs[1] ?? '').toLowerCase();
  return (
    <span
      className={`playing-card suit-${suit}`}
      style={{ width: w, height: Math.round(w * 1.4), fontSize: Math.round(w * 0.46), marginRight: 0 }}
    >
      {(cs[0] ?? '').toUpperCase()}
      {SUIT_GLYPH[suit] ?? suit}
    </span>
  );
}

function HoleCards({ combo, w = 48 }: { combo: string; w?: number }) {
  const cards = combo.match(/.{2}/g) ?? [];
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {cards.map((cs, i) => (
        <CardSpan key={i} cs={cs} w={w} />
      ))}
    </span>
  );
}

/* -------------------------------- page ---------------------------------- */

export default function TrainerPage() {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [picked, setPicked] = useState<PreflopAction | null>(null);
  const [stats, setStats] = useState<TrainerStats>(emptyStats);
  const [queue, setQueue] = useState<Spot[]>([]);
  const [autoNext, setAutoNext] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Client-only bootstrap: load persisted stats and deal the first spot.
  useEffect(() => {
    setStats(loadStats());
    setSpot(randomSpot());
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function nextSpot() {
    clearTimer();
    setPicked(null);
    if (queue.length) {
      setSpot(queue[0]);
      setQueue(queue.slice(1));
    } else {
      setSpot(randomSpot());
    }
  }

  function answer(a: PreflopAction) {
    if (!spot || picked !== null) return;
    setPicked(a);
    const best = Math.max(spot.mix.fold, spot.mix.call, spot.mix.raise);
    const correct = spot.mix[a] >= best * 0.5; // mixed strategies accept close seconds
    const line = stats.byLine[spot.line] ?? { total: 0, correct: 0 };
    const streak = correct ? stats.streak + 1 : 0;
    const next: TrainerStats = {
      ...stats,
      total: stats.total + 1,
      correct: stats.correct + (correct ? 1 : 0),
      streak,
      bestStreak: Math.max(stats.bestStreak, streak),
      byLine: {
        ...stats.byLine,
        [spot.line]: { total: line.total + 1, correct: line.correct + (correct ? 1 : 0) },
      },
      wrong: correct
        ? stats.wrong
        : [
            {
              line: spot.line,
              heroPos: spot.heroPos,
              villainPos: spot.villainPos,
              label: spot.label,
              combo: spot.combo,
              picked: a,
              mix: spot.mix,
              ts: Date.now(),
            },
            ...stats.wrong,
          ].slice(0, 20),
    };
    setStats(next);
    saveStats(next);
    if (autoNext) timerRef.current = window.setTimeout(nextSpot, 1800);
  }

  function retryWrong() {
    if (!stats.wrong.length) return;
    clearTimer();
    const spots = stats.wrong.map(rebuildSpot);
    setSpot(spots[0]);
    setQueue(spots.slice(1));
    setPicked(null);
  }

  function resetStats() {
    if (typeof window !== 'undefined' && !window.confirm('학습 기록(정답률·연속 정답·오답 노트)을 모두 초기화할까요?')) return;
    const fresh = emptyStats();
    setStats(fresh);
    try {
      window.localStorage.removeItem(STATS_KEY);
    } catch {
      /* ignore */
    }
  }

  const accuracy = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
  const bestAction = spot ? bestActionOf(spot.mix) : null;
  const bestFreq = spot ? Math.max(spot.mix.fold, spot.mix.call, spot.mix.raise) : 0;
  const wasCorrect = spot && picked !== null ? spot.mix[picked] >= bestFreq * 0.5 : false;
  const evLoss = spot && picked !== null ? Math.max(0, bestFreq - spot.mix[picked]) : 0;

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <h1>학습하기 · GTO 프리플랍 트레이너</h1>
      <p className="subtitle">
        GTO Wizard 트레이너식 드릴 — 랜덤 스팟(RFI · vs RFI · vs 3벳, 100bb 6맥스)이 출제되고, 차트
        믹스와 비교해 채점합니다. 기록은 내 기기에 저장됩니다.
      </p>

      {/* Session stats strip */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            ['문제 수', String(stats.total)],
            ['정답률', `${accuracy}%`],
            ['현재 연속', `${stats.streak > 0 ? '🔥 ' : ''}${stats.streak}`],
            ['최고 연속', String(stats.bestStreak)],
          ].map(([k, v]) => (
            <div
              key={k}
              style={{
                flex: '1 1 100px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 12px',
                textAlign: 'center',
              }}
            >
              <div className="muted" style={{ fontSize: 12 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {LINES.map((l) => {
            const s = stats.byLine[l];
            const pct = s.total ? Math.round((s.correct / s.total) * 100) : null;
            return (
              <span key={l} className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {LINE_SHORT[l]}{' '}
                <strong style={{ color: pct === null ? 'var(--text-dim)' : pct >= 70 ? 'var(--accent)' : 'var(--warn)' }}>
                  {pct === null ? '—' : `${pct}%`}
                </strong>
                <span className="muted" style={{ marginLeft: 4, fontSize: 11 }}>
                  ({s.correct}/{s.total})
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Drill card */}
      <div className="card">
        {!spot ? (
          <p className="muted">문제를 생성하는 중…</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <span className="pill" style={{ background: 'rgba(88,166,255,0.14)', color: 'var(--blue)' }}>
                {LINE_KO[spot.line]} · {STACK_BB}bb
              </span>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                {queue.length > 0 && (
                  <span className="pill" style={{ background: 'rgba(210,153,34,0.15)', color: 'var(--warn)' }}>
                    오답 복습 — 남은 {queue.length}문제
                  </span>
                )}
                {spot.source === 'heuristic' && (
                  <span className="pill" style={{ background: 'rgba(210,153,34,0.15)', color: 'var(--warn)' }}>
                    휴리스틱 근사
                  </span>
                )}
              </span>
            </div>

            <p style={{ fontSize: 16, fontWeight: 600, margin: '4px 0 12px' }}>{situationText(spot)}</p>

            {/* Position pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {POSITIONS_6MAX.map((p) => {
                const isHero = p === spot.heroPos;
                const isVillain = p === spot.villainPos;
                return (
                  <div
                    key={p}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: isHero ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: isHero
                        ? 'rgba(63,185,80,0.12)'
                        : isVillain
                          ? 'rgba(88,166,255,0.12)'
                          : 'var(--bg-elevated)',
                      fontWeight: 600,
                      fontSize: 13,
                      textAlign: 'center',
                      minWidth: 56,
                      flex: '1 1 56px',
                    }}
                  >
                    <div>{p}</div>
                    <div style={{ fontSize: 11, color: isHero ? 'var(--accent)' : isVillain ? 'var(--blue)' : 'var(--text-dim)' }}>
                      {isHero ? 'HERO' : isVillain ? (spot.line === 'RFI-vs-3bet' ? '3벳터' : '오프너') : `${STACK_BB}bb`}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Hero hand */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <HoleCards combo={spot.combo} />
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{spot.label}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {comboCount(spot.label)}콤보 셀 · {spot.chartLabel}
                </div>
              </div>
            </div>

            {/* Answer buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actionsFor(spot.line).map((a) => {
                const isPick = picked === a;
                const isBest = picked !== null && a === bestAction;
                return (
                  <button
                    key={a}
                    type="button"
                    className="secondary"
                    disabled={picked !== null}
                    onClick={() => answer(a)}
                    style={{
                      flex: '1 1 90px',
                      padding: '14px 10px',
                      fontSize: 16,
                      fontWeight: 800,
                      borderColor: ACTION_COLORS[a],
                      color: ACTION_COLORS[a],
                      background: isPick ? `${ACTION_COLORS[a]}22` : undefined,
                      outline: isBest ? `2px solid ${ACTION_COLORS[a]}` : undefined,
                      opacity: picked !== null && !isPick && !isBest ? 0.4 : 1,
                    }}
                  >
                    {actionName(spot.line, a)}
                    {isBest ? ' ★' : ''}
                  </button>
                );
              })}
            </div>

            {/* Feedback */}
            {picked !== null && (
              <div
                style={{
                  marginTop: 16,
                  border: `1px solid ${wasCorrect ? 'rgba(63,185,80,0.5)' : 'rgba(248,81,73,0.5)'}`,
                  background: wasCorrect ? 'rgba(63,185,80,0.07)' : 'rgba(248,81,73,0.07)',
                  borderRadius: 10,
                  padding: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span
                    className="pill"
                    style={{
                      background: wasCorrect ? 'rgba(63,185,80,0.18)' : 'rgba(248,81,73,0.18)',
                      color: wasCorrect ? 'var(--accent)' : 'var(--danger)',
                      fontWeight: 800,
                    }}
                  >
                    {wasCorrect ? '✅ 정답' : '❌ 오답'}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    내 선택: <strong style={{ color: 'var(--text)' }}>{actionName(spot.line, picked)}</strong>
                    {evLoss > 0.005 && <> · EV 손실 근사 {evLoss.toFixed(2)} (빈도 격차)</>}
                  </span>
                </div>

                {/* GTO mix bars */}
                <div style={{ display: 'grid', gap: 6 }}>
                  {actionsFor(spot.line).map((a) => {
                    const f = spot.mix[a];
                    return (
                      <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: '0 0 52px', fontSize: 13, fontWeight: 700, color: ACTION_COLORS[a] }}>
                          {actionName(spot.line, a)}
                        </span>
                        <div style={{ flex: 1, height: 12, borderRadius: 6, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round(f * 100)}%`, height: '100%', background: ACTION_COLORS[a] }} />
                        </div>
                        <span style={{ flex: '0 0 44px', textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                          {Math.round(f * 100)}%
                        </span>
                      </div>
                    );
                  })}
                </div>

                <p className="muted" style={{ fontSize: 13, margin: '10px 0 12px' }}>
                  13×13 그리드에서 <strong style={{ color: 'var(--text)' }}>{spot.label}</strong> 셀은 «{spot.chartLabel}» 차트 기준{' '}
                  {mixSummary(spot.line, spot.mix)} 믹스입니다 — 최적 액션은{' '}
                  <strong style={{ color: ACTION_COLORS[bestAction ?? 'fold'] }}>
                    {actionName(spot.line, bestAction ?? 'fold')} {Math.round(bestFreq * 100)}%
                  </strong>
                  입니다.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button onClick={nextSpot}>다음 문제 ▶</button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={autoNext}
                      onChange={(e) => setAutoNext(e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    자동으로 다음 문제 (1.8초)
                  </label>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Wrong-answer notebook */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>📕 오답 노트 (최근 {stats.wrong.length}개)</h2>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <button className="secondary" onClick={retryWrong} disabled={!stats.wrong.length} style={{ padding: '6px 12px', fontSize: 13 }}>
              🔁 오답 다시 풀기
            </button>
            <button className="secondary" onClick={resetStats} style={{ padding: '6px 12px', fontSize: 13, color: 'var(--danger)' }}>
              초기화
            </button>
          </span>
        </div>
        {stats.wrong.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>아직 오답이 없습니다. 틀린 문제가 여기에 쌓입니다 (최근 20개).</p>
        ) : (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 13 }}>
              목록 펼치기 / 접기
            </summary>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {stats.wrong.map((n, i) => (
                <div
                  key={`${n.ts}-${i}`}
                  style={{
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${ACTION_COLORS[bestActionOf(n.mix)]}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: 'var(--bg-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <HoleCards combo={n.combo} w={24} />
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {LINE_SHORT[n.line]} · {n.heroPos}
                      {n.villainPos ? ` vs ${n.villainPos}` : ''} · {n.label}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      내 선택 <strong style={{ color: 'var(--danger)' }}>{actionName(n.line, n.picked)}</strong> → GTO{' '}
                      {mixSummary(n.line, n.mix)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        * 채점 기준: 선택한 액션의 GTO 빈도가 최빈 액션 빈도의 50% 이상이면 정답(믹스 전략 허용). EV
        손실은 빈도 격차를 쓰는 근사치입니다. 차트는 100bb 6맥스 GTO 근사입니다.
      </p>
    </div>
  );
}
