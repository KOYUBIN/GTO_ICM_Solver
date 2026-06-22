'use client';

import { useState } from 'react';
import { solveRiver, parseRange, rangeToCombos, gridLabel, cardRank, cardSuit, type Combo } from '@gto/engine';
import { ActionGrid } from '@/components/ActionGrid';
import { PlayingCards } from '@/components/Cards';

const ACTION_COLORS = [
  { action: 'bet', color: '#f85149', label: '베팅' },
  { action: 'check', color: '#3fb950', label: '체크' },
];

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

export default function SolverPage() {
  const [board, setBoard] = useState('KsQd7h2c3s');
  const [oopRange, setOopRange] = useState('77, 65s, KdQc');
  const [ipRange, setIpRange] = useState('AhAd, KdJd, JhJc');
  const [pot, setPot] = useState(100);
  const [betFraction, setBetFraction] = useState(0.75);
  const [iterations, setIterations] = useState(15000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    grid: Map<string, Record<string, number>>;
    betFreq: number;
    callFreq: number;
    ev: number;
    iters: number;
  } | null>(null);

  function combosFrom(input: string): Combo[] {
    const out: Combo[] = [];
    for (const tok of input.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/^([2-9TJQKA][cdhs]){2}$/i.test(tok)) {
        // exact combo
        const cards = tok.match(/.{2}/g)!;
        const c = cards.map((s) => {
          const r = '23456789TJQKA'.indexOf(s[0].toUpperCase());
          const su = 'cdhs'.indexOf(s[1].toLowerCase());
          return su * 13 + r;
        }) as Combo;
        out.push(c);
      } else {
        for (const x of rangeToCombos(parseRange(tok))) out.push(x.combo);
      }
    }
    return out;
  }

  function run() {
    setError('');
    setBusy(true);
    setTimeout(() => {
      try {
        const res = solveRiver({
          board: board.trim(),
          oopRange: combosFrom(oopRange),
          ipRange: combosFrom(ipRange),
          pot,
          betFraction,
          iterations,
          seed: 1234,
        });
        setResult({
          grid: aggregate(res.oopStrategy),
          betFreq: res.oopBetFreq,
          callFreq: res.ipCallVsBetFreq,
          ev: res.oopEV,
          iters: res.iterations,
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
      <h1>포스트플랍 솔버 (리버 MCCFR)</h1>
      <p className="subtitle">
        몬테카를로 CFR로 리버 스팟을 풉니다. OOP의 체크/베팅 전략, IP 콜 빈도, OOP EV를 계산합니다.
        (단일 베팅 사이즈 트리)
      </p>

      <div className="card">
        <label>보드 (정확히 5장)</label>
        <input type="text" value={board} onChange={(e) => setBoard(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <PlayingCards cards={board} />
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <div>
            <label>OOP 레인지</label>
            <input type="text" value={oopRange} onChange={(e) => setOopRange(e.target.value)} />
          </div>
          <div>
            <label>IP 레인지</label>
            <input type="text" value={ipRange} onChange={(e) => setIpRange(e.target.value)} />
          </div>
        </div>
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
              max={60000}
              step={1000}
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
              style={{ padding: 0 }}
            />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={run} disabled={busy}>
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
            <h2>요약 ({result.iters.toLocaleString()} 반복)</h2>
            <div className="stat">
              <span>OOP 베팅 빈도</span>
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
          </div>
          <div className="card">
            <h2>OOP 전략 (핸드별 체크/베팅)</h2>
            <ActionGrid data={result.grid} colors={ACTION_COLORS} />
          </div>
        </>
      )}
    </div>
  );
}
