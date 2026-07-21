'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  allGridLabels,
  availableRfiVs3bet,
  availableVsRfi,
  cardsToString,
  comboCount,
  equityVsRanges,
  getChart,
  labelToCombos,
  openRaiseEv,
  quizBankCounts,
  realizationFor,
  sampleChipEvQuizzes,
  sampleIcmQuizzes,
  topPercentRange,
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

/* ---- situation filters (상황 설정) ---- */

/** '' = 랜덤. Hero-position options per line come from the charted pairs. */
interface SpotFilter {
  line: ActionLine | '';
  heroPos: Position | '';
}

const VS_RFI_HEROES = [...new Set(availableVsRfi().map(([h]) => h))];
const VS_3BET_HEROES = [...new Set(availableRfiVs3bet().map((p) => p.hero))];
const RFI_HEROES = POSITIONS_6MAX.filter((p) => p !== 'BB');

/** Hero positions selectable for a given line filter ('' = union of all). */
function heroesFor(line: ActionLine | ''): Position[] {
  if (line === 'RFI') return RFI_HEROES;
  if (line === 'vs-RFI') return VS_RFI_HEROES;
  if (line === 'RFI-vs-3bet') return VS_3BET_HEROES;
  return [...new Set([...RFI_HEROES, ...VS_RFI_HEROES, ...VS_3BET_HEROES])];
}

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

/** UI mode = stats modes + 타임 어택 (TA는 전적에 집계되지 않으므로 Mode와 분리). */
type UiMode = Mode | 'timeattack';
const UI_MODES: UiMode[] = [...MODES, 'timeattack'];
const UI_MODE_KO: Record<UiMode, string> = { ...MODE_KO, timeattack: '⚡ 타임 어택' };

/* ---- 일일 미션 / 타임 어택 (localStorage) ---- */

const MISSIONS_KEY = 'gto-trainer-missions';
const TA_BEST_KEY = 'gto-trainer-timeattack-best';
const TA_CLAIM_KEY = 'gto-trainer-timeattack-claim';
const TA_SECONDS = 60;
const TA_REWARD_SCORE = 10;
const MISSION_TARGETS = { m1: 15, m2: 10, m3: 5 } as const;

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
  /** 약점 분석: per-hero-position tally for the live preflop drill. */
  byPos: Record<string, LineStat>;
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
    byPos: {},
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
      // Back-compat: older saves have no byPos -> start empty.
      byPos: { ...(p.byPos ?? {}) },
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

/* ---- 일일 미션 상태 (YYYY-MM-DD로 키, 날짜가 바뀌면 리셋) ---- */

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface MissionDay {
  date: string;
  /** 오늘 푼 문제 수 (m1). */
  solved: number;
  /** 오늘 맞힌 정답 수 (m2). */
  correct: number;
  /** 오늘의 현재 연속 정답 (m3 진행용 — 타임 어택 답안은 건드리지 않음). */
  streak: number;
  /** 오늘의 최고 연속 정답 (m3). */
  bestStreak: number;
  /** 미션별 보상 지급 여부 (하루 1회). */
  claimed: { m1: boolean; m2: boolean; m3: boolean };
}

function freshMissions(): MissionDay {
  return {
    date: todayStr(),
    solved: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    claimed: { m1: false, m2: false, m3: false },
  };
}

function loadMissions(): MissionDay {
  if (typeof window === 'undefined') return freshMissions();
  try {
    const raw = window.localStorage.getItem(MISSIONS_KEY);
    if (!raw) return freshMissions();
    const p = JSON.parse(raw) as Partial<MissionDay>;
    if (p.date !== todayStr()) return freshMissions();
    const base = freshMissions();
    return { ...base, ...p, claimed: { ...base.claimed, ...(p.claimed ?? {}) } };
  } catch {
    return freshMissions();
  }
}

function saveMissions(m: MissionDay) {
  try {
    window.localStorage.setItem(MISSIONS_KEY, JSON.stringify(m));
  } catch {
    // localStorage unavailable — session-only mission progress.
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
function randomSpot(filter?: SpotFilter): Spot {
  // 상황 설정: 라인/포지션이 지정되면 그 안에서만 뽑는다 ('' = 랜덤).
  let line: ActionLine;
  if (filter?.line) {
    line = filter.line;
  } else if (filter?.heroPos) {
    // 포지션만 고정: 그 포지션이 존재하는 라인 중에서 랜덤.
    const linesForHero = LINES.filter((l) => heroesFor(l).includes(filter.heroPos as Position));
    line = linesForHero.length
      ? linesForHero[Math.floor(Math.random() * linesForHero.length)]
      : LINES[Math.floor(Math.random() * LINES.length)];
  } else {
    line = LINES[Math.floor(Math.random() * LINES.length)];
  }
  const wantHero = filter?.heroPos && heroesFor(line).includes(filter.heroPos as Position)
    ? (filter.heroPos as Position)
    : undefined;

  let heroPos: Position;
  let villainPos: Position | undefined;
  if (line === 'RFI') {
    const pool = wantHero ? [wantHero] : RFI_HEROES;
    heroPos = pool[Math.floor(Math.random() * pool.length)];
  } else if (line === 'vs-RFI') {
    const all = availableVsRfi();
    const pairs = wantHero ? all.filter(([h]) => h === wantHero) : all;
    const pool = pairs.length ? pairs : all;
    const [h, v] = pool[Math.floor(Math.random() * pool.length)];
    heroPos = h;
    villainPos = v;
  } else {
    const all = availableRfiVs3bet();
    const pairs = wantHero ? all.filter((p) => p.hero === wantHero) : all;
    const pool = pairs.length ? pairs : all;
    const p = pool[Math.floor(Math.random() * pool.length)];
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

/* ---- per-action EV (칩EV 근사) for the live preflop drill ---- */

interface EvRow {
  key: PreflopAction;
  ev: number;
}

/** Players left to act behind a 6-max position (UTG=5 … BB=0). */
function playersBehindOf(pos: Position): number {
  const i = POSITIONS_6MAX.indexOf(pos);
  return i < 0 ? 3 : POSITIONS_6MAX.length - 1 - i;
}

/** Raise-weighted range map from a chart (villain's opening range). */
function raiseRangeOf(heroPos: Position): Map<string, number> {
  const chart = getChart({ gameType: 'cash', stackBB: STACK_BB, heroPos, line: 'RFI' });
  const range = new Map<string, number>();
  for (const [label, m] of chart.hands) if ((m.raise ?? 0) > 0) range.set(label, m.raise);
  return range;
}

/** Postflop acting order — later index acts last (= in position). */
const POSTFLOP_ORDER: Position[] = ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'];

/** Blind already posted by a position (sunk at the decision point). */
function blindOf(pos: Position | undefined): number {
  return pos === 'BB' ? 1 : pos === 'SB' ? 0.5 : 0;
}

/**
 * Heads-up equity realization from actual postflop position (spotev.ts
 * semantics: ~0.9 in position, ~0.75 OOP non-blind, ~0.65 from the blinds).
 */
function matchupRealization(heroPos: Position, villainPos: Position | undefined): number {
  if (!villainPos) return 0.85;
  const heroIp = POSTFLOP_ORDER.indexOf(heroPos) > POSTFLOP_ORDER.indexOf(villainPos);
  if (heroIp) return 0.9;
  return blindOf(heroPos) > 0 ? 0.65 : 0.75;
}

/**
 * Per-action chip-EV approximation for a drill spot (relative to fold = 0,
 * sunk chips — including posted blinds — ignored). Reuses the same coarse
 * single-caller models as the charts page: openRaiseEv for opens;
 * equity-vs-range pot-share models for facing an open / a 3-bet.
 * Directional teaching aid, NOT solver output.
 *
 * Bet-size assumptions: open 2.5bb, 3bet to 8bb, 4bet to 20bb; a fixed 55%
 * fold-through vs re-aggression; re-aggressor continue ranges as global top-%.
 * Blind-aware: a blind hero's posted chips are sunk, so calls cost less and
 * pots exclude double-counted posts.
 */
function preflopActionEvs(spot: Spot): EvRow[] {
  const hero = spot.combo;
  const FE = 0.55; // 상대가 리레이즈에 폴드하는 근사 빈도

  if (spot.line === 'RFI') {
    const behind = Math.max(1, playersBehindOf(spot.heroPos));
    const raise = openRaiseEv(spot.label, {
      raiseTo: 2.5,
      continuePercent: 18,
      playersBehind: behind,
      realization: realizationFor(behind),
      iterations: 2500,
      seed: 99,
    });
    return [
      { key: 'raise', ev: raise },
      { key: 'fold', ev: 0 },
    ];
  }

  const realization = matchupRealization(spot.heroPos, spot.villainPos);
  const heroBlind = blindOf(spot.heroPos);
  const villainBlind = blindOf(spot.villainPos);
  // 히어로/빌런이 낸 블라인드는 각자의 베팅(콜·오픈·3벳)에 흡수되므로 데드머니에서 제외.
  const otherDead = 1.5 - heroBlind - villainBlind;

  if (spot.line === 'vs-RFI') {
    // 상대가 2.5bb 오픈. 블라인드 히어로는 이미 낸 만큼 콜이 싸다 (BB 콜 1.5, 일반 2.5).
    const openRange = spot.villainPos ? raiseRangeOf(spot.villainPos) : topPercentRange(20);
    const eqOpen = equityVsRanges(hero, [openRange], { iterations: 2500, seed: 7 }).equities[0];
    const callEv = realization * eqOpen * (5.0 + otherDead) - (2.5 - heroBlind);
    // 3벳(8bb): 상대는 강한 상위 레인지로만 컨티뉴. 폴드시킨 팟엔 내 블라인드 회수 포함.
    const eqCont = equityVsRanges(hero, [topPercentRange(8)], { iterations: 2500, seed: 8 }).equities[0];
    const uncontested = 2.5 + otherDead + heroBlind;
    const threeBetEv =
      FE * uncontested + (1 - FE) * (realization * eqCont * (16.0 + otherDead) - (8 - heroBlind));
    return [
      { key: 'raise', ev: threeBetEv },
      { key: 'call', ev: callEv },
      { key: 'fold', ev: 0 },
    ];
  }

  // vs-3bet: 내가 2.5bb 오픈(매몰) → 상대 8bb 3벳. 현재 팟 = 2.5 + 8 + otherDead.
  const eq3 = equityVsRanges(hero, [topPercentRange(8)], { iterations: 2500, seed: 9 }).equities[0];
  const callEv = realization * eq3 * (16 + otherDead) - 5.5;
  const eq4 = equityVsRanges(hero, [topPercentRange(5)], { iterations: 2500, seed: 10 }).equities[0];
  const potNow = 10.5 + otherDead;
  const fourBetEv = FE * potNow + (1 - FE) * (realization * eq4 * (40 + otherDead) - 17.5);
  return [
    { key: 'raise', ev: fourBetEv },
    { key: 'call', ev: callEv },
    { key: 'fold', ev: 0 },
  ];
}

/* ---- 규칙 기반 오답 해설 (모든 수치는 mix/evRows에서 파생) ---- */

/** 받침 유무에 따른 조사 선택 (콜→이/은, 폴드→가/는). */
function josa(word: string, withJong: string, noJong: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0 ? withJong : noJong;
  return `${withJong}(${noJong})`;
}

/**
 * 피드백 패널용 한 문단 해설: 최적 액션·빈도, 선택이 근소한 차선책이었는지
 * (최빈 빈도의 50% 이상), evRows가 있으면 선택 EV vs 최고 EV 비교(bb).
 */
function buildExplanation(spot: Spot, picked: PreflopAction, evRows: EvRow[] | null): string {
  const line = spot.line;
  const best = bestActionOf(spot.mix);
  const bestFreq = spot.mix[best];
  const bestName = actionName(line, best);
  const pickedName = actionName(line, picked);
  const pickedFreq = spot.mix[picked];
  const parts: string[] = [];
  parts.push(`이 스팟의 최적 액션은 ${bestName} ${Math.round(bestFreq * 100)}%입니다.`);
  if (picked === best) {
    parts.push('최고 빈도 액션을 정확히 골랐습니다.');
  } else if (pickedFreq >= bestFreq * 0.5) {
    parts.push(
      `선택한 ${pickedName}(${Math.round(pickedFreq * 100)}%)도 근소한 차이의 혼합 전략 옵션입니다.`,
    );
  } else {
    parts.push(
      `선택한 ${pickedName}${josa(pickedName, '은', '는')} 빈도 ${Math.round(pickedFreq * 100)}%로 최적 대비 ${Math.round((bestFreq - pickedFreq) * 100)}%p 낮습니다.`,
    );
  }
  if (evRows) {
    const pickedRow = evRows.find((r) => r.key === picked);
    const top = evRows.reduce((m, r) => (r.ev > m.ev ? r : m), evRows[0]);
    if (pickedRow) {
      if (top.key === picked) {
        parts.push(
          `EV 근사로도 ${pickedName}(${fmtBB(pickedRow.ev)})${josa(pickedName, '이', '가')} 가장 유리했습니다.`,
        );
      } else {
        const topName = actionName(line, top.key);
        parts.push(
          `EV 근사로는 ${topName}(${fmtBB(top.ev)})${josa(topName, '이', '가')} ${pickedName}(${fmtBB(pickedRow.ev)})보다 약 ${(top.ev - pickedRow.ev).toFixed(2)}bb 유리했습니다.`,
        );
      }
    }
  }
  return parts.join(' ');
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

const CHIPEV_LINES = [...new Set(CHIPEV_POOL.map((q) => q.line))];
const CHIPEV_STACKS = [...new Set(CHIPEV_POOL.map((q) => q.stackBB))].sort((a, b) => a - b);

function ChipEvDrill({ onGraded }: { onGraded: Graded }) {
  const [quiz, setQuiz] = useState<ChipEvQuiz | null>(null);
  const [combo, setCombo] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  // 상황 설정 ('' = 전체).
  const [fLine, setFLine] = useState('');
  const [fStack, setFStack] = useState('');

  function matches(l: string, s: string) {
    return CHIPEV_POOL.filter((q) => (!l || q.line === l) && (!s || q.stackBB === Number(s)));
  }

  function draw(l = fLine, s = fStack) {
    const filtered = matches(l, s);
    const pool = filtered.length ? filtered : CHIPEV_POOL;
    const q = pool[Math.floor(Math.random() * pool.length)];
    setQuiz(q);
    setCombo(randomCombo(q.hand));
    setPicked(null);
  }

  const filteredCount = matches(fLine, fStack).length;

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
      {/* 상황 설정 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ flex: '1 1 120px' }}>
          <label style={{ fontSize: 12 }}>라인</label>
          <select value={fLine} onChange={(e) => { setFLine(e.target.value); draw(e.target.value, fStack); }}>
            <option value="">전체 (랜덤)</option>
            {CHIPEV_LINES.map((l) => (
              <option key={l} value={l}>{CHIP_LINE_KO[l] ?? l}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label style={{ fontSize: 12 }}>스택</label>
          <select value={fStack} onChange={(e) => { setFStack(e.target.value); draw(fLine, e.target.value); }}>
            <option value="">전체 (랜덤)</option>
            {CHIPEV_STACKS.map((s) => (
              <option key={s} value={String(s)}>{s}bb</option>
            ))}
          </select>
        </div>
        <button className="secondary" onClick={() => draw()} disabled={picked !== null} style={{ padding: '8px 14px', fontSize: 13 }}>
          🔀 다른 문제
        </button>
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          {filteredCount > 0 ? `해당 상황 ${filteredCount}문제` : '조합 없음 — 전체에서 출제'}
        </span>
      </div>

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
            <button onClick={() => draw()}>다음 문제 ▶</button>
          </div>
        </div>
      )}
    </>
  );
}

/* --------------------------- ICM quiz drill ----------------------------- */

const ICM_PAYOUT_NAMES = [...new Set(ICM_POOL.map((q) => q.payoutName))];
const ICM_BUCKETS = [
  { id: 'short', ko: '숏 (≤10bb)', test: (bb: number) => bb <= 10 },
  { id: 'mid', ko: '미들 (10~20bb)', test: (bb: number) => bb > 10 && bb <= 20 },
  { id: 'deep', ko: '딥 (>20bb)', test: (bb: number) => bb > 20 },
];

function heroBBOf(q: IcmQuiz): number {
  return q.blinds.bb > 0 ? q.stacks[q.heroIdx] / q.blinds.bb : 0;
}

function IcmDrill({ onGraded }: { onGraded: Graded }) {
  const [quiz, setQuiz] = useState<IcmQuiz | null>(null);
  const [combo, setCombo] = useState('');
  const [picked, setPicked] = useState<'shove' | 'fold' | null>(null);
  // 상황 설정 ('' = 전체).
  const [fPayout, setFPayout] = useState('');
  const [fBucket, setFBucket] = useState('');

  function matches(p: string, b: string) {
    const bucket = ICM_BUCKETS.find((x) => x.id === b);
    return ICM_POOL.filter(
      (q) => (!p || q.payoutName === p) && (!bucket || bucket.test(heroBBOf(q))),
    );
  }

  function draw(p = fPayout, b = fBucket) {
    const filtered = matches(p, b);
    const pool = filtered.length ? filtered : ICM_POOL;
    const q = pool[Math.floor(Math.random() * pool.length)];
    setQuiz(q);
    setCombo(randomCombo(q.hand));
    setPicked(null);
  }

  const filteredCount = matches(fPayout, fBucket).length;

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
      {/* 상황 설정 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ flex: '1 1 140px' }}>
          <label style={{ fontSize: 12 }}>상금 구조</label>
          <select value={fPayout} onChange={(e) => { setFPayout(e.target.value); draw(e.target.value, fBucket); }}>
            <option value="">전체 (랜덤)</option>
            {ICM_PAYOUT_NAMES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <label style={{ fontSize: 12 }}>내 스택</label>
          <select value={fBucket} onChange={(e) => { setFBucket(e.target.value); draw(fPayout, e.target.value); }}>
            <option value="">전체 (랜덤)</option>
            {ICM_BUCKETS.map((b) => (
              <option key={b.id} value={b.id}>{b.ko}</option>
            ))}
          </select>
        </div>
        <button className="secondary" onClick={() => draw()} disabled={picked !== null} style={{ padding: '8px 14px', fontSize: 13 }}>
          🔀 다른 문제
        </button>
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          {filteredCount > 0 ? `해당 상황 ${filteredCount}문제` : '조합 없음 — 전체에서 출제'}
        </span>
      </div>

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
            <button onClick={() => draw()}>다음 문제 ▶</button>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------- page ---------------------------------- */

export default function TrainerPage() {
  const [mode, setMode] = useState<UiMode>('preflop');
  const [spot, setSpot] = useState<Spot | null>(null);
  const [picked, setPicked] = useState<PreflopAction | null>(null);
  const [stats, setStats] = useState<TrainerStats>(emptyStats);
  const [queue, setQueue] = useState<Spot[]>([]);
  const [autoNext, setAutoNext] = useState(false);
  const timerRef = useRef<number | null>(null);

  // 프리플랍 상황 설정 ('' = 랜덤).
  const [spotFilter, setSpotFilter] = useState<SpotFilter>({ line: '', heroPos: '' });

  // 이번 세션 집계 + 그만하기 상태.
  const [session, setSession] = useState({ total: 0, correct: 0, earned: 0 });
  const [stopped, setStopped] = useState(false);

  // 🎯 일일 미션 (오늘 날짜 기준, localStorage). ref는 이벤트 핸들러에서의
  // 최신값 접근용 (stale closure 방지) — setState 업데이터에 부수효과를 넣지 않는다.
  const [missions, setMissions] = useState<MissionDay>(freshMissions);
  const missionsRef = useRef<MissionDay>(freshMissions());
  const [missionsOpen, setMissionsOpen] = useState(true);

  // 🔍 약점 분석 패널 접힘 상태.
  const [weakOpen, setWeakOpen] = useState(false);

  // ⚡ 타임 어택.
  const [taPhase, setTaPhase] = useState<'idle' | 'running' | 'over'>('idle');
  const [taTimeLeft, setTaTimeLeft] = useState(TA_SECONDS);
  const [taScore, setTaScore] = useState(0);
  const [taTotal, setTaTotal] = useState(0);
  const [taSpot, setTaSpot] = useState<Spot | null>(null);
  const [taFlash, setTaFlash] = useState<'ok' | 'no' | null>(null);
  const [taBest, setTaBest] = useState(0);
  const [taClaimedToday, setTaClaimedToday] = useState(false);
  const [taRunEarned, setTaRunEarned] = useState(false);
  const taIntervalRef = useRef<number | null>(null);
  const taFlashTimerRef = useRef<number | null>(null);
  const taEndRef = useRef(0);
  const taScoreRef = useRef(0);
  const taTotalRef = useRef(0);
  const taBestRef = useRef(0);

  // 정답을 맞히면 게임머니 지급 (로그인 시, 서버 일일 상한 적용).
  const [earnFlash, setEarnFlash] = useState<number | null>(null);
  const earnTimerRef = useRef<number | null>(null);
  function earnReward(reason: 'quiz' | 'mission' | 'timeattack' = 'quiz') {
    fetch('/api/economy/earn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.earned > 0) {
          setSession((s) => ({ ...s, earned: s.earned + d.earned }));
          setEarnFlash(d.earned);
          if (earnTimerRef.current) window.clearTimeout(earnTimerRef.current);
          earnTimerRef.current = window.setTimeout(() => setEarnFlash(null), 1500);
        }
      })
      .catch(() => {});
  }

  // Client-only bootstrap: load persisted stats/missions/TA records and deal
  // the first spot. Cleanup clears every timer this page can start.
  useEffect(() => {
    setStats(loadStats());
    setSpot(randomSpot());
    const m = loadMissions();
    missionsRef.current = m;
    setMissions(m);
    try {
      const best = Number(window.localStorage.getItem(TA_BEST_KEY) ?? '0') || 0;
      taBestRef.current = best;
      setTaBest(best);
    } catch {
      /* ignore */
    }
    try {
      const raw = window.localStorage.getItem(TA_CLAIM_KEY);
      const c = raw ? (JSON.parse(raw) as { date?: string; claimed?: boolean }) : null;
      if (c && c.date === todayStr() && c.claimed) setTaClaimedToday(true);
    } catch {
      /* ignore */
    }
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (earnTimerRef.current) window.clearTimeout(earnTimerRef.current);
      if (taIntervalRef.current) window.clearInterval(taIntervalRef.current);
      if (taFlashTimerRef.current) window.clearTimeout(taFlashTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function nextSpot(filter: SpotFilter = spotFilter) {
    clearTimer();
    setPicked(null);
    if (queue.length) {
      setSpot(queue[0]);
      setQueue(queue.slice(1));
    } else {
      setSpot(randomSpot(filter));
    }
  }

  /** 상황 설정 변경: 현재 문제를 즉시 새 조건으로 교체 (채점 없음). */
  function changeSituation(patch: Partial<SpotFilter>) {
    const next = { ...spotFilter, ...patch };
    // 라인이 바뀌어 현재 포지션이 불가능해지면 포지션은 랜덤으로 되돌림.
    if (next.heroPos && !heroesFor(next.line).includes(next.heroPos as Position)) {
      next.heroPos = '';
    }
    setSpotFilter(next);
    clearTimer();
    setQueue([]); // 오답 복습 큐는 조건과 무관하므로 비움
    setPicked(null);
    setSpot(randomSpot(next));
  }

  /** 타임 어택 시작 화면용: 필터만 바꾸고 스팟/큐는 건드리지 않는다. */
  function changeFilterOnly(patch: Partial<SpotFilter>) {
    setSpotFilter((cur) => {
      const next = { ...cur, ...patch };
      if (next.heroPos && !heroesFor(next.line).includes(next.heroPos as Position)) {
        next.heroPos = '';
      }
      return next;
    });
  }

  /**
   * 🎯 일일 미션 진행 (모든 모드의 채점기에서 호출 — 이벤트 핸들러 안에서만).
   * 타임 어택 답안은 m1/m2에만 집계 (affectStreak=false → m3 연속 기록 불변).
   * 새로 달성된 미션은 즉시 claimed 처리 후 서버에 보상 요청 (401/상한 에러는
   * earnReward 내부에서 조용히 무시됨).
   */
  function bumpMissions(correct: boolean, affectStreak = true) {
    const cur = missionsRef.current.date === todayStr() ? missionsRef.current : freshMissions();
    const streak = affectStreak ? (correct ? cur.streak + 1 : 0) : cur.streak;
    const next: MissionDay = {
      ...cur,
      solved: cur.solved + 1,
      correct: cur.correct + (correct ? 1 : 0),
      streak,
      bestStreak: Math.max(cur.bestStreak, streak),
      claimed: { ...cur.claimed },
    };
    let claims = 0;
    if (next.solved >= MISSION_TARGETS.m1 && !next.claimed.m1) {
      next.claimed.m1 = true;
      claims += 1;
    }
    if (next.correct >= MISSION_TARGETS.m2 && !next.claimed.m2) {
      next.claimed.m2 = true;
      claims += 1;
    }
    if (next.bestStreak >= MISSION_TARGETS.m3 && !next.claimed.m3) {
      next.claimed.m3 = true;
      claims += 1;
    }
    missionsRef.current = next;
    setMissions(next);
    saveMissions(next);
    for (let i = 0; i < claims; i += 1) earnReward('mission');
  }

  /* ---- ⚡ 타임 어택 ---- */

  function clearTaTimers() {
    if (taIntervalRef.current) {
      window.clearInterval(taIntervalRef.current);
      taIntervalRef.current = null;
    }
    if (taFlashTimerRef.current) {
      window.clearTimeout(taFlashTimerRef.current);
      taFlashTimerRef.current = null;
    }
  }

  /** 러닝 중 취소 (모드 전환·세션 중단·나가기): 점수 평가 없이 대기 화면으로. */
  function cancelTimeAttack() {
    clearTaTimers();
    setTaPhase('idle');
    setTaFlash(null);
  }

  function startTimeAttack() {
    clearTaTimers();
    taScoreRef.current = 0;
    taTotalRef.current = 0;
    setTaScore(0);
    setTaTotal(0);
    setTaFlash(null);
    setTaRunEarned(false);
    setTaTimeLeft(TA_SECONDS);
    setTaSpot(randomSpot(spotFilter));
    setTaPhase('running');
    taEndRef.current = Date.now() + TA_SECONDS * 1000;
    taIntervalRef.current = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((taEndRef.current - Date.now()) / 1000));
      setTaTimeLeft(left);
      if (left <= 0) finishTimeAttack();
    }, 250);
  }

  /** 러닝 종료 (시간 만료 또는 수동 중단): 최고 기록 저장 + 일일 보상 1회. */
  function finishTimeAttack() {
    clearTaTimers();
    setTaPhase('over');
    setTaFlash(null);
    const score = taScoreRef.current;
    if (score > taBestRef.current) {
      taBestRef.current = score;
      setTaBest(score);
      try {
        window.localStorage.setItem(TA_BEST_KEY, String(score));
      } catch {
        /* ignore */
      }
    }
    if (score >= TA_REWARD_SCORE) {
      let already = false;
      try {
        const raw = window.localStorage.getItem(TA_CLAIM_KEY);
        const c = raw ? (JSON.parse(raw) as { date?: string; claimed?: boolean }) : null;
        already = !!c && c.date === todayStr() && !!c.claimed;
      } catch {
        /* ignore */
      }
      if (!already) {
        try {
          window.localStorage.setItem(TA_CLAIM_KEY, JSON.stringify({ date: todayStr(), claimed: true }));
        } catch {
          /* ignore */
        }
        setTaClaimedToday(true);
        setTaRunEarned(true);
        earnReward('timeattack');
      }
    }
  }

  /**
   * 타임 어택 채점: 같은 믹스 허용 규칙, 즉시 다음 문제 (피드백 정지 없음).
   * 전적(TrainerStats)은 오염시키지 않되 (saveStats 미호출) 미션 m1/m2에는 집계.
   */
  function taAnswer(a: PreflopAction) {
    if (taPhase !== 'running' || !taSpot) return;
    const best = Math.max(taSpot.mix.fold, taSpot.mix.call, taSpot.mix.raise);
    const correct = taSpot.mix[a] >= best * 0.5;
    taTotalRef.current += 1;
    if (correct) taScoreRef.current += 1;
    setTaTotal(taTotalRef.current);
    setTaScore(taScoreRef.current);
    setTaFlash(correct ? 'ok' : 'no');
    if (taFlashTimerRef.current) window.clearTimeout(taFlashTimerRef.current);
    taFlashTimerRef.current = window.setTimeout(() => setTaFlash(null), 400);
    bumpMissions(correct, false);
    setTaSpot(randomSpot(spotFilter));
  }

  /** 모드 전환: 타임 어택에서 나갈 때는 러닝/타이머를 반드시 취소. */
  function switchMode(m: UiMode) {
    if (m === mode) return;
    if (mode === 'timeattack') cancelTimeAttack();
    setMode(m);
  }

  /** 🔍 약점 분석 → 해당 상황 필터를 적용하고 프리플랍 드릴로 진입. */
  function practiceWeak(filter: SpotFilter) {
    if (mode === 'timeattack') cancelTimeAttack();
    setMode('preflop');
    setStopped(false);
    changeSituation(filter);
  }

  function answer(a: PreflopAction) {
    if (!spot || picked !== null) return;
    setPicked(a);
    const best = Math.max(spot.mix.fold, spot.mix.call, spot.mix.raise);
    const correct = spot.mix[a] >= best * 0.5; // mixed strategies accept close seconds
    const line = stats.byLine[spot.line] ?? { total: 0, correct: 0 };
    const pf = stats.byMode.preflop;
    const pos = stats.byPos[spot.heroPos] ?? { total: 0, correct: 0 };
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
      byPos: {
        ...stats.byPos,
        [spot.heroPos]: { total: pos.total + 1, correct: pos.correct + (correct ? 1 : 0) },
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
    setSession((s) => ({ ...s, total: s.total + 1, correct: s.correct + (correct ? 1 : 0) }));
    bumpMissions(correct);
    if (correct) earnReward();
    if (autoNext) timerRef.current = window.setTimeout(() => nextSpot(), 1800);
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
    setSession((s) => ({ ...s, total: s.total + 1, correct: s.correct + (correct ? 1 : 0) }));
    bumpMissions(correct);
    if (correct) earnReward();
  }

  function retryWrong() {
    const notes = stats.wrong.filter((w): w is PreflopWrong => w.mode === 'preflop');
    if (!notes.length) return;
    if (mode === 'timeattack') cancelTimeAttack(); // 타임어택 러닝/타이머 반드시 취소
    clearTimer();
    setStopped(false); // 세션 요약 화면에서 눌러도 바로 복습 드릴로 진입
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
  const sessionAccuracy = session.total ? Math.round((session.correct / session.total) * 100) : 0;

  // 🔍 약점 분석: 표본 5개 이상인 라인/포지션별 정답률 (60% 미만 = 약점).
  const lineChips = LINES.map((l) => ({ line: l, s: stats.byLine[l] }))
    .filter((x) => x.s.total >= 5)
    .map((x) => ({ line: x.line, total: x.s.total, pct: Math.round((x.s.correct / x.s.total) * 100) }));
  const posChips = POSITIONS_6MAX.map((p) => ({ pos: p, s: stats.byPos[p] ?? { total: 0, correct: 0 } }))
    .filter((x) => x.s.total >= 5)
    .map((x) => ({ pos: x.pos, total: x.s.total, pct: Math.round((x.s.correct / x.s.total) * 100) }));
  const taAccuracy = taTotal ? Math.round((taScore / taTotal) * 100) : 0;

  // 답변 후에만 액션별 EV 근사 계산 (몬테카를로 — 답 전에 돌리면 낭비).
  const evRows = useMemo(
    () => (mode === 'preflop' && spot && picked !== null ? preflopActionEvs(spot) : null),
    [mode, spot, picked],
  );
  const evBest = evRows ? evRows.reduce((m, r) => (r.ev > m.ev ? r : m), evRows[0]).key : null;

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      {earnFlash != null && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--warn)',
            color: '#0a0e13',
            fontWeight: 700,
            padding: '8px 16px',
            borderRadius: 999,
            zIndex: 50,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          💰 +{earnFlash.toLocaleString('ko-KR')} 게임머니
        </div>
      )}
      <h1>학습하기 · 문제 풀이 연습</h1>
      <p className="subtitle">
        실전처럼 반복 연습하는 문제 풀이 — 프리플랍 상황(실시간), 칩 기준 실전 문제, ICM(상금 고려)
        올인/폴드 문제를 풉니다. 기록은 내 기기에 저장됩니다. 문제 수: 칩EV {CHIP_COUNTS.chipEv}개 · ICM{' '}
        {CHIP_COUNTS.icm}개. 모르는 용어는 상단 메뉴 &lsquo;용어 사전&rsquo;.
      </p>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {UI_MODES.map((m) => {
          const active = m === mode;
          const accentColor = m === 'timeattack' ? 'var(--warn)' : 'var(--accent)';
          const accentBg = m === 'timeattack' ? 'rgba(210,153,34,0.12)' : 'rgba(63,185,80,0.12)';
          return (
            <button
              key={m}
              type="button"
              className="secondary"
              onClick={() => switchMode(m)}
              style={{
                flex: '1 1 140px',
                padding: '10px 12px',
                fontSize: 14,
                fontWeight: 800,
                borderColor: active ? accentColor : 'var(--border)',
                color: active ? accentColor : 'var(--text-dim)',
                background: active ? accentBg : 'var(--bg-elevated)',
              }}
            >
              {UI_MODE_KO[m]}
            </button>
          );
        })}
      </div>

      {/* Session stats strip */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            이번 세션: <strong style={{ color: 'var(--text)' }}>{session.total}문제</strong>
            {session.total > 0 && <> · 정답률 <strong style={{ color: 'var(--text)' }}>{sessionAccuracy}%</strong></>}
            {session.earned > 0 && (
              <> · <strong style={{ color: 'var(--warn)' }}>💰 +{session.earned.toLocaleString('ko-KR')}</strong></>
            )}
          </span>
          {!stopped && (
            <button
              className="secondary"
              onClick={() => {
                clearTimer();
                if (mode === 'timeattack') cancelTimeAttack();
                setStopped(true);
              }}
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              ⏹ 그만하기
            </button>
          )}
        </div>
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

      {/* 🎯 일일 미션 (모든 모드의 답안이 집계, 달성 시 자동 보상) */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            🎯 일일 미션{' '}
            <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>({missions.date})</span>
          </h2>
          <button
            className="secondary"
            onClick={() => setMissionsOpen((o) => !o)}
            style={{ padding: '4px 12px', fontSize: 13 }}
          >
            {missionsOpen ? '접기 ▲' : '펼치기 ▼'}
          </button>
        </div>
        {missionsOpen && (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {(
              [
                ['m1', `문제 ${MISSION_TARGETS.m1}개 풀기`, missions.solved, MISSION_TARGETS.m1],
                ['m2', `정답 ${MISSION_TARGETS.m2}개 맞히기`, missions.correct, MISSION_TARGETS.m2],
                ['m3', `${MISSION_TARGETS.m3}연속 정답`, missions.bestStreak, MISSION_TARGETS.m3],
              ] as const
            ).map(([id, label, cur, target]) => {
              const done = missions.claimed[id];
              const clamped = Math.min(cur, target);
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ flex: '0 0 160px', fontSize: 13, fontWeight: 700, color: done ? 'var(--accent)' : 'var(--text)' }}>
                    {done ? '✅ ' : ''}
                    {label}
                  </span>
                  <div style={{ flex: '1 1 120px', height: 10, borderRadius: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.round((clamped / target) * 100)}%`,
                        height: '100%',
                        background: done ? 'var(--accent)' : 'var(--warn)',
                      }}
                    />
                  </div>
                  <span className="muted" style={{ flex: '0 0 52px', textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {clamped}/{target}
                  </span>
                </div>
              );
            })}
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              미션 달성 시 자동으로 +5,000 게임머니가 지급됩니다 (로그인 시 · 일일 상한 적용). 타임
              어택 답안도 풀기/정답 미션에 포함됩니다.
            </p>
          </div>
        )}
      </div>

      {/* Drill card (or session summary when stopped). The drills stay
          MOUNTED while stopped (hidden) so their question + filters survive
          '이어서 하기'. */}
      <div className="card">
        {stopped && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <h2 style={{ margin: '0 0 4px' }}>🏁 세션 종료</h2>
            <p className="muted" style={{ margin: '0 0 16px' }}>수고하셨습니다! 이번 세션 결과입니다.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 18 }}>
              {[
                ['푼 문제', `${session.total}개`],
                ['정답률', session.total ? `${sessionAccuracy}%` : '—'],
                ['획득 게임머니', session.earned > 0 ? `💰 +${session.earned.toLocaleString('ko-KR')}` : '0'],
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    flex: '1 1 130px',
                    maxWidth: 200,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '12px 14px',
                  }}
                >
                  <div className="muted" style={{ fontSize: 12 }}>{k}</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setStopped(false)}>▶ 이어서 하기</button>
              <button
                className="secondary"
                onClick={() => {
                  setSession({ total: 0, correct: 0, earned: 0 });
                  setStopped(false);
                  if (mode === 'preflop') nextSpot();
                }}
              >
                🔄 새 세션 시작
              </button>
            </div>
          </div>
        )}
        <div hidden={stopped}>
        {mode === 'chipev' ? (
          <ChipEvDrill onGraded={recordQuiz} />
        ) : mode === 'icm' ? (
          <IcmDrill onGraded={recordQuiz} />
        ) : mode === 'timeattack' ? (
          taPhase === 'idle' ? (
            <div>
              <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>⚡ 타임 어택 — {TA_SECONDS}초 스피드런</h2>
              <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
                {TA_SECONDS}초 동안 프리플랍 문제를 최대한 많이 맞히세요. 답과 동시에 다음 문제로
                넘어갑니다 (피드백 정지 없음, ✓/✗만 잠깐 표시). {TA_REWARD_SCORE}점 이상이면 하루 1회
                +2,000 게임머니. 전적(정답률·오답 노트)에는 반영되지 않지만 일일 미션(풀기/정답)에는
                포함됩니다.
              </p>
              {/* 상황 설정 (프리플랍 드릴과 동일 필터 재사용) */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={{ fontSize: 12 }}>라인</label>
                  <select
                    value={spotFilter.line}
                    onChange={(e) => changeFilterOnly({ line: e.target.value as ActionLine | '' })}
                  >
                    <option value="">전체 (랜덤)</option>
                    {LINES.map((l) => (
                      <option key={l} value={l}>{LINE_KO[l]}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <label style={{ fontSize: 12 }}>내 포지션</label>
                  <select
                    value={spotFilter.heroPos}
                    onChange={(e) => changeFilterOnly({ heroPos: e.target.value as Position | '' })}
                  >
                    <option value="">전체 (랜덤)</option>
                    {heroesFor(spotFilter.line).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button onClick={startTimeAttack} style={{ fontSize: 16, fontWeight: 800, padding: '12px 22px' }}>
                  ▶ 시작 ({TA_SECONDS}초)
                </button>
                <span className="muted" style={{ fontSize: 13 }}>
                  최고 기록: <strong style={{ color: 'var(--warn)' }}>{taBest}점</strong>
                  {taClaimedToday && ' · 오늘 보상 수령 완료'}
                </span>
              </div>
            </div>
          ) : taPhase === 'over' ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <h2 style={{ margin: '0 0 4px' }}>⚡ 타임 어택 종료</h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', margin: '14px 0 14px' }}>
                {[
                  ['점수', `${taScore}점`],
                  ['정답률', taTotal ? `${taAccuracy}% (${taScore}/${taTotal})` : '—'],
                  ['최고 기록', `${taBest}점`],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      flex: '1 1 130px',
                      maxWidth: 200,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <div className="muted" style={{ fontSize: 12 }}>{k}</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
                  </div>
                ))}
              </div>
              {taScore >= TA_REWARD_SCORE ? (
                taRunEarned ? (
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--warn)', margin: '0 0 14px' }}>
                    🎉 {TA_REWARD_SCORE}점 달성 — +2,000 게임머니 지급! (로그인 시)
                  </p>
                ) : (
                  <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
                    {TA_REWARD_SCORE}점 달성! 오늘 타임 어택 보상은 이미 받았습니다.
                  </p>
                )
              ) : (
                <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
                  {TA_REWARD_SCORE}점 이상이면 하루 1회 게임머니 보상이 있습니다.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={startTimeAttack}>🔄 다시 도전</button>
                <button className="secondary" onClick={cancelTimeAttack}>
                  나가기
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 40,
                    fontWeight: 900,
                    fontVariantNumeric: 'tabular-nums',
                    color: taTimeLeft <= 10 ? 'var(--danger)' : 'var(--warn)',
                  }}
                >
                  ⏱ {taTimeLeft}s
                </div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  점수 {taScore} <span className="muted" style={{ fontSize: 13 }}>/ {taTotal}문제</span>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 32,
                      marginLeft: 8,
                      fontSize: 26,
                      fontWeight: 900,
                      color: taFlash === 'ok' ? 'var(--accent)' : 'var(--danger)',
                      visibility: taFlash ? 'visible' : 'hidden',
                    }}
                  >
                    {taFlash === 'no' ? '✗' : '✓'}
                  </span>
                </div>
              </div>
              {taSpot && (
                <>
                  <p style={{ fontSize: 16, fontWeight: 600, margin: '4px 0 12px' }}>{situationText(taSpot)}</p>
                  <PositionRow
                    heroPos={taSpot.heroPos}
                    villainPos={taSpot.villainPos}
                    stackBB={STACK_BB}
                    villainRole={taSpot.line === 'RFI-vs-3bet' ? '3벳터' : '오프너'}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    <HoleCards combo={taSpot.combo} />
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{taSpot.label}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {actionsFor(taSpot.line).map((a) => (
                      <button
                        key={a}
                        type="button"
                        className="secondary"
                        onClick={() => taAnswer(a)}
                        style={{
                          flex: '1 1 90px',
                          padding: '14px 10px',
                          fontSize: 16,
                          fontWeight: 800,
                          borderColor: ACTION_COLORS[a],
                          color: ACTION_COLORS[a],
                        }}
                      >
                        {actionName(taSpot.line, a)}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button className="secondary" onClick={finishTimeAttack} style={{ padding: '6px 14px', fontSize: 13 }}>
                      ⏹ 중단하고 결과 보기
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        ) : !spot ? (
          <p className="muted">문제를 생성하는 중…</p>
        ) : (
          <>
            {/* 상황 설정 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ flex: '1 1 140px' }}>
                <label style={{ fontSize: 12 }}>라인</label>
                <select
                  value={spotFilter.line}
                  onChange={(e) => changeSituation({ line: e.target.value as ActionLine | '' })}
                >
                  <option value="">전체 (랜덤)</option>
                  {LINES.map((l) => (
                    <option key={l} value={l}>{LINE_KO[l]}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <label style={{ fontSize: 12 }}>내 포지션</label>
                <select
                  value={spotFilter.heroPos}
                  onChange={(e) => changeSituation({ heroPos: e.target.value as Position | '' })}
                >
                  <option value="">전체 (랜덤)</option>
                  {heroesFor(spotFilter.line).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <button
                className="secondary"
                onClick={() => nextSpot()}
                disabled={picked !== null}
                style={{ padding: '8px 14px', fontSize: 13 }}
              >
                🔀 다른 문제
              </button>
            </div>

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

                {/* 액션별 EV 근사 */}
                {evRows && (
                  <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                      액션별 기대이득(EV) 근사 — 칩EV, bb 단위, 폴드 = 0 기준
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {evRows.map((r) => {
                        const isBest = r.key === evBest;
                        return (
                          <div
                            key={r.key}
                            style={{
                              flex: '1 1 90px',
                              textAlign: 'center',
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: isBest ? `2px solid ${ACTION_COLORS[r.key]}` : '1px solid var(--border)',
                              background: isBest ? `${ACTION_COLORS[r.key]}14` : 'var(--bg)',
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 700, color: ACTION_COLORS[r.key] }}>
                              {actionName(spot.line, r.key)}
                              {isBest ? ' ★' : ''}
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: r.ev > 0.005 ? 'var(--accent)' : r.ev < -0.005 ? 'var(--danger)' : 'var(--text)' }}>
                              {fmtBB(r.ev)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                      * 단순화된 베팅 트리(오픈 2.5bb·3벳 8bb·4벳 20bb)·고정 폴드율(55%) 가정의 몬테카를로
                      근사입니다. 리레이즈 EV는 블러프 가치가 후하게 잡힐 수 있으니 — 매번 하면 상대가
                      조정합니다 — 위 GTO 빈도와 함께 참고하세요.
                    </div>
                  </div>
                )}

                {/* 규칙 기반 해설 — 최적 빈도·근소 차선 여부·EV 비교 (모두 데이터 파생) */}
                <p
                  style={{
                    fontSize: 13,
                    margin: '10px 0 0',
                    padding: '8px 10px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  💡 {buildExplanation(spot, picked, evRows)}
                </p>

                <p className="muted" style={{ fontSize: 13, margin: '10px 0 12px' }}>
                  13×13 그리드에서 <strong style={{ color: 'var(--text)' }}>{spot.label}</strong> 셀은 «{spot.chartLabel}» 차트 기준{' '}
                  {mixSummary(spot.line, spot.mix)} 믹스입니다 — 최적 액션은{' '}
                  <strong style={{ color: ACTION_COLORS[bestAction ?? 'fold'] }}>
                    {actionName(spot.line, bestAction ?? 'fold')} {Math.round(bestFreq * 100)}%
                  </strong>
                  입니다.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button onClick={() => nextSpot()}>다음 문제 ▶</button>
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
      </div>

      {/* 🔍 약점 분석 — 라인/포지션별 정답률 (표본 5+), 60% 미만은 약점 표시 */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>🔍 약점 분석</h2>
          <button
            className="secondary"
            onClick={() => setWeakOpen((o) => !o)}
            style={{ padding: '4px 12px', fontSize: 13 }}
          >
            {weakOpen ? '접기 ▲' : '펼치기 ▼'}
          </button>
        </div>
        {weakOpen &&
          (lineChips.length === 0 && posChips.length === 0 ? (
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
              아직 표본이 부족합니다 — 프리플랍 드릴에서 라인/포지션별로 5문제 이상 풀면 정답률이
              표시됩니다.
            </p>
          ) : (
            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              {lineChips.length > 0 && (
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>라인별 (프리플랍)</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {lineChips.map((c) => {
                      const weak = c.pct < 60;
                      return (
                        <span
                          key={c.line}
                          className="pill"
                          style={{
                            background: weak ? 'rgba(248,81,73,0.12)' : 'var(--bg-elevated)',
                            border: `1px solid ${weak ? 'var(--danger)' : 'var(--border)'}`,
                            color: 'var(--text)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          {LINE_SHORT[c.line]}{' '}
                          <strong style={{ color: weak ? 'var(--danger)' : c.pct >= 70 ? 'var(--accent)' : 'var(--warn)' }}>
                            {c.pct}%
                          </strong>
                          <span className="muted" style={{ fontSize: 11 }}>({c.total}문제)</span>
                          {weak && (
                            <button
                              className="secondary"
                              onClick={() => practiceWeak({ line: c.line, heroPos: '' })}
                              style={{ padding: '2px 8px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            >
                              이 상황 연습하기
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {posChips.length > 0 && (
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>내 포지션별 (프리플랍)</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {posChips.map((c) => {
                      const weak = c.pct < 60;
                      return (
                        <span
                          key={c.pos}
                          className="pill"
                          style={{
                            background: weak ? 'rgba(248,81,73,0.12)' : 'var(--bg-elevated)',
                            border: `1px solid ${weak ? 'var(--danger)' : 'var(--border)'}`,
                            color: 'var(--text)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          {c.pos}{' '}
                          <strong style={{ color: weak ? 'var(--danger)' : c.pct >= 70 ? 'var(--accent)' : 'var(--warn)' }}>
                            {c.pct}%
                          </strong>
                          <span className="muted" style={{ fontSize: 11 }}>({c.total}문제)</span>
                          {weak && (
                            <button
                              className="secondary"
                              onClick={() => practiceWeak({ line: '', heroPos: c.pos })}
                              style={{ padding: '2px 8px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            >
                              이 상황 연습하기
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                정답률 60% 미만(표본 5문제 이상)은 빨간색으로 표시되며, 버튼으로 해당 상황 필터를 바로
                적용할 수 있습니다. 타임 어택 답안은 집계되지 않습니다.
              </p>
            </div>
          ))}
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
