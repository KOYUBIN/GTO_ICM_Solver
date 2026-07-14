'use client';

import { useState } from 'react';
import { solvePostflop, parseRange, rangeToCombos, gridLabel, cardRank, cardSuit, parseCards, type Combo } from '@gto/engine';
import { ActionGrid } from '@/components/ActionGrid';
import { PlayingCards } from '@/components/Cards';
import { BoardPicker, HandGridPicker } from '@/components/Pickers';

const ACTION_COLORS = [
  { action: 'bet', color: '#f85149', label: '베팅' },
  { action: 'check', color: '#3fb950', label: '체크' },
];

const STREET_KO: Record<string, string> = { flop: '플랍', turn: '턴', river: '리버' };

/** Aggregate per-combo bet/check into the 13x13 label grid (combo-averaged). */
function aggregate(rows: { combo: Combo; bet: number; check: number }[]) {
  const acc = new Map<string, { bet: number; check: number; n: number }>();
  for (const r of rows) {
    const hi = cardRank(r.combo[0]);
    const lo = cardRank(r.combo[1]);
    const suited = cardSuit(r.combo[0]) === cardSuit(r.combo[1]);
    const label = gridLabel(hi, lo, hi === lo ? null : suited);
    const cur = acc.get(label) ?? { bet: 0, check: 0, n: 0 };
    cur.bet += r.bet;
    cur.check += r.check;
    cur.n += 1;
    acc.set(label, cur);
  }
  const out = new Map<string, Record<string, number>>();
  for (const [label, v] of acc) out.set(label, { bet: v.bet / v.n, check: v.check / v.n });
  return out;
}

function boardStreet(n: number): 'flop' | 'turn' | 'river' | null {
  if (n === 3) return 'flop';
  if (n === 4) return 'turn';
  if (n === 5) return 'river';
  return null;
}

export default function SolverPage() {
  const [board, setBoard] = useState('Ks7h2c');
  const [oopRange, setOopRange] = useState('77, 99, KdQc, 65s');
  const [ipRange, setIpRange] = useState('AhAd, KdJd, JhJc, AsKs');
  const [pot, setPot] = useState(60);
  const [betFraction, setBetFraction] = useState(0.66);
  const [iterations, setIterations] = useState(12000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showBoardPick, setShowBoardPick] = useState(true);
  const [gridFor, setGridFor] = useState<null | 'oop' | 'ip'>(null);
  const [result, setResult] = useState<{
    street: 'flop' | 'turn' | 'river';
    grid: Map<string, Record<string, number>>;
    betFreq: number;
    callFreq: number;
    ev: number;
    iters: number;
    approximate: boolean;
  } | null>(null);

  function combosFrom(input: string): Combo[] {
    const out: Combo[] = [];
    for (const tok of input.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/^([2-9TJQKA][cdhs]){2}$/i.test(tok)) {
        // exact combo (e.g. AhKh)
        out.push(parseCards(tok) as Combo);
      } else {
        for (const x of rangeToCombos(parseRange(tok))) out.push(x.combo);
      }
    }
    return out;
  }

  const cleanBoard = board.replace(/\s+/g, '');
  const nCards = cleanBoard.length / 2;
  const street = Number.isInteger(nCards) ? boardStreet(nCards) : null;

  function run() {
    setError('');
    if (!street) {
      setError('보드는 3장(플랍)·4장(턴)·5장(리버)이어야 합니다.');
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        const res = solvePostflop({
          board: cleanBoard,
          oopRange: combosFrom(oopRange),
          ipRange: combosFrom(ipRange),
          pot,
          betFraction,
          iterations,
          seed: 1234,
        });
        setResult({
          street: res.street,
          grid: aggregate(res.oopStrategy),
          betFreq: res.oopBetFreq,
          callFreq: res.ipCallVsBetFreq,
          ev: res.oopEV,
          iters: res.iterations,
          approximate: res.approximate,
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
      <h1>포스트플랍 솔버 (MCCFR · 플랍/턴/리버)</h1>
      <p className="subtitle">
        몬테카를로 CFR로 플랍·턴·리버 스팟을 풉니다. 플랍·턴은 이후 카드를 챈스 샘플링으로 런아웃하여
        멀티 스트리트로 계산하고, OOP의 체크/베팅 전략, IP 콜 빈도, OOP EV를 보여줍니다.
        프리플랍 GTO 레인지는 <a href="/charts">차트</a>에서 확인하세요.
      </p>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ margin: 0 }}>보드 (3·4·5장)</label>
          <button className="secondary" onClick={() => setShowBoardPick((v) => !v)} style={{ padding: '3px 10px', fontSize: 12 }}>
            {showBoardPick ? '카드 선택 접기' : '카드로 선택'}
          </button>
        </div>
        <input type="text" value={board} placeholder="예: Ks7h2c — 또는 아래에서 탭" onChange={(e) => setBoard(e.target.value)} style={{ marginTop: 6 }} />
        {showBoardPick && (
          <div style={{ marginTop: 10 }}>
            <BoardPicker value={board} onChange={setBoard} max={5} />
          </div>
        )}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          {cleanBoard.length >= 2 && <PlayingCards cards={cleanBoard} />}
          {street ? (
            <span className="pill">{STREET_KO[street]} 솔브</span>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>3·4·5장을 선택하세요</span>
          )}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ margin: 0 }}>OOP 레인지</label>
              <button className="secondary" onClick={() => setGridFor(gridFor === 'oop' ? null : 'oop')} style={{ padding: '3px 10px', fontSize: 12 }}>
                {gridFor === 'oop' ? '그리드 닫기' : '그리드로 선택'}
              </button>
            </div>
            <input type="text" value={oopRange} onChange={(e) => setOopRange(e.target.value)} style={{ marginTop: 6 }} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ margin: 0 }}>IP 레인지</label>
              <button className="secondary" onClick={() => setGridFor(gridFor === 'ip' ? null : 'ip')} style={{ padding: '3px 10px', fontSize: 12 }}>
                {gridFor === 'ip' ? '그리드 닫기' : '그리드로 선택'}
              </button>
            </div>
            <input type="text" value={ipRange} onChange={(e) => setIpRange(e.target.value)} style={{ marginTop: 6 }} />
          </div>
        </div>
        {gridFor && (
          <div style={{ marginTop: 12 }}>
            <label>{gridFor === 'oop' ? 'OOP' : 'IP'} 레인지 그리드 선택</label>
            <HandGridPicker
              value={gridFor === 'oop' ? oopRange : ipRange}
              onChange={(v) => (gridFor === 'oop' ? setOopRange(v) : setIpRange(v))}
            />
          </div>
        )}
        <div className="row" style={{ marginTop: 14 }}>
          <div>
            <label>팟 (칩)</label>
            <input type="number" value={pot} onChange={(e) => setPot(Number(e.target.value) || 100)} />
          </div>
          <div>
            <label>베팅 사이즈 (팟 대비): {Math.round(betFraction * 100)}%</label>
            <input
              type="range"
              min={0.25}
              max={1.5}
              step={0.05}
              value={betFraction}
              onChange={(e) => setBetFraction(Number(e.target.value))}
              style={{ padding: 0 }}
            />
          </div>
          <div>
            <label>반복수: {iterations.toLocaleString()}</label>
            <input
              type="range"
              min={2000}
              max={40000}
              step={1000}
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
              style={{ padding: 0 }}
            />
          </div>
        </div>
        {street && street !== 'river' && (
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            ⚠️ {STREET_KO[street]} 솔브는 이후 스트리트를 런아웃하므로 리버보다 느리고 근사적입니다.
            정밀도를 높이려면 반복수를 올리세요.
          </p>
        )}
        <div style={{ marginTop: 16 }}>
          <button onClick={run} disabled={busy || !street}>
            {busy ? '솔빙 중…' : '솔브'}
          </button>
        </div>
        {error && (
          <p className="muted" style={{ color: 'var(--danger)', marginTop: 12 }}>
            {error}
          </p>
        )}
      </div>

      {result && (
        <>
          <div className="card">
            <h2>
              요약 · {STREET_KO[result.street]} ({result.iters.toLocaleString()} 반복)
            </h2>
            <div className="stat">
              <span>OOP 베팅 빈도 ({STREET_KO[result.street]} 첫 액션)</span>
              <span className="val">{(result.betFreq * 100).toFixed(1)}%</span>
            </div>
            <div className="stat">
              <span>IP 콜 빈도 (vs 베팅)</span>
              <span className="val">{(result.callFreq * 100).toFixed(1)}%</span>
            </div>
            <div className="stat">
              <span>OOP 기대값</span>
              <span className="val">{result.ev.toFixed(2)} 칩</span>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              참고: 균형에서 IP 콜 빈도는 MDF(= 1 − 베팅/(팟+베팅))에 근접합니다.
            </p>
            {result.approximate && (
              <p className="muted" style={{ marginTop: 6, fontSize: 13, color: 'var(--warn)' }}>
                ⚠️ {STREET_KO[result.street]} 솔브는 이후 스트리트를 챈스 샘플링으로 근사합니다 — 전략·EV는
                근사값이며 시드에 따라 약간 달라집니다. 정밀도를 높이려면 반복수를 올리세요.
              </p>
            )}
          </div>
          <div className="card">
            <h2>OOP 전략 ({STREET_KO[result.street]} 핸드별 체크/베팅)</h2>
            <ActionGrid data={result.grid} colors={ACTION_COLORS} />
          </div>
        </>
      )}
    </div>
  );
}
