'use client';

import { useMemo, useState } from 'react';
import {
  rangeMatchup,
  calcEquity,
  parseRange,
  rangeToCombos,
  labelToCombos,
  parseCards,
  getChart,
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

export default function MatchupPage() {
  const [numPlayers, setNumPlayers] = useState(2);
  const [players, setPlayers] = useState<PlayerCfg[]>(DEFAULT_PLAYERS);
  const [board, setBoard] = useState('');
  const [myHand, setMyHand] = useState('');
  const [showBoardPick, setShowBoardPick] = useState(false);
  const [showHandPick, setShowHandPick] = useState(false);
  const [gridFor, setGridFor] = useState<number | null>(null);
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

        setResult({ res, names: namesOf(activeCfgs), notes, hero, board: b });
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
        </>
      )}
    </div>
  );
}
