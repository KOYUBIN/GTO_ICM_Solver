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
  quizBankCounts,
  sampleChipEvQuizzes,
  sampleIcmQuizzes,
  POSITIONS_6MAX,
  type ActionLine,
  type ChipEvQuiz,
  type IcmQuiz,
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

/* ---- new-mode constants ---- */

type Mode = 'preflop' | 'chipev' | 'icm';
const MODES: Mode[] = ['preflop', 'chipev', 'icm'];
const MODE_KO: Record<Mode, string> = {
  preflop: '프리플랍 (실시간)',
  chipev: '실전 EV (칩)',
  icm: 'ICM 푸시/폴드',
};
const MODE_SHORT: Record<Mode, string> = {
  preflop: '프리플랍',
  chipev: '칩 EV',
  icm: 'ICM',
};

/** Korean labels for the chip-EV quiz `line` field (differs from ActionLine). */
const CHIP_LINE_KO: Record<string, string> = {
  RFI: 'RFI 오픈',
  'vs-RFI': 'vs RFI',
  'vs-3bet': 'vs 3벳',
};

// The precomputed banks. sampleFrom returns the whole pool when n >= size, so
// these are stable full-pool copies we then draw from with a client-side RNG.
const CHIP_COUNTS = quizBankCounts();
const CHIPEV_POOL = sampleChipEvQuizzes(CHIP_COUNTS.chipEv);
const ICM_POOL = sampleIcmQuizzes(CHIP_COUNTS.icm);

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

/** Wrong-note for the live preflop drill (rebuildable into a fresh spot). */
interface PreflopWrong {
  mode: 'preflop';
  line: ActionLine;
  heroPos: Position;
  villainPos?: Position;
  label: string;
  combo: string;
  picked: PreflopAction;
  mix: Mix;
  ts: number;
}

/** Wrong-note for the precomputed chip-EV / ICM quiz modes. */
interface QuizWrong {
  mode: 'chipev' | 'icm';
  id: string;
  title: string;
  combo: string;
  pickedKo: string;
  correctKo: string;
  note?: string;
  ts: number;
}

type WrongNote = PreflopWrong | QuizWrong;

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
  /** Per-mode tally (all three trainer modes contribute). */
  byMode: Record<Mode, LineStat>;
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
    byMode: {
      preflop: { total: 0, correct: 0 },
      chipev: { total: 0, correct: 0 },
      icm: { total: 0, correct: 0 },
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
    // Back-compat: old wrong-notes have no `mode` -> they were all preflop.
    const wrong = Array.isArray(p.wrong)
      ? p.wrong
          .slice(0, 20)
          .map((w) =>
            w && (w as WrongNote).mode ? (w as WrongNote) : ({ ...(w as object), mode: 'preflop' } as WrongNote),
          )
      : [];
    return {
      ...base,
      ...p,
      byLine: { ...base.byLine, ...(p.byLine ?? {}) },
      byMode: { ...base.byMode, ...(p.byMode ?? {}) },
      wrong,
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
function rebuildSpot(n: PreflopWrong): Spot {
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

/* ---- new-mode helpers ---- */

/** A random concrete combo string ("AhKd") for a 13x13 grid label. */
function randomCombo(hand: string): string {
  const combos = labelToCombos(hand);
  if (!combos.length) return '';
  return cardsToString(combos[Math.floor(Math.random() * combos.length)]);
}

/** Korean label for a chip-EV quiz action (raise -> 올인 when shove). */
function chipActionKo(a: string, isShove?: boolean): string {
  if (a === 'call') return '콜';
  if (a === 'fold') return '폴드';
  return isShove ? '올인' : '레이즈';
}

/** "+0.42bb" / "0bb" — signed chip-EV formatting. */
function fmtBB(v: number): string {
  if (Math.abs(v) < 0.005) return '0bb';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}bb`;
}

function chipSituation(q: ChipEvQuiz): string {
  const s = `${q.heroPos} ${q.stackBB}bb`;
  if (q.line === 'RFI')
    return `${s} — 앞선 플레이어 모두 폴드, 첫 액션입니다. ${q.isShove ? '올인?' : '오픈?'}`;
  if (q.line === 'vs-RFI') return `${s}, ${q.villainPos} 오픈에 대응 — 액션은?`;
  return `${s}로 오픈 후 ${q.villainPos}가 3벳 — 액션은?`;
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

/** 6-max position row highlighting hero (green) and villain (blue). */
function PositionRow({
  heroPos,
  villainPos,
  stackBB,
  villainRole,
}: {
  heroPos: string;
  villainPos?: string;
  stackBB: number;
  villainRole: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      {POSITIONS_6MAX.map((p) => {
        const isHero = p === heroPos;
        const isVillain = p === villainPos;
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
              {isHero ? 'HERO' : isVillain ? villainRole : `${stackBB}bb`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------- chip-EV quiz drill --------------------------- */

type Graded = (mode: 'chipev' | 'icm', correct: boolean, wrong: QuizWrong | null) => void;

function ChipEvDrill({ onGraded }: { onGraded: Graded }) {
  const [quiz, setQuiz] = useState<ChipEvQuiz | null>(null);
  const [combo, setCombo] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  function draw() {
    const q = CHIPEV_POOL[Math.floor(Math.random() * CHIPEV_POOL.length)];
    setQuiz(q);
    setCombo(randomCombo(q.hand));
    setPicked(null);
  }

  // Draw client-side (avoids SSR/hydration RNG mismatch).
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function answer(a: string) {
    if (!quiz || picked !== null) return;
    setPicked(a);
    const correct = a === quiz.best;
    const wrong: QuizWrong | null = correct
      ? null
      : {
          mode: 'chipev',
          id: `${quiz.id}-${Date.now()}`,
          title: `${CHIP_LINE_KO[quiz.line] ?? quiz.line} · ${quiz.heroPos}${
            quiz.villainPos ? ` vs ${quiz.villainPos}` : ''
          } ${quiz.stackBB}bb · ${quiz.hand}`,
          combo,
          pickedKo: chipActionKo(a, quiz.isShove),
          correctKo: chipActionKo(quiz.best, quiz.isShove),
          note: quiz.note,
          ts: Date.now(),
        };
    onGraded('chipev', correct, wrong);
  }

  if (!quiz) return <p className="muted">문제를 생성하는 중…</p>;

  const correct = picked !== null && picked === quiz.best;
  const bestFreq = quiz.gtoMix[quiz.best as keyof typeof quiz.gtoMix] ?? 0;
  const hasEv = quiz.evBB != null;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="pill" style={{ background: 'rgba(88,166,255,0.14)', color: 'var(--blue)' }}>
          {CHIP_LINE_KO[quiz.line] ?? quiz.line} · {quiz.stackBB}bb
        </span>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {quiz.isShove && (
            <span className="pill" style={{ background: 'rgba(210,153,34,0.15)', color: 'var(--warn)' }}>
              푸시/폴드
            </span>
          )}
          <span className="pill" style={{ background: 'rgba(210,153,34,0.12)', color: 'var(--warn)' }}>
            칩 EV 근사
          </span>
        </span>
      </div>

      <p style={{ fontSize: 16, fontWeight: 600, margin: '4px 0 12px' }}>{chipSituation(quiz)}</p>

      <PositionRow
        heroPos={quiz.heroPos}
        villainPos={quiz.villainPos}
        stackBB={quiz.stackBB}
        villainRole={quiz.line === 'vs-3bet' ? '3벳터' : '오프너'}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <HoleCards combo={combo} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{quiz.hand}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {comboCount(quiz.hand)}콤보 셀 · 실전 EV 문제 은행
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {quiz.actions.map((a) => {
          const isPick = picked === a;
          const isBest = picked !== null && a === quiz.best;
          const color = ACTION_COLORS[a as PreflopAction] ?? 'var(--text)';
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
                borderColor: color,
                color,
                background: isPick ? `${color}22` : undefined,
                outline: isBest ? `2px solid ${color}` : undefined,
                opacity: picked !== null && !isPick && !isBest ? 0.4 : 1,
              }}
            >
              {chipActionKo(a, quiz.isShove)}
              {isBest ? ' ★' : ''}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <div
          style={{
            marginTop: 16,
            border: `1px solid ${correct ? 'rgba(63,185,80,0.5)' : 'rgba(248,81,73,0.5)'}`,
            background: correct ? 'rgba(63,185,80,0.07)' : 'rgba(248,81,73,0.07)',
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span
              className="pill"
              style={{
                background: correct ? 'rgba(63,185,80,0.18)' : 'rgba(248,81,73,0.18)',
                color: correct ? 'var(--accent)' : 'var(--danger)',
                fontWeight: 800,
              }}
            >
              {correct ? '✅ 정답' : '❌ 오답'}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              내 선택: <strong style={{ color: 'var(--text)' }}>{chipActionKo(picked, quiz.isShove)}</strong> · 최적{' '}
              <strong style={{ color: ACTION_COLORS[quiz.best as PreflopAction] ?? 'var(--text)' }}>
                {chipActionKo(quiz.best, quiz.isShove)} {Math.round(bestFreq * 100)}%
              </strong>
            </span>
          </div>

          {/* GTO mix bars */}
          <div style={{ display: 'grid', gap: 6 }}>
            {quiz.actions.map((a) => {
              const f = quiz.gtoMix[a as keyof typeof quiz.gtoMix] ?? 0;
              const color = ACTION_COLORS[a as PreflopAction] ?? 'var(--text)';
              return (
                <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: '0 0 52px', fontSize: 13, fontWeight: 700, color }}>
                    {chipActionKo(a, quiz.isShove)}
                  </span>
                  <div style={{ flex: 1, height: 12, borderRadius: 6, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(f * 100)}%`, height: '100%', background: color }} />
                  </div>
                  <span style={{ flex: '0 0 44px', textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(f * 100)}%
                  </span>
                </div>
              );
            })}
          </div>

          {hasEv && (
            <p style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>
              칩 EV:{' '}
              <span style={{ color: ACTION_COLORS.raise }}>
                {chipActionKo('raise', quiz.isShove)} {fmtBB(quiz.evBB?.raise ?? 0)}
              </span>{' '}
              /{' '}
              <span style={{ color: ACTION_COLORS.fold }}>폴드 {fmtBB(quiz.evBB?.fold ?? 0)}</span>
            </p>
          )}

          {quiz.note && (
            <p className="muted" style={{ fontSize: 13, margin: '10px 0 12px' }}>
              {quiz.note}
            </p>
          )}

          <div style={{ marginTop: hasEv || quiz.note ? 0 : 12 }}>
            <button onClick={draw}>다음 문제 ▶</button>
          </div>
        </div>
      )}
    </>
  );
}

/* --------------------------- ICM quiz drill ----------------------------- */

function IcmDrill({ onGraded }: { onGraded: Graded }) {
  const [quiz, setQuiz] = useState<IcmQuiz | null>(null);
  const [combo, setCombo] = useState('');
  const [picked, setPicked] = useState<'shove' | 'fold' | null>(null);

  function draw() {
    const q = ICM_POOL[Math.floor(Math.random() * ICM_POOL.length)];
    setQuiz(q);
    setCombo(randomCombo(q.hand));
    setPicked(null);
  }

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function answer(a: 'shove' | 'fold') {
    if (!quiz || picked !== null) return;
    setPicked(a);
    const correct = a === quiz.decision;
    const wrong: QuizWrong | null = correct
      ? null
      : {
          mode: 'icm',
          id: `${quiz.id}-${Date.now()}`,
          title: `ICM · ${quiz.heroPos} ${quiz.hand} · ${quiz.payoutName}`,
          combo,
          pickedKo: a === 'shove' ? '올인' : '폴드',
          correctKo: quiz.decision === 'shove' ? '올인' : '폴드',
          note: quiz.note,
          ts: Date.now(),
        };
    onGraded('icm', correct, wrong);
  }

  if (!quiz) return <p className="muted">문제를 생성하는 중…</p>;

  const correct = picked !== null && picked === quiz.decision;
  const bb = quiz.blinds.bb;
  const deltaPct = quiz.deltaIcm * 100;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="pill" style={{ background: 'rgba(88,166,255,0.14)', color: 'var(--blue)' }}>
          {quiz.payoutName}
        </span>
        <span className="pill" style={{ background: 'rgba(210,153,34,0.15)', color: 'var(--warn)' }}>
          버블 팩터 {quiz.bubbleFactor?.toFixed(2) ?? '—'}
        </span>
      </div>

      <p style={{ fontSize: 16, fontWeight: 600, margin: '4px 0 8px' }}>{quiz.scenario}</p>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        지급:{' '}
        {quiz.payouts.map((p, i) => `${i + 1}위 ${Math.round(p * 100)}%`).join(' · ')} · 블라인드{' '}
        {quiz.blinds.sb}/{quiz.blinds.bb}
        {quiz.blinds.ante ? ` (앤티 ${quiz.blinds.ante})` : ''}
      </p>

      {/* Stacks — hero highlighted */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {quiz.stacks.map((chips, i) => {
          const isHero = i === quiz.heroIdx;
          return (
            <div
              key={i}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: isHero ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: isHero ? 'rgba(63,185,80,0.12)' : 'var(--bg-elevated)',
                fontWeight: 600,
                fontSize: 13,
                textAlign: 'center',
                minWidth: 66,
                flex: '1 1 66px',
              }}
            >
              <div>{isHero ? quiz.heroPos : `P${i + 1}`}</div>
              <div style={{ fontSize: 11, color: isHero ? 'var(--accent)' : 'var(--text-dim)' }}>
                {chips.toLocaleString()} ({Math.round(chips / bb)}bb)
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <HoleCards combo={combo} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{quiz.hand}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {quiz.heroPos} · {Math.round(quiz.stacks[quiz.heroIdx] / bb)}bb · 푸시 or 폴드?
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['shove', 'fold'] as const).map((a) => {
          const isPick = picked === a;
          const isBest = picked !== null && a === quiz.decision;
          const color = a === 'shove' ? ACTION_COLORS.raise : ACTION_COLORS.fold;
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
                borderColor: color,
                color,
                background: isPick ? `${color}22` : undefined,
                outline: isBest ? `2px solid ${color}` : undefined,
                opacity: picked !== null && !isPick && !isBest ? 0.4 : 1,
              }}
            >
              {a === 'shove' ? '올인' : '폴드'}
              {isBest ? ' ★' : ''}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <div
          style={{
            marginTop: 16,
            border: `1px solid ${correct ? 'rgba(63,185,80,0.5)' : 'rgba(248,81,73,0.5)'}`,
            background: correct ? 'rgba(63,185,80,0.07)' : 'rgba(248,81,73,0.07)',
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span
              className="pill"
              style={{
                background: correct ? 'rgba(63,185,80,0.18)' : 'rgba(248,81,73,0.18)',
                color: correct ? 'var(--accent)' : 'var(--danger)',
                fontWeight: 800,
              }}
            >
              {correct ? '✅ 정답' : '❌ 오답'}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              내 선택: <strong style={{ color: 'var(--text)' }}>{picked === 'shove' ? '올인' : '폴드'}</strong> · 최적{' '}
              <strong style={{ color: quiz.decision === 'shove' ? ACTION_COLORS.raise : ACTION_COLORS.fold }}>
                {quiz.decision === 'shove' ? '올인' : '폴드'}
              </strong>
            </span>
          </div>

          <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
            <div>
              <span className="muted" style={{ fontSize: 13 }}>ICM EV: </span>
              <strong style={{ color: ACTION_COLORS.raise }}>올인 {quiz.evIcmShove.toFixed(4)}</strong> /{' '}
              <strong style={{ color: ACTION_COLORS.fold }}>폴드 {quiz.evIcmFold.toFixed(4)}</strong>{' '}
              <span
                className="pill"
                style={{
                  background: deltaPct >= 0 ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
                  color: deltaPct >= 0 ? 'var(--accent)' : 'var(--danger)',
                }}
              >
                Δ {deltaPct >= 0 ? '+' : ''}
                {deltaPct.toFixed(2)}%
              </span>
            </div>
            {quiz.evChipShoveBB != null && (
              <div>
                <span className="muted" style={{ fontSize: 13 }}>칩 EV 대조: </span>
                <strong style={{ color: quiz.evChipShoveBB >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                  올인 {fmtBB(quiz.evChipShoveBB)}
                </strong>
                {quiz.evChipShoveBB > 0 && deltaPct < 0 && (
                  <span className="muted" style={{ fontSize: 12 }}> — 칩으로는 이득이지만 ICM 압박으로 폴드</span>
                )}
              </div>
            )}
          </div>

          {quiz.note && (
            <p className="muted" style={{ fontSize: 13, margin: '10px 0 12px' }}>
              {quiz.note}
            </p>
          )}

          <div style={{ marginTop: quiz.note ? 0 : 12 }}>
            <button onClick={draw}>다음 문제 ▶</button>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------- page ---------------------------------- */

export default function TrainerPage() {
  const [mode, setMode] = useState<Mode>('preflop');
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
    const pf = stats.byMode.preflop;
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
      byMode: {
        ...stats.byMode,
        preflop: { total: pf.total + 1, correct: pf.correct + (correct ? 1 : 0) },
      },
      wrong: correct
        ? stats.wrong
        : [
            {
              mode: 'preflop',
              line: spot.line,
              heroPos: spot.heroPos,
              villainPos: spot.villainPos,
              label: spot.label,
              combo: spot.combo,
              picked: a,
              mix: spot.mix,
              ts: Date.now(),
            } as PreflopWrong,
            ...stats.wrong,
          ].slice(0, 20),
    };
    setStats(next);
    saveStats(next);
    if (autoNext) timerRef.current = window.setTimeout(nextSpot, 1800);
  }

  /** Shared grader for the chip-EV / ICM quiz modes (functional update). */
  function recordQuiz(m: 'chipev' | 'icm', correct: boolean, wrong: QuizWrong | null) {
    setStats((prev) => {
      const md = prev.byMode[m];
      const streak = correct ? prev.streak + 1 : 0;
      const next: TrainerStats = {
        ...prev,
        total: prev.total + 1,
        correct: prev.correct + (correct ? 1 : 0),
        streak,
        bestStreak: Math.max(prev.bestStreak, streak),
        byMode: {
          ...prev.byMode,
          [m]: { total: md.total + 1, correct: md.correct + (correct ? 1 : 0) },
        },
        wrong: correct || !wrong ? prev.wrong : [wrong, ...prev.wrong].slice(0, 20),
      };
      saveStats(next);
      return next;
    });
  }

  function retryWrong() {
    const notes = stats.wrong.filter((w): w is PreflopWrong => w.mode === 'preflop');
    if (!notes.length) return;
    clearTimer();
    const spots = notes.map(rebuildSpot);
    setMode('preflop');
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
  const hasPreflopWrong = stats.wrong.some((w) => w.mode === 'preflop');

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <h1>학습하기 · 문제 풀이 연습</h1>
      <p className="subtitle">
        실전처럼 반복 연습하는 문제 풀이 — 프리플랍 상황(실시간), 칩 기준 실전 문제, ICM(상금 고려)
        올인/폴드 문제를 풉니다. 기록은 내 기기에 저장됩니다. 문제 수: 칩EV {CHIP_COUNTS.chipEv}개 · ICM{' '}
        {CHIP_COUNTS.icm}개. 모르는 용어는 상단 메뉴 &lsquo;용어 사전&rsquo;.
      </p>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {MODES.map((m) => {
          const active = m === mode;
          return (
            <button
              key={m}
              type="button"
              className="secondary"
              onClick={() => setMode(m)}
              style={{
                flex: '1 1 140px',
                padding: '10px 12px',
                fontSize: 14,
                fontWeight: 800,
                borderColor: active ? 'var(--accent)' : 'var(--border)',
                color: active ? 'var(--accent)' : 'var(--text-dim)',
                background: active ? 'rgba(63,185,80,0.12)' : 'var(--bg-elevated)',
              }}
            >
              {MODE_KO[m]}
            </button>
          );
        })}
      </div>

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

        {/* Per-mode accuracy */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {MODES.map((m) => {
            const s = stats.byMode[m];
            const pct = s.total ? Math.round((s.correct / s.total) * 100) : null;
            return (
              <span key={m} className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {MODE_SHORT[m]}{' '}
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

        {/* Preflop line breakdown (live drill only) */}
        {mode === 'preflop' && (
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
        )}
      </div>

      {/* Drill card */}
      <div className="card">
        {mode === 'chipev' ? (
          <ChipEvDrill onGraded={recordQuiz} />
        ) : mode === 'icm' ? (
          <IcmDrill onGraded={recordQuiz} />
        ) : !spot ? (
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
            <button className="secondary" onClick={retryWrong} disabled={!hasPreflopWrong} style={{ padding: '6px 12px', fontSize: 13 }}>
              🔁 프리플랍 오답 다시 풀기
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
              {stats.wrong.map((n, i) => {
                if (n.mode === 'preflop') {
                  return (
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
                  );
                }
                const tag = n.mode === 'icm' ? 'ICM' : '칩 EV';
                const barColor = n.mode === 'icm' ? 'var(--blue)' : 'var(--warn)';
                return (
                  <div
                    key={`${n.ts}-${i}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderLeft: `4px solid ${barColor}`,
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
                        <span className="pill" style={{ background: 'var(--bg)', color: barColor, marginRight: 6 }}>{tag}</span>
                        {n.title}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        내 선택 <strong style={{ color: 'var(--danger)' }}>{n.pickedKo}</strong> → 정답{' '}
                        <strong style={{ color: 'var(--accent)' }}>{n.correctKo}</strong>
                        {n.note ? ` · ${n.note}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        * 프리플랍 채점: 선택 액션의 GTO 빈도가 최빈 빈도의 50% 이상이면 정답(믹스 허용). 실전 EV·ICM
        문제는 정밀 계산된 칩-EV Monte-Carlo 및 방향성 ICM 슈브 모델 기반이며 완전한 GTO 균형은 아닙니다.
        차트는 100bb 6맥스 GTO 근사입니다.
      </p>
    </div>
  );
}
