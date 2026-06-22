'use client';

import { useMemo, useState } from 'react';
import { pushFoldAdvice, topPercentRange, allGridLabels } from '@gto/engine';
import { RangeGrid } from '@/components/RangeGrid';

export default function PushFoldPage() {
  const [hand, setHand] = useState('AJs');
  const [stackBB, setStackBB] = useState(10);
  const [playersBehind, setPlayersBehind] = useState(3);

  const advice = useMemo(() => {
    const labels = new Set(allGridLabels());
    if (!labels.has(hand)) return null;
    return pushFoldAdvice(hand, stackBB, playersBehind);
  }, [hand, stackBB, playersBehind]);

  const shoveRange = useMemo(
    () => (advice ? topPercentRange(advice.thresholdPercent) : new Map<string, number>()),
    [advice],
  );

  return (
    <div className="container">
      <h1>푸시/폴드 솔버</h1>
      <p className="subtitle">
        숏스택 올인 차트 근사. 스택 깊이와 뒤에 남은 플레이어 수로 셔브 레인지를 좁힙니다. (Nash 정확
        해가 아닌 실용적 근사)
      </p>

      <div className="card">
        <div className="row">
          <div>
            <label>핸드 (예: AJs, 99, KTo)</label>
            <input type="text" value={hand} onChange={(e) => setHand(e.target.value.trim())} />
          </div>
          <div>
            <label>유효 스택 (BB): {stackBB}</label>
            <input
              type="range"
              min={1}
              max={25}
              value={stackBB}
              onChange={(e) => setStackBB(Number(e.target.value))}
              style={{ padding: 0 }}
            />
          </div>
          <div>
            <label>뒤에 남은 플레이어: {playersBehind}</label>
            <input
              type="range"
              min={1}
              max={8}
              value={playersBehind}
              onChange={(e) => setPlayersBehind(Number(e.target.value))}
              style={{ padding: 0 }}
            />
          </div>
        </div>
      </div>

      {advice ? (
        <>
          <div className="card">
            <div className="stat">
              <span>권장 액션</span>
              <span className="val">
                <span className={`pill ${advice.action}`}>
                  {advice.action === 'push' ? '셔브' : advice.action === 'fold' ? '폴드' : '마지널'}
                </span>
              </span>
            </div>
            <div className="stat">
              <span>셔브 임계값 (상위 %)</span>
              <span className="val">{advice.thresholdPercent.toFixed(1)}%</span>
            </div>
            <div className="stat">
              <span>핸드 강도 (Chen)</span>
              <span className="val">{advice.handScore}</span>
            </div>
            <div className="stat">
              <span>임계 강도</span>
              <span className="val">{advice.thresholdScore}</span>
            </div>
          </div>
          <div className="card">
            <h2>셔브 레인지 (상위 {advice.thresholdPercent.toFixed(0)}%)</h2>
            <RangeGrid range={shoveRange} />
          </div>
        </>
      ) : (
        <div className="card">
          <p className="muted">유효한 핸드 표기를 입력하세요 (예: AKs, TT, QJo).</p>
        </div>
      )}
    </div>
  );
}
