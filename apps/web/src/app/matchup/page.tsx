'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  rangeMatchup,
  calcEquity,
  parseRange,
  rangeToCombos,
  labelToCombos,
  parseCards,
  getChart,
  solvePostflop,
  allGridLabels,
  topPercentRange,
  gridLabel,
  cardRank,
  cardSuit,
  bubbleFactor,
  payoutsFor,
  PAYOUT_PRESETS,
  NUT_EQUITY_THRESHOLD,
  STRONG_EQUITY_THRESHOLD,
  type Combo,
  type Position,
  type LabelEquity,
  type RangeMatchupResult,
  type PlayerSpec,
  type ChartSource,
} from '@gto/engine';
import { BoardPicker, HandGridPicker } from '@/components/Pickers';
import { PlayingCards } from '@/components/Cards';

const POSITIONS: Position[] = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const PLAYER_COLORS = ['#58a6ff', '#f85149', '#d29922', '#3fb950'];

interface PlayerCfg {
  pos: Position;
  source: 'chart' | 'manual';
  range: string;
}

const DEFAULT_RANGE = '55+, A8s+, KTs+, QTs+, JTs, T9s, 98s, ATo+, KJo+, QJo';

const DEFAULT_PLAYERS: PlayerCfg[] = [
  { pos: 'BTN', source: 'chart', range: DEFAULT_RANGE },
  { pos: 'BB', source: 'chart', range: DEFAULT_RANGE },
  { pos: 'CO', source: 'chart', range: DEFAULT_RANGE },
  { pos: 'SB', source: 'chart', range: DEFAULT_RANGE },
];

/** Solver-style range text -> concrete combos (exact combos like "AhKh" allowed). */
function combosFrom(input: string): Combo[] {
  const out: Combo[] = [];
  for (const tok of input.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (/^([2-9TJQKA][cdhs]){2}$/i.test(tok)) {
      out.push(parseCards(tok) as Combo);
    } else {
      for (const x of rangeToCombos(parseRange(tok))) out.push(x.combo);
    }
  }
  return out;
}

/**
 * "차트 자동" 레인지 결정: P1(오프너)은 RFI 오픈(레이즈 빈도 > 50% 라벨),
 * 나머지는 P1 포지션을 상대로 한 vs-RFI 디펜드(콜+레이즈 > 50%) 차트를 쓰고,
 * 저장된 차트가 없으면 상위 N% 근사로 폴백합니다 (사용한 소스를 note로 반환).
 */
function chartLabelsFor(idx: number, cfgs: PlayerCfg[]): { labels: string[]; note: string } {
  const pos = cfgs[idx].pos;
  if (idx === 0) {
    const chart = getChart({ gameType: 'cash', stackBB: 100, heroPos: pos, line: 'RFI' });
    const labels = allGridLabels().filter((l) => (chart.hands.get(l)?.raise ?? 0) > 0.5);
    if (labels.length) {
      return {
        labels,
        note: `${pos} RFI 오픈 ${chart.source === 'chart' ? '차트' : '근사'} (${labels.length}라벨)`,
      };
    }
    const fb = [...topPercentRange(30).keys()];
    return { labels: fb, note: `${pos} 오픈 차트 없음 → 상위 30% 근사 (${fb.length}라벨)` };
  }
  const opener = cfgs[0].pos;
  if (pos !== opener) {
    const chart = getChart({
      gameType: 'cash',
      stackBB: 100,
      heroPos: pos,
      villainPos: opener,
      line: 'vs-RFI',
    });
    if (chart.source === 'chart') {
      const labels = allGridLabels().filter((l) => {
        const h = chart.hands.get(l);
        return !!h && h.call + h.raise > 0.5;
      });
      if (labels.length) return { labels, note: `${pos} vs ${opener} 디펜드 차트 (${labels.length}라벨)` };
    }
  }
  const fb = [...topPercentRange(25).keys()];
  return { labels: fb, note: `${pos} vs ${opener} 디펜드 차트 없음 → 상위 25% 근사 (${fb.length}라벨)` };
}

/** 포지션 이름 (중복 포지션이면 번호를 붙여 구분). */
function namesOf(cfgs: PlayerCfg[]): string[] {
  return cfgs.map((p, i) =>
    cfgs.some((q, j) => j !== i && q.pos === p.pos) ? `${p.pos}#${i + 1}` : p.pos,
  );
}

/** 포스트플랍 액션 순서 (값이 작을수록 먼저 액션 = OOP). */
const POSTFLOP_ORDER: Record<Position, number> = { SB: 0, BB: 1, UTG: 2, MP: 3, CO: 4, BTN: 5 };
const STREET_KO = { flop: '플랍', turn: '턴', river: '리버' } as const;
/** 솔버 벳 사이즈 (팟 대비) 와 그 벳을 콜할 때의 팟 오즈 필요 에쿼티 B/(P+2B). */
const SOLVER_BET_FRACTION = 0.66;
const IP_CALL_REQ_EQ = SOLVER_BET_FRACTION / (1 + 2 * SOLVER_BET_FRACTION);
const BIG_PILL = { fontSize: 15, padding: '8px 14px' };
const pct0 = (x: number) => `${Math.round(x * 100)}%`;

/** 콤보 → 13x13 그리드 라벨 (예: "AKs", "77"). */
function comboGridLabel(c: Combo): string {
  const r0 = cardRank(c[0]);
  const r1 = cardRank(c[1]);
  return gridLabel(r0, r1, r0 === r1 ? null : cardSuit(c[0]) === cardSuit(c[1]));
}

/** 🎯 추천 액션 — 2인 포스트플랍 솔버 결과. */
interface SolverReco {
  kind: 'solver';
  street: 'flop' | 'turn' | 'river';
  /** 포스트플랍 선 액션(OOP) 플레이어 인덱스 (0 = P1). */
  oopIdx: 0 | 1;
  pot: number;
  oopBetFreq: number;
  ipCallVsBetFreq: number;
  oopEV: number;
  approximate: boolean;
  /** 내 핸드(P1)가 OOP일 때의 핸드별 벳/체크 믹스 (exact = 정확 콤보 매칭). */
  heroOop: { bet: number; check: number; exact: boolean } | null;
}

interface ChartMix {
  raise: number;
  call: number;
  fold: number;
  source: ChartSource;
}

/** 🎯 추천 액션 — 프리플랍 차트 조회 결과 (2인 · 보드 0장 · 내 핸드 필수). */
interface ChartReco {
  kind: 'chart';
  label: string;
  /** P1 시점: RFI 오픈 믹스. */
  rfi: ChartMix;
  /** P2 시점: vs P1 RFI 디펜드 믹스 (같은 포지션이면 null). */
  vsRfi: ChartMix | null;
}

interface HeroInfo {
  cards: string;
  label: string;
  /** 내 핸드 vs 상대 레인지 각각의 헤즈업 에쿼티. */
  vsEach: number[];
  /** 상대 전원을 동시에 상대한 멀티웨이 에쿼티. */
  multi: number;
  /** 내 레인지 분포에서의 위치 (상위 N%). */
  topPct: number;
  inRange: boolean;
}

interface AnalysisResult {
  res: RangeMatchupResult;
  names: string[];
  notes: string[];
  hero: HeroInfo | null;
  board: string;
  /** 🎯 추천 액션 데이터 — null이면 휴리스틱 카드로 대체. */
  reco: SolverReco | ChartReco | null;
  recoError: string | null;
}

/** GTO-Wizard식 에쿼티 분포 곡선: x = 레인지 percentile, y = 에쿼티. */
function DistributionChart({ dists, colors }: { dists: LabelEquity[][]; colors: string[] }) {
  const W = 460;
  const H = 250;
  const padL = 38;
  const padR = 12;
  const padT = 12;
  const padB = 34;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const x = (pct: number) => padL + (pct / 100) * iw;
  const y = (eq: number) => padT + (1 - eq) * ih;

  const linePts = (dist: LabelEquity[]) => {
    const total = dist.reduce((s, d) => s + d.weightCombos, 0) || 1;
    let cum = 0;
    const pts: string[] = [];
    if (dist.length) pts.push(`${x(0)},${y(dist[0].equity)}`);
    for (const d of dist) {
      const mid = ((cum + d.weightCombos / 2) / total) * 100;
      pts.push(`${x(mid)},${y(d.equity)}`);
      cum += d.weightCombos;
    }
    if (dist.length) pts.push(`${x(100)},${y(dist[dist.length - 1].equity)}`);
    return pts.join(' ');
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', maxWidth: 620, height: 'auto', display: 'block' }}
      role="img"
      aria-label="레인지 에쿼티 분포 곡선"
    >
      {/* 25/50/75 gridlines + axis labels */}
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={`h${g}`}>
          {g > 0 && g < 100 && (
            <line
              x1={padL}
              x2={W - padR}
              y1={y(g / 100)}
              y2={y(g / 100)}
              stroke="var(--border)"
              strokeWidth={0.6}
            />
          )}
          <text x={padL - 5} y={y(g / 100) + 3} textAnchor="end" fontSize="9" fill="var(--text-dim)">
            {g}%
          </text>
        </g>
      ))}
      {[25, 50, 75].map((g) => (
        <line
          key={`v${g}`}
          x1={x(g)}
          x2={x(g)}
          y1={padT}
          y2={padT + ih}
          stroke="var(--border)"
          strokeWidth={0.6}
        />
      ))}
      {[0, 25, 50, 75, 100].map((g) => (
        <text key={`xl${g}`} x={x(g)} y={H - 18} textAnchor="middle" fontSize="9" fill="var(--text-dim)">
          {g}
        </text>
      ))}
      <text x={x(50)} y={H - 6} textAnchor="middle" fontSize="9.5" fill="var(--text-dim)">
        레인지 percentile (강한 핸드 → 약한 핸드, %)
      </text>
      {/* 넛 기준선 80% */}
      <line
        x1={padL}
        x2={W - padR}
        y1={y(NUT_EQUITY_THRESHOLD)}
        y2={y(NUT_EQUITY_THRESHOLD)}
        stroke="var(--warn)"
        strokeWidth={1}
        strokeDasharray="5 4"
      />
      <text x={W - padR} y={y(NUT_EQUITY_THRESHOLD) - 4} textAnchor="end" fontSize="9" fill="var(--warn)">
        넛 기준 80%
      </text>
      {dists.map((dist, i) => (
        <polyline
          key={i}
          points={linePts(dist)}
          fill="none"
          stroke={colors[i]}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        marginRight: 6,
        verticalAlign: 'baseline',
      }}
    />
  );
}

function MatchupAnalysisTab() {
  const [numPlayers, setNumPlayers] = useState(2);
  const [players, setPlayers] = useState<PlayerCfg[]>(DEFAULT_PLAYERS);
  const [board, setBoard] = useState('');
  const [myHand, setMyHand] = useState('');
  const [showBoardPick, setShowBoardPick] = useState(false);
  const [showHandPick, setShowHandPick] = useState(false);
  const [gridFor, setGridFor] = useState<number | null>(null);
  const [potStr, setPotStr] = useState('5.5');
  const [icmOn, setIcmOn] = useState(false);
  const [stacksStr, setStacksStr] = useState('5200, 4300, 2100, 1400');
  const [presetId, setPresetId] = useState('sng-9max');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const cfgs = useMemo(() => players.slice(0, numPlayers), [players, numPlayers]);

  // 차트 자동 소스 미리보기 (입력 카드에 표시).
  const chartPreviews = useMemo(
    () => cfgs.map((p, i) => (p.source === 'chart' ? chartLabelsFor(i, cfgs).note : null)),
    [cfgs],
  );

  // ICM(2인 전용): 스택·상금 구조에서 버블 팩터를 즉시 계산.
  const icmInfo = useMemo(() => {
    if (!icmOn || numPlayers !== 2) return null;
    const stacks = stacksStr
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((x) => Number.isFinite(x) && x > 0);
    if (stacks.length < 2) return null;
    try {
      const payouts = payoutsFor(stacks.length, presetId);
      const bf = bubbleFactor(stacks, payouts, 0, 1);
      const reqEq = Number.isFinite(bf) ? bf / (1 + bf) : 1;
      return { stacks, bf, reqEq };
    } catch {
      return null;
    }
  }, [icmOn, numPlayers, stacksStr, presetId]);

  function setPlayer(i: number, patch: Partial<PlayerCfg>) {
    setPlayers(players.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function run() {
    setError('');
    const b = board.replace(/\s+/g, '');
    const nb = b.length / 2;
    if (b && (!Number.isInteger(nb) || ![3, 4, 5].includes(nb))) {
      setError('보드는 0장(프리플랍) 또는 3·4·5장이어야 합니다.');
      return;
    }
    const h = myHand.replace(/\s+/g, '');
    if (h && h.length !== 4) {
      setError('내 핸드는 정확히 2장이어야 합니다 (예: AhKs).');
      return;
    }
    const potIn = Number(potStr);
    const potBB = Number.isFinite(potIn) && potIn > 0 ? potIn : 5.5;
    setBusy(true);
    setTimeout(() => {
      try {
        const activeCfgs = players.slice(0, numPlayers);
        const notes: string[] = [];
        const ranges: Combo[][] = activeCfgs.map((p, i) => {
          if (p.source === 'manual') {
            const combos = combosFrom(p.range);
            notes.push(`직접 입력 (${combos.length}콤보)`);
            return combos;
          }
          const { labels, note } = chartLabelsFor(i, activeCfgs);
          notes.push(note);
          return labels.flatMap((l) => labelToCombos(l));
        });

        // 총 계산량 조절: 멀티웨이는 라벨별 MC가 늘어나므로 집계 반복수를 낮춥니다.
        const iterations = numPlayers === 2 ? 15000 : 10000;
        const res = rangeMatchup({ ranges, board: b || undefined, iterations, seed: 1234 });

        let hero: HeroInfo | null = null;
        if (h) {
          const heroCards = parseCards(h);
          if (heroCards.length !== 2 || heroCards[0] === heroCards[1]) {
            throw new Error('내 핸드가 올바르지 않습니다 (서로 다른 2장, 예: AhKs).');
          }
          const bSet = new Set(b ? parseCards(b) : []);
          if (heroCards.some((c) => bSet.has(c))) {
            throw new Error('내 핸드가 보드 카드와 겹칩니다.');
          }
          const heroSet = new Set(heroCards);
          const oppRanges = ranges.slice(1).map((combos, j) => {
            const f = combos.filter((c) => !heroSet.has(c[0]) && !heroSet.has(c[1]));
            if (!f.length) throw new Error(`P${j + 2} 레인지의 모든 콤보가 내 핸드와 겹칩니다.`);
            return f;
          });
          const vsEach = oppRanges.map(
            (combos, j) =>
              calcEquity([{ cards: h }, { combos }], {
                board: b || undefined,
                iterations: 8000,
                seed: 555 + j,
              }).equities[0],
          );
          const multi =
            oppRanges.length === 1
              ? vsEach[0]
              : calcEquity([{ cards: h }, ...oppRanges.map((combos) => ({ combos }))], {
                  board: b || undefined,
                  iterations: 8000,
                  seed: 999,
                }).equities[0];
          const dist0 = res.distributions[0];
          const total = dist0.reduce((s, d) => s + d.weightCombos, 0) || 1;
          const above = dist0.reduce((s, d) => (d.equity > multi ? s + d.weightCombos : s), 0);
          const hi = cardRank(heroCards[0]);
          const lo = cardRank(heroCards[1]);
          const label = gridLabel(hi, lo, hi === lo ? null : cardSuit(heroCards[0]) === cardSuit(heroCards[1]));
          hero = {
            cards: h,
            label,
            vsEach,
            multi,
            topPct: (above / total) * 100,
            inRange: dist0.some((d) => d.label === label),
          };
        }

        // ---- 🎯 추천 액션 데이터 ----
        let reco: SolverReco | ChartReco | null = null;
        let recoError: string | null = null;
        if (numPlayers === 2 && nb >= 3) {
          // 2인 포스트플랍: 같은 파이프라인에서 솔버 실행 (플랍 8000 / 턴·리버 10000 반복).
          try {
            const oopIdx: 0 | 1 =
              POSTFLOP_ORDER[activeCfgs[0].pos] <= POSTFLOP_ORDER[activeCfgs[1].pos] ? 0 : 1;
            const sr = solvePostflop({
              board: b,
              oopRange: ranges[oopIdx],
              ipRange: ranges[1 - oopIdx],
              pot: potBB,
              betFraction: SOLVER_BET_FRACTION,
              iterations: nb === 3 ? 8000 : 10000,
              seed: 4242,
            });
            let heroOop: SolverReco['heroOop'] = null;
            if (hero && oopIdx === 0) {
              const hc = parseCards(h);
              const heroLabel = hero.label;
              const exact = sr.oopStrategy.find(
                (r) =>
                  (r.combo[0] === hc[0] && r.combo[1] === hc[1]) ||
                  (r.combo[0] === hc[1] && r.combo[1] === hc[0]),
              );
              if (exact) {
                heroOop = { bet: exact.bet, check: exact.check, exact: true };
              } else {
                const same = sr.oopStrategy.filter((r) => comboGridLabel(r.combo) === heroLabel);
                if (same.length) {
                  heroOop = {
                    bet: same.reduce((s, r) => s + r.bet, 0) / same.length,
                    check: same.reduce((s, r) => s + r.check, 0) / same.length,
                    exact: false,
                  };
                }
              }
            }
            reco = {
              kind: 'solver',
              street: sr.street,
              oopIdx,
              pot: potBB,
              oopBetFreq: sr.oopBetFreq,
              ipCallVsBetFreq: sr.ipCallVsBetFreq,
              oopEV: sr.oopEV,
              approximate: sr.approximate,
              heroOop,
            };
          } catch (e) {
            recoError = (e as Error).message;
          }
        } else if (numPlayers === 2 && nb === 0 && hero) {
          // 2인 프리플랍: 내 핸드 라벨을 차트에서 조회 (P1 RFI / P2 vs-RFI).
          const mixOf = (
            m: { fold: number; call: number; raise: number } | undefined,
            source: ChartSource,
          ): ChartMix => ({
            raise: m?.raise ?? 0,
            call: m?.call ?? 0,
            fold: m ? m.fold : 1,
            source,
          });
          const rfiChart = getChart({
            gameType: 'cash',
            stackBB: 100,
            heroPos: activeCfgs[0].pos,
            line: 'RFI',
          });
          let vsRfi: ChartMix | null = null;
          if (activeCfgs[1].pos !== activeCfgs[0].pos) {
            const defChart = getChart({
              gameType: 'cash',
              stackBB: 100,
              heroPos: activeCfgs[1].pos,
              villainPos: activeCfgs[0].pos,
              line: 'vs-RFI',
            });
            vsRfi = mixOf(defChart.hands.get(hero.label), defChart.source);
          }
          reco = {
            kind: 'chart',
            label: hero.label,
            rfi: mixOf(rfiChart.hands.get(hero.label), rfiChart.source),
            vsRfi,
          };
        }

        setResult({ res, names: namesOf(activeCfgs), notes, hero, board: b, reco, recoError });
      } catch (e) {
        setError((e as Error).message);
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 10);
  }

  // ---- 결과 파생값 ----
  const maxEq = result ? Math.max(...result.res.rangeEquities) : 0;
  const verdict = (() => {
    if (!result) return '';
    const { nutPct } = result.res;
    const order = nutPct.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const top = order[0];
    const second = order[1];
    const fmt = (x: number) => `${(x * 100).toFixed(1)}%`;
    if (top.v - second.v < 0.02) {
      return `넛 우위가 비슷합니다 (${fmt(top.v)} vs ${fmt(second.v)}) — 스몰 벳·체크 위주의 신중한 전략이 무난합니다.`;
    }
    return `${result.names[top.i]}이(가) 넛 우위 (${fmt(top.v)} vs ${fmt(second.v)}) — 폴라라이즈드 벳 유리.`;
  })();

  const icmCompare = (() => {
    if (!icmInfo || !result) return null;
    const eq = result.hero ? result.hero.multi : result.res.rangeEquities[0];
    const src = result.hero ? `내 핸드 ${result.hero.label}` : `내 레인지(${result.names[0]})`;
    const diff = eq - icmInfo.reqEq;
    const cls = diff >= 0.02 ? 'push' : diff <= -0.02 ? 'fold' : 'marginal';
    const text = diff >= 0.02 ? '콜 가능 (ICM 기준 충족)' : diff <= -0.02 ? '콜 부족 (ICM 기준 미달)' : '경계선';
    return { eq, src, cls, text };
  })();

  const bfInterp = (bf: number) =>
    !Number.isFinite(bf)
      ? '얻을 것이 없는 스팟 — 올인 회피'
      : bf < 1.05
        ? '칩EV와 거의 동일 — ICM 압박 미미'
        : bf < 1.2
          ? '가벼운 ICM 압박 — 마진 콜은 약간 손해'
          : bf < 1.5
            ? '상당한 버블 압박 — 마진 콜을 피하세요'
            : '강한 버블 압박 — 프리미엄 핸드만 콜';

  // ---- 🎯 추천 액션 파생값 ----
  const recoData = result ? result.reco : null;
  const solverReco = recoData && recoData.kind === 'solver' ? recoData : null;
  const chartReco = recoData && recoData.kind === 'chart' ? recoData : null;

  // 내 핸드(P1)가 OOP일 때: 핸드별 벳/체크 믹스 큰 pill.
  const heroOopPill = (() => {
    if (!solverReco || !solverReco.heroOop || !result?.hero) return null;
    const { bet, exact } = solverReco.heroOop;
    const b = Math.round(bet * 100);
    const lean = bet >= 0.6 ? '벳 권장' : bet <= 0.4 ? '체크 권장' : '믹스 권장';
    const cls = bet >= 0.6 ? 'push' : 'marginal';
    return {
      text: `내 핸드 ${result.hero.label} (OOP): 벳 ${b}% / 체크 ${100 - b}% — ${lean}`,
      cls,
      exact,
    };
  })();

  // 내 핸드(P1)가 IP일 때: 벳을 마주한 콜/폴드 가이드 (팟 오즈 임계값 비교).
  const ipHeroPill = (() => {
    if (!solverReco || solverReco.oopIdx !== 1 || !result?.hero) return null;
    const eq = result.hero.vsEach[0];
    const diff = eq - IP_CALL_REQ_EQ;
    const cls = diff >= 0.03 ? 'push' : diff <= -0.03 ? 'fold' : 'marginal';
    const lean = diff >= 0.03 ? '콜 성향' : diff <= -0.03 ? '폴드 성향' : '경계선 — 블러프 캐처';
    return {
      text: `내 핸드 ${result.hero.label} (IP) vs 벳: 에쿼티 ${(eq * 100).toFixed(1)}% vs 필요 ${(IP_CALL_REQ_EQ * 100).toFixed(1)}% — ${lean}`,
      cls,
      inRange: result.hero.inRange,
    };
  })();

  // 프리플랍 차트 추천 pill들.
  const chartPills = (() => {
    if (!chartReco || !result) return null;
    const r = chartReco.rfi;
    const rfiParts = [`레이즈 ${pct0(r.raise)}`];
    if (r.call > 0.005) rfiParts.push(`콜 ${pct0(r.call)}`);
    rfiParts.push(`폴드 ${pct0(r.fold)}`);
    const rfiLean = r.raise >= 0.6 ? '레이즈 권장' : r.raise <= 0.4 ? '폴드 권장' : '믹스 권장';
    const rfiCls = r.raise >= 0.6 ? 'push' : r.raise <= 0.4 ? 'fold' : 'marginal';
    let vs: { text: string; cls: string; source: ChartSource } | null = null;
    if (chartReco.vsRfi) {
      const v = chartReco.vsRfi;
      const dom =
        v.raise >= v.call && v.raise >= v.fold ? '3벳 권장' : v.call >= v.fold ? '콜 권장' : '폴드 권장';
      vs = {
        text: `P2(${result.names[1]}) vs RFI 시점: 3벳 ${pct0(v.raise)} / 콜 ${pct0(v.call)} / 폴드 ${pct0(v.fold)} — ${dom}`,
        cls: dom === '3벳 권장' ? 'push' : dom === '콜 권장' ? 'marginal' : 'fold',
        source: v.source,
      };
    }
    return {
      label: chartReco.label,
      rfiText: `P1(${result.names[0]}) RFI: ${rfiParts.join(' / ')} — ${rfiLean}`,
      rfiCls,
      rfiSource: r.source,
      vs,
    };
  })();

  // 솔버/차트를 못 쓰는 스팟(멀티웨이 · 내 핸드 없음 · 솔버 실패): 기존 결과 기반 휴리스틱.
  const heuristicReco = (() => {
    if (!result || result.reco) return null;
    const { nutPct, rangeEquities } = result.res;
    const ordered = (arr: number[]) => arr.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const nOrd = ordered(nutPct);
    const eOrd = ordered(rangeEquities);
    const fmt = (x: number) => `${(x * 100).toFixed(1)}%`;
    const reason = result.recoError
      ? `솔버 계산 실패 (${result.recoError}) — 휴리스틱으로 대체합니다.`
      : result.names.length > 2
        ? '멀티웨이(3인 이상)는 2인 솔버 적용 범위를 벗어나 휴리스틱으로 안내합니다.'
        : '프리플랍 차트 추천에는 내 핸드 입력이 필요해 휴리스틱으로 안내합니다.';
    const nutLine =
      nOrd[0].v - nOrd[1].v >= 0.02
        ? `${result.names[nOrd[0].i]} 넛 우위 (${fmt(nOrd[0].v)} vs ${fmt(nOrd[1].v)}) → 폴라라이즈드 베팅(큰 벳 + 블러프) 유리`
        : '넛 우위가 비슷 → 큰 벳 빈도를 줄이고 중간 사이즈 위주';
    const eqLine =
      eOrd[0].v - eOrd[1].v >= 0.03
        ? `${result.names[eOrd[0].i]} 레인지 에쿼티 우위 (${fmt(eOrd[0].v)}) → 고빈도 소액 벳 유리`
        : '레인지 에쿼티가 비슷 → 체크 비중 확대';
    let heroLine: { text: string; cls: string } | null = null;
    if (result.hero) {
      const req = icmInfo ? icmInfo.reqEq : 0.5;
      const diff = result.hero.multi - req;
      const cls = diff >= 0.02 ? 'push' : diff <= -0.02 ? 'fold' : 'marginal';
      const lean = diff >= 0.02 ? '콜 성향' : diff <= -0.02 ? '폴드 성향' : '경계선';
      heroLine = {
        text: `내 핸드 ${result.hero.label}: 에쿼티 ${fmt(result.hero.multi)} vs 필요 ${fmt(req)} (${icmInfo ? 'ICM 보정' : '칩EV 50%'}) — ${lean}`,
        cls,
      };
    }
    return { reason, nutLine, eqLine, heroLine };
  })();

  return (
    <div className="container">
      <h1>레인지 매치업 · 우위 분석</h1>
      <p className="subtitle">
        GTO Wizard식 레인지 어드밴티지 분석 — 포지션 차트(또는 직접 입력) 레인지끼리 붙여 레인지 에쿼티,
        에쿼티 분포 곡선, 넛 우위를 계산합니다. 2~4명 멀티웨이와 프리플랍(보드 0장)도 지원합니다.
      </p>

      <div className="card">
        <div style={{ maxWidth: 220 }}>
          <label>플레이어 수</label>
          <select value={numPlayers} onChange={(e) => setNumPlayers(Number(e.target.value))}>
            <option value={2}>2 (헤즈업)</option>
            <option value={3}>3 (멀티웨이)</option>
            <option value={4}>4 (멀티웨이)</option>
          </select>
        </div>

        {cfgs.map((p, i) => (
          <div
            key={i}
            style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}
          >
            <div className="row" style={{ alignItems: 'center' }}>
              <strong style={{ flex: '0 0 92px', color: PLAYER_COLORS[i] }}>
                <ColorDot color={PLAYER_COLORS[i]} />
                P{i + 1}
                {i === 0 ? ' (나)' : ''}
              </strong>
              <select
                value={p.pos}
                onChange={(e) => setPlayer(i, { pos: e.target.value as Position })}
                style={{ flex: '0 0 90px' }}
              >
                {POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
              <select
                value={p.source}
                onChange={(e) => setPlayer(i, { source: e.target.value as 'chart' | 'manual' })}
                style={{ flex: '0 0 130px' }}
              >
                <option value="chart">차트 자동</option>
                <option value="manual">직접 입력</option>
              </select>
              {p.source === 'manual' && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setGridFor(gridFor === i ? null : i)}
                  style={{ flex: '0 0 auto', padding: '4px 10px', fontSize: 12 }}
                >
                  {gridFor === i ? '그리드 닫기' : '그리드로 선택'}
                </button>
              )}
            </div>
            {p.source === 'chart' ? (
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                {i === 0 ? '오프너: ' : `디펜더 (vs P1 ${cfgs[0].pos}): `}
                {chartPreviews[i]} · 100bb 캐시 기준
              </p>
            ) : (
              <>
                <input
                  type="text"
                  value={p.range}
                  placeholder="예: 55+, A8s+, KQo — 또는 그리드로 선택"
                  onChange={(e) => setPlayer(i, { range: e.target.value })}
                  style={{ marginTop: 8 }}
                />
                {gridFor === i && (
                  <div style={{ marginTop: 8 }}>
                    <HandGridPicker value={p.range} onChange={(v) => setPlayer(i, { range: v })} />
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        <div className="row" style={{ marginTop: 14 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ margin: 0 }}>보드 (0·3·4·5장 — 0장 = 프리플랍)</label>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowBoardPick((v) => !v)}
                style={{ padding: '3px 10px', fontSize: 12 }}
              >
                {showBoardPick ? '선택 접기' : '카드로 선택'}
              </button>
            </div>
            <input
              type="text"
              value={board}
              placeholder="예: Ks7h2c — 비우면 프리플랍"
              onChange={(e) => setBoard(e.target.value)}
              style={{ marginTop: 6 }}
            />
            {showBoardPick && (
              <div style={{ marginTop: 8 }}>
                <BoardPicker value={board} onChange={setBoard} max={5} used={myHand} />
              </div>
            )}
            {board.trim() && (
              <div style={{ marginTop: 8 }}>
                <PlayingCards cards={board} />
              </div>
            )}
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ margin: 0 }}>내 핸드 (선택 · P1 소속)</label>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowHandPick((v) => !v)}
                style={{ padding: '3px 10px', fontSize: 12 }}
              >
                {showHandPick ? '선택 접기' : '카드로 선택'}
              </button>
            </div>
            <input
              type="text"
              value={myHand}
              placeholder="예: AhKs — 비우면 레인지 전체만 분석"
              onChange={(e) => setMyHand(e.target.value)}
              style={{ marginTop: 6 }}
            />
            {showHandPick && (
              <div style={{ marginTop: 8 }}>
                <BoardPicker value={myHand} onChange={setMyHand} max={2} used={board} />
              </div>
            )}
            {myHand.trim() && (
              <div style={{ marginTop: 8 }}>
                <PlayingCards cards={myHand} />
              </div>
            )}
          </div>
        </div>

        {numPlayers === 2 && (
          <div style={{ marginTop: 14, maxWidth: 240 }}>
            <label>팟 (bb) — 🎯 추천 액션 솔버용</label>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={potStr}
              onChange={(e) => setPotStr(e.target.value)}
            />
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              스트리트 시작 팟 — 싱글 레이즈드 팟 기본 5.5bb. 보드 3~5장일 때 2인 솔버에 사용됩니다.
            </p>
          </div>
        )}

        {numPlayers === 2 && (
          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={icmOn}
                onChange={(e) => setIcmOn(e.target.checked)}
                style={{ width: 'auto' }}
              />
              ICM 토글 — 토너먼트 버블 팩터로 필요 콜 에쿼티 보정 (헤즈업 올인 가정)
            </label>
            {icmOn && (
              <div className="row" style={{ marginTop: 8 }}>
                <div style={{ flex: 2 }}>
                  <label>스택 (쉼표 구분 · 앞 2명이 나/상대)</label>
                  <input type="text" value={stacksStr} onChange={(e) => setStacksStr(e.target.value)} />
                </div>
                <div>
                  <label>상금 프리셋</label>
                  <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                    {PAYOUT_PRESETS.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '0 0 auto', alignSelf: 'end' }}>
                  <span className="pill marginal">
                    버블 팩터{' '}
                    {icmInfo ? (Number.isFinite(icmInfo.bf) ? icmInfo.bf.toFixed(2) : '∞') : '—'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button onClick={run} disabled={busy}>
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
        <>
          <div className="split-2col">
            <div className="card">
              <h2>레인지 에쿼티{result.board ? '' : ' (프리플랍)'}</h2>
              {result.res.rangeEquities.map((eq, i) => {
                const isMax = eq === maxEq;
                return (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        fontSize: 14,
                        gap: 8,
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <ColorDot color={PLAYER_COLORS[i]} />
                        <strong>{result.names[i]}</strong>
                        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                          {result.notes[i]}
                        </span>
                      </span>
                      <strong
                        style={{
                          color: isMax ? 'var(--accent)' : undefined,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {(eq * 100).toFixed(1)}%
                      </strong>
                    </div>
                    <div className="bar">
                      <span
                        style={{
                          width: `${Math.max(1, eq * 100)}%`,
                          background: isMax ? 'var(--accent)' : 'var(--text-dim)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                몬테카를로 집계 에쿼티 (타이는 균등 분할, 합 ≈ 100%).
              </p>
            </div>

            <div className="card">
              <h2>넛 우위</h2>
              {result.names.map((name, i) => (
                <div className="stat" key={i}>
                  <span>
                    <ColorDot color={PLAYER_COLORS[i]} />
                    {name}
                  </span>
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className="pill push">
                      넛 {(NUT_EQUITY_THRESHOLD * 100).toFixed(0)}%+ · {(result.res.nutPct[i] * 100).toFixed(1)}%
                    </span>
                    <span className="pill marginal">
                      강함 {(STRONG_EQUITY_THRESHOLD * 100).toFixed(0)}%+ · {(result.res.strongPct[i] * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
              ))}
              <p style={{ marginTop: 12, fontSize: 14 }}>
                <strong>{verdict}</strong>
              </p>
              <p className="muted" style={{ fontSize: 12 }}>
                넛/강함 비율은 라벨(13x13) 단위 에쿼티의 콤보 가중 비중입니다.
              </p>
            </div>
          </div>

          <div className="card">
            <h2>에쿼티 분포 곡선</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              각 레인지를 강한 핸드부터 정렬해 percentile 위치의 에쿼티를 그립니다 — 위쪽 곡선이 레인지
              어드밴티지, 80% 점선 위 구간이 넛 우위 영역입니다.
            </p>
            <DistributionChart dists={result.res.distributions} colors={PLAYER_COLORS} />
            <div className="rp-legend">
              {result.names.map((name, i) => (
                <span key={i}>
                  <span className="rp-dot" style={{ background: PLAYER_COLORS[i] }} />
                  {name}
                </span>
              ))}
              <span style={{ fontSize: 11 }}>가로 점선 = 넛 기준 80%</span>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              근사 안내: 라벨당 대표 콤보 1개를 적은 반복수로 시뮬레이션한 라벨 단위 근사입니다 (브라우저
              친화적). 투톤/모노톤 보드에서는 같은 라벨 안의 수트 구성 차이가 뭉개질 수 있습니다.
            </p>
          </div>

          {result.hero && (
            <div className="card">
              <h2>내 핸드 · {result.hero.label}</h2>
              <div style={{ margin: '6px 0 10px' }}>
                <PlayingCards cards={result.hero.cards} />
              </div>
              {result.hero.vsEach.map((eq, j) => (
                <div className="stat" key={j}>
                  <span>
                    vs {result.names[j + 1]} 레인지 <span className="muted">(헤즈업)</span>
                  </span>
                  <span className="val">{(eq * 100).toFixed(1)}%</span>
                </div>
              ))}
              {result.hero.vsEach.length > 1 && (
                <div className="stat">
                  <span>멀티웨이 (상대 전원 동시)</span>
                  <span className="val">{(result.hero.multi * 100).toFixed(1)}%</span>
                </div>
              )}
              <div className="stat">
                <span>내 레인지({result.names[0]}) 내 위치</span>
                <span className="val" style={{ color: 'var(--accent)' }}>
                  상위 {Math.max(1, Math.round(result.hero.topPct))}%
                </span>
              </div>
              {!result.hero.inRange && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  이 핸드는 P1 레인지에 포함되어 있지 않습니다 — 위치는 참고용입니다.
                </p>
              )}
            </div>
          )}

          {icmInfo && numPlayers === 2 && (
            <div className="card">
              <h2>ICM · 버블 팩터</h2>
              <div className="stat">
                <span>버블 팩터 (나 vs 상대)</span>
                <span className="val">{Number.isFinite(icmInfo.bf) ? icmInfo.bf.toFixed(2) : '∞'}</span>
              </div>
              <div className="stat">
                <span>필요 콜 에쿼티 ≈ BF/(1+BF)</span>
                <span className="val">
                  {(icmInfo.reqEq * 100).toFixed(1)}%{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>(칩EV 기준 50%)</span>
                </span>
              </div>
              {icmCompare && (
                <>
                  <div className="stat">
                    <span>비교 에쿼티 — {icmCompare.src}</span>
                    <span className="val">{(icmCompare.eq * 100).toFixed(1)}%</span>
                  </div>
                  <p style={{ marginTop: 10 }}>
                    <span className={`pill ${icmCompare.cls}`}>{icmCompare.text}</span>
                  </p>
                </>
              )}
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {bfInterp(icmInfo.bf)}. 단순화 모델: 이펙티브 스택 순수 올인 콜 기준 — 블라인드·팟
                데드머니·포지션·미래 핸드는 무시합니다. 정밀 판단은 ICM 계산기·푸시/폴드 페이지를 함께
                참고하세요.
              </p>
            </div>
          )}

          <div className="card">
            <h2>🎯 추천 액션</h2>

            {solverReco && (
              <>
                <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  2인 포스트플랍 솔버 · {STREET_KO[solverReco.street]} · 팟 {solverReco.pot}bb · 벳 사이즈{' '}
                  {Math.round(SOLVER_BET_FRACTION * 100)}% 팟 — <strong>OOP = {result.names[solverReco.oopIdx]}</strong>{' '}
                  (포스트플랍 선 액션), IP = {result.names[1 - solverReco.oopIdx]}
                </p>
                <div className="stat">
                  <span>OOP({result.names[solverReco.oopIdx]}) 레인지 전체 전략</span>
                  <span className="val">
                    벳 {Math.round(solverReco.oopBetFreq * 100)}% / 체크{' '}
                    {100 - Math.round(solverReco.oopBetFreq * 100)}%
                  </span>
                </div>
                <div className="stat">
                  <span>IP({result.names[1 - solverReco.oopIdx]}) — OOP 벳에 대한 콜 빈도</span>
                  <span className="val">콜 {pct0(solverReco.ipCallVsBetFreq)}</span>
                </div>
                <div className="stat">
                  <span>OOP 평균 EV</span>
                  <span className="val">{solverReco.oopEV.toFixed(2)}bb</span>
                </div>

                {heroOopPill && (
                  <p style={{ marginTop: 14 }}>
                    <span className={`pill ${heroOopPill.cls}`} style={BIG_PILL}>
                      {heroOopPill.text}
                    </span>
                    {!heroOopPill.exact && (
                      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                        같은 라벨 콤보 평균
                      </span>
                    )}
                  </p>
                )}
                {result.hero && solverReco.oopIdx === 0 && !heroOopPill && (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                    내 핸드({result.hero.label})가 OOP({result.names[0]}) 레인지에 없어 핸드별 추천을
                    생략합니다.
                  </p>
                )}
                {ipHeroPill && (
                  <>
                    <p style={{ marginTop: 14 }}>
                      <span className={`pill ${ipHeroPill.cls}`} style={BIG_PILL}>
                        {ipHeroPill.text}
                      </span>
                    </p>
                    <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      필요 에쿼티는 {Math.round(SOLVER_BET_FRACTION * 100)}% 팟 벳의 팟 오즈 기준이고, 내
                      에쿼티는 상대 전체 레인지 대비입니다 — 상대의 벳 레인지는 이보다 강할 수 있으니
                      경계선이면 보수적으로 판단하세요.
                      {!ipHeroPill.inRange && ' 이 핸드는 P1 레인지 밖이라 참고용입니다.'}
                    </p>
                  </>
                )}
                {!result.hero && (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                    내 핸드를 입력하면 핸드별 벳/체크(또는 콜/폴드) 추천을 함께 제공합니다.
                  </p>
                )}
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  {solverReco.approximate &&
                    '근사 안내: 플랍/턴 솔브는 미래 카드를 샘플링하는 근사치입니다 (반복수 제한 · 시드 의존). '}
                  단순화 모델: 스트리트당 단일 벳 사이즈({Math.round(SOLVER_BET_FRACTION * 100)}% 팟) ·
                  레이즈/올인 미포함.
                </p>
              </>
            )}

            {chartPills && (
              <>
                <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  프리플랍 차트 기준 (100bb 캐시) — 내 핸드 {chartPills.label}
                </p>
                <p style={{ marginTop: 12 }}>
                  <span className={`pill ${chartPills.rfiCls}`} style={BIG_PILL}>
                    {chartPills.rfiText}
                  </span>
                  {chartPills.rfiSource === 'heuristic' && (
                    <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                      차트 없음 → 근사
                    </span>
                  )}
                </p>
                {chartPills.vs && (
                  <p style={{ marginTop: 10 }}>
                    <span className={`pill ${chartPills.vs.cls}`} style={BIG_PILL}>
                      {chartPills.vs.text}
                    </span>
                    {chartPills.vs.source === 'heuristic' && (
                      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                        차트 없음 → 근사
                      </span>
                    )}
                  </p>
                )}
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  내 핸드는 P1 소속이므로 P1 RFI 믹스가 1차 추천이며, P2 줄은 같은 핸드를 디펜더 시점에서 본
                  참고값입니다.
                </p>
              </>
            )}

            {heuristicReco && (
              <>
                <p style={{ marginTop: 0 }}>
                  <span className="pill marginal">휴리스틱 — 솔버 미사용</span>
                </p>
                <p className="muted" style={{ fontSize: 13 }}>
                  {heuristicReco.reason}
                </p>
                <div className="stat">
                  <span className="muted">벳 구조</span>
                  <span style={{ fontSize: 13, textAlign: 'right', maxWidth: '70%' }}>
                    {heuristicReco.nutLine}
                  </span>
                </div>
                <div className="stat">
                  <span className="muted">벳 빈도</span>
                  <span style={{ fontSize: 13, textAlign: 'right', maxWidth: '70%' }}>
                    {heuristicReco.eqLine}
                  </span>
                </div>
                {heuristicReco.heroLine ? (
                  <p style={{ marginTop: 14 }}>
                    <span className={`pill ${heuristicReco.heroLine.cls}`} style={BIG_PILL}>
                      {heuristicReco.heroLine.text}
                    </span>
                  </p>
                ) : (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                    내 핸드를 입력하면 콜/폴드 기준을 함께 제공합니다.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- 에쿼티 계산기 (구 /equity 페이지 통합) ----------

const EQ_MIN_PLAYERS = 2;
const EQ_MAX_PLAYERS = 6;
const EQ_DEFAULT_PLAYERS = ['AsKs', 'QQ-99, AQs+'];

/** Card-string of an input, but only when it's exact cards (not a range). */
function exactCardsOf(input: string): string {
  const t = input.replace(/[\s,]/g, '');
  return /^([2-9TJQKA][cdhs])+$/i.test(t) ? t : '';
}

/** True when the input is exactly two specific cards like "AsKh". */
function isExactHand(input: string): boolean {
  return /^([2-9TJQKA][cdhs]){2}$/i.test(input.trim());
}

interface EqResultRow {
  label: string;
  hand: string;
  exact: boolean;
}

interface EqResult {
  rows: EqResultRow[];
  equities: number[];
  wins: number[];
  ties: number[];
  iterations: number;
  board: string;
}

function EquityCalculatorTab() {
  const [players, setPlayers] = useState<string[]>(EQ_DEFAULT_PLAYERS);
  const [board, setBoard] = useState('');
  // Which picker is open: a player index, 'board', or none. Only one at once.
  const [openPicker, setOpenPicker] = useState<number | 'board' | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EqResult | null>(null);
  const [error, setError] = useState('');

  function setPlayer(i: number, v: string) {
    setPlayers((ps) => ps.map((p, j) => (j === i ? v : p)));
  }

  function addPlayer() {
    if (players.length >= EQ_MAX_PLAYERS) return;
    setPlayers((ps) => [...ps, '']);
    setOpenPicker(null);
  }

  function removePlayer(i: number) {
    if (players.length <= EQ_MIN_PLAYERS) return;
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
        입력하세요. 최대 {EQ_MAX_PLAYERS}명까지 지원합니다. (레인지 입력은 계산이 다소 느릴 수 있습니다)
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
              {players.length > EQ_MIN_PLAYERS && (
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

        {players.length < EQ_MAX_PLAYERS && (
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

// ---------- 페이지: 상단 탭 (매치업 분석 / 에쿼티 계산기) ----------

type TopTab = 'matchup' | 'equity';

const TOP_TABS: [TopTab, string][] = [
  ['matchup', '매치업 분석'],
  ['equity', '에쿼티 계산기'],
];

export default function MatchupPage() {
  // null = 아직 탭 미결정 (mount 후 URL을 읽고 결정 — SSR 안전).
  const [tab, setTab] = useState<TopTab | null>(null);

  // 구 /equity 리다이렉트용 딥링크: /matchup?tab=equity (useSearchParams 대신 직접 읽음).
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('tab');
    setTab(want === 'equity' ? 'equity' : 'matchup');
  }, []);

  function switchTab(t: TopTab) {
    setTab(t);
    try {
      window.history.replaceState(null, '', t === 'equity' ? '/matchup?tab=equity' : '/matchup');
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div className="container" style={{ paddingBottom: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TOP_TABS.map(([t, lbl]) => (
            <button key={t} className={tab === t ? '' : 'secondary'} onClick={() => switchTab(t)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      {tab === 'matchup' && <MatchupAnalysisTab />}
      {tab === 'equity' && <EquityCalculatorTab />}
    </>
  );
}
