'use client';

import { useMemo, useState } from 'react';
import { icm, riskPremium } from '@gto/engine';

export default function IcmPage() {
  const [stacksStr, setStacksStr] = useState('5000, 3000, 1500, 500');
  const [payoutsStr, setPayoutsStr] = useState('50, 30, 20');

  const stacks = useMemo(
    () => stacksStr.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)),
    [stacksStr],
  );
  const payouts = useMemo(
    () => payoutsStr.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)),
    [payoutsStr],
  );

  const result = useMemo(() => {
    if (stacks.length < 2 || payouts.length < 1) return null;
    return icm(stacks, payouts);
  }, [stacks, payouts]);

  // Bubble risk premium for player 0 shoving into player 1 for their stack.
  const rp = useMemo(() => {
    if (stacks.length < 2) return null;
    const amount = Math.min(stacks[0], stacks[1]);
    return riskPremium(stacks, payouts, 0, 1, amount);
  }, [stacks, payouts]);

  const totalPrize = payouts.reduce((a, b) => a + b, 0);

  return (
    <div className="container">
      <h1>ICM 계산기</h1>
      <p className="subtitle">
        Malmuth-Harville 모델로 칩 스택을 상금 기대값으로 환산하고, 버블 리스크 프리미엄을 계산합니다.
      </p>

      <div className="card">
        <div className="row">
          <div>
            <label>스택 (쉼표 구분)</label>
            <input type="text" value={stacksStr} onChange={(e) => setStacksStr(e.target.value)} />
          </div>
          <div>
            <label>상금 구조 (쉼표 구분)</label>
            <input type="text" value={payoutsStr} onChange={(e) => setPayoutsStr(e.target.value)} />
          </div>
        </div>
      </div>

      {result && (
        <div className="card">
          <h2>플레이어별 ICM 기대값</h2>
          {result.equities.map((eq, i) => {
            const pct = totalPrize ? (eq / totalPrize) * 100 : 0;
            return (
              <div key={i} style={{ marginBottom: 12 }}>
                <div className="stat" style={{ border: 'none', paddingBottom: 4 }}>
                  <span>
                    P{i + 1} · {stacks[i].toLocaleString()} 칩
                  </span>
                  <span className="val">
                    {eq.toFixed(2)} <span className="muted">({pct.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="bar">
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rp !== null && (
        <div className="card">
          <h2>버블 리스크 프리미엄</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            P1이 P2에게 올인할 때, 칩EV 기준 50% 브레이크이븐 대비 추가로 필요한 에쿼티입니다.
          </p>
          <div className="stat">
            <span>리스크 프리미엄</span>
            <span className="val" style={{ color: rp > 0 ? 'var(--warn)' : 'var(--accent)' }}>
              {(rp * 100).toFixed(2)}%p
            </span>
          </div>
          <div className="stat">
            <span>필요 콜 에쿼티</span>
            <span className="val">{((0.5 + rp) * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
