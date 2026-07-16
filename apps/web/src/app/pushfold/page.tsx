'use client';

import { useEffect, useMemo, useState } from 'react';
import { pushFoldAdvice, topPercentRange, allGridLabels, getPreset } from '@gto/engine';
import { RangeGrid } from '@/components/RangeGrid';

const MONSTER = getPreset('monster');

/** Round to the nearest whole big blind, floored at 1. */
function effBB(stackChips: number, bigBlind: number): number {
  if (bigBlind <= 0) return 0;
  return Math.max(1, Math.round(stackChips / bigBlind));
}

/** Harrington M: orbits you can survive. BB-ante ≈ one ante per hand. */
function mRatio(stackChips: number, sb: number, bb: number, ante: number): number {
  const cost = sb + bb + ante;
  return cost > 0 ? stackChips / cost : 0;
}

export default function PushFoldPage() {
  const [hand, setHand] = useState('AJs');
  const [stackBB, setStackBB] = useState(10);
  const [playersBehind, setPlayersBehind] = useState(3);

  // ---- 몬스터 게임 실전 모드 ----
  const [monsterMode, setMonsterMode] = useState(false);
  const [levelIdx, setLevelIdx] = useState(9); // 기본 L10 (레지 마감 레벨)
  const [chipsStr, setChipsStr] = useState('2500000');

  // 몬스터 허브에서 넘어온 링크(?monster=1&level=&chips=)로 실전 모드 프리필.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('monster') !== '1') return;
    setMonsterMode(true);
    const lv = Number(q.get('level'));
    if (Number.isFinite(lv) && lv >= 0 && lv < MONSTER.levels.length) setLevelIdx(lv);
    const chips = q.get('chips');
    if (chips != null && Number(chips) > 0) setChipsStr(String(Math.floor(Number(chips))));
  }, []);

  const lvl = MONSTER.levels[Math.min(levelIdx, MONSTER.levels.length - 1)];
  const chips = Math.max(0, Math.floor(Number(chipsStr) || 0));
  const monsterBB = effBB(chips, lvl.bigBlind);
  const monsterM = mRatio(chips, lvl.smallBlind, lvl.bigBlind, lvl.ante);
  // 실전 모드가 켜지면 유효 BB(최대 25)로 셔브 차트를 계산합니다.
  const activeStackBB = monsterMode ? Math.min(25, monsterBB) : stackBB;
  const tooDeep = monsterMode && monsterBB > 25;

  const advice = useMemo(() => {
    const labels = new Set(allGridLabels());
    if (!labels.has(hand)) return null;
    return pushFoldAdvice(hand, activeStackBB, playersBehind);
  }, [hand, activeStackBB, playersBehind]);

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

      {/* 몬스터 게임 실전 모드 */}
      <div className="card" style={{ border: monsterMode ? '2px solid var(--warn)' : undefined }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={monsterMode}
            onChange={(e) => setMonsterMode(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ fontWeight: 700 }}>🎰 몬스터 게임 (파이널 나인) 실전 모드</span>
        </label>
        {monsterMode && (
          <>
            <p className="muted" style={{ marginTop: 8 }}>
              현재 레벨과 내 칩을 넣으면 유효 스택(BB)·M을 계산해 셔브 차트에 바로 반영합니다.
            </p>
            <div className="row">
              <div>
                <label>현재 레벨</label>
                <select value={levelIdx} onChange={(e) => setLevelIdx(Number(e.target.value))}>
                  {MONSTER.levels.map((l, i) => (
                    <option key={l.level} value={i}>
                      Lv{l.level} — {l.smallBlind.toLocaleString()}/{l.bigBlind.toLocaleString()}
                      {l.ante ? ` (A${l.ante.toLocaleString()})` : ''}
                      {MONSTER.lateRegLevel === l.level ? ' · 레지마감' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>내 스택 (칩)</label>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={chipsStr}
                  onChange={(e) => setChipsStr(e.target.value)}
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="stat">
                <span>유효 스택</span>
                <span className="val">{monsterBB} BB</span>
              </div>
              <div className="stat">
                <span>M-비율 (생존 오빗)</span>
                <span className="val">{monsterM.toFixed(1)} M</span>
              </div>
            </div>
            {tooDeep && (
              <p className="muted" style={{ marginTop: 10, color: 'var(--warn)' }}>
                아직 {monsterBB}BB로 딥합니다 — 순수 푸시/폴드보다 일반 오픈/3벳 전략이 우선입니다.
                차트는 25BB 기준으로 표시합니다.
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="row">
          <div>
            <label>핸드 (예: AJs, 99, KTo)</label>
            <input type="text" value={hand} onChange={(e) => setHand(e.target.value.trim())} />
          </div>
          <div>
            <label>
              유효 스택 (BB): {activeStackBB}
              {monsterMode ? ' · 실전 모드 자동' : ''}
            </label>
            <input
              type="range"
              min={1}
              max={25}
              value={activeStackBB}
              disabled={monsterMode}
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
