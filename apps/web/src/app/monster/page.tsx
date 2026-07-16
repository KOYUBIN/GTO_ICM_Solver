'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getPreset,
  levelAt,
  MONSTER_GAME,
  monsterPaidCount,
  monsterPrizePool,
  monsterPayouts,
} from '@gto/engine';

const MONSTER = getPreset('monster');
const ANTE_START = MONSTER.levels.find((l) => l.ante > 0)?.level ?? null;

function fmt(x: number): string {
  return (Math.round(x) || 0).toLocaleString('ko-KR');
}

/** mm:ss-ish minute label. */
function minsLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

/** seconds → "m:ss". */
function mmss(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

const CLOCK_KEY = 'monster-clock-start';

export default function MonsterPage() {
  // 라이브 레벨: 라이브 클럭(시작 시각 저장) 또는 수동 경과 분.
  const [elapsedStr, setElapsedStr] = useState('0');
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // 저장된 클럭 복원.
  useEffect(() => {
    const s = localStorage.getItem(CLOCK_KEY);
    if (s && Number(s) > 0) setStartAt(Number(s));
  }, []);

  // 클럭 실행 중이면 1초마다 갱신.
  useEffect(() => {
    if (startAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startAt]);

  const clockRunning = startAt != null && now != null;
  const elapsedSec = clockRunning ? Math.max(0, (now - startAt) / 1000) : null;
  const elapsed = clockRunning ? elapsedSec! / 60 : Math.max(0, Number(elapsedStr) || 0);

  function startClock() {
    const t = Date.now();
    localStorage.setItem(CLOCK_KEY, String(t));
    setStartAt(t);
    setNow(t);
  }
  function stopClock() {
    localStorage.removeItem(CLOCK_KEY);
    setStartAt(null);
    setNow(null);
  }

  const levelIdx = Math.min(
    MONSTER.levels.length - 1,
    Math.floor(elapsed / MONSTER.levelMinutes),
  );
  const cur = levelAt(MONSTER, levelIdx);
  const next = levelIdx + 1 < MONSTER.levels.length ? MONSTER.levels[levelIdx + 1] : null;
  const intoLevel = elapsed - levelIdx * MONSTER.levelMinutes;
  const toNext = Math.max(0, MONSTER.levelMinutes - intoLevel);
  const isLastLevel = levelIdx === MONSTER.levels.length - 1;
  // 라이브 클럭이면 초 단위 카운트다운.
  const secToNext = clockRunning
    ? Math.max(0, MONSTER.levelMinutes * 60 - (elapsedSec! - levelIdx * MONSTER.levelMinutes * 60))
    : null;
  const regClosed = MONSTER.lateRegLevel != null && cur.level > MONSTER.lateRegLevel;

  // 상금 계산.
  const [entriesStr, setEntriesStr] = useState('21');
  const [rebuysStr, setRebuysStr] = useState('15');
  const entries = Math.max(0, Math.floor(Number(entriesStr) || 0));
  const rebuys = Math.max(0, Math.floor(Number(rebuysStr) || 0));
  const prize = useMemo(() => {
    const paidCount = monsterPaidCount(entries);
    const pool = monsterPrizePool(entries, rebuys);
    const pcts = monsterPayouts(paidCount);
    return { paidCount, pool, payouts: pcts.map((p) => p * pool) };
  }, [entries, rebuys]);

  return (
    <div className="container">
      <h1>🎰 몬스터 게임 (파이널 나인)</h1>
      <p className="subtitle">
        파이널 나인 홀덤펍 몬스터 게임 전용 허브 — 블라인드 구조, 라이브 레벨, 상금 계산을 한 곳에서.
        스타트 {fmt(MONSTER.startingStack)} 칩 · 리바이 {fmt(MONSTER.rebuyStack ?? 0)} 칩 · 레벨{' '}
        {MONSTER.levelMinutes}분 · 레지 마감 L{MONSTER.lateRegLevel}.
      </p>

      {/* 라이브 레벨 */}
      <div className="card" style={{ border: '2px solid var(--warn)' }}>
        <h2>라이브 레벨</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {clockRunning ? (
            <button onClick={stopClock} style={{ background: 'var(--warn)' }}>
              ⏹ 클럭 정지 / 리셋
            </button>
          ) : (
            <button onClick={startClock}>▶ 지금 시작 (라이브 클럭)</button>
          )}
          <span className="muted">
            {clockRunning
              ? `실행 중 · 경과 ${minsLabel(elapsed)}`
              : '시작 시각을 저장하면 레벨이 자동으로 진행됩니다.'}
          </span>
        </div>
        {!clockRunning && (
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>토너먼트 경과 시간 (분) — 수동</label>
              <input
                type="number"
                min={0}
                step={1}
                value={elapsedStr}
                onChange={(e) => setElapsedStr(e.target.value)}
              />
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[0, 20, 30, 60, 90].map((m) => (
                  <button key={m} className="secondary preset" onClick={() => setElapsedStr(String(m))}>
                    {m}분
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <div className="stat">
            <span>현재 레벨</span>
            <span className="val">
              Lv{cur.level} — {fmt(cur.smallBlind)}/{fmt(cur.bigBlind)}
              {cur.ante ? ` (앤티 ${fmt(cur.ante)})` : ''}
            </span>
          </div>
          <div className="stat">
            <span>이 레벨 종료까지</span>
            <span
              className="val"
              style={{
                color:
                  clockRunning && secToNext != null && secToNext <= 60 && !isLastLevel
                    ? 'var(--warn)'
                    : undefined,
              }}
            >
              {isLastLevel
                ? '최종 레벨'
                : clockRunning && secToNext != null
                  ? mmss(secToNext)
                  : minsLabel(toNext)}
            </span>
          </div>
          {next && (
            <div className="stat">
              <span>다음 레벨</span>
              <span className="val">
                Lv{next.level} — {fmt(next.smallBlind)}/{fmt(next.bigBlind)}
                {next.ante ? ` (앤티 ${fmt(next.ante)})` : ''}
              </span>
            </div>
          )}
          <div className="stat">
            <span>레지 상태</span>
            <span className="val">
              <span className={`pill ${regClosed ? 'fold' : 'push'}`}>
                {regClosed ? '마감' : `L${MONSTER.lateRegLevel}까지 오픈`}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 블라인드 구조표 */}
      <div className="card">
        <h2>블라인드 구조</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {ANTE_START ? `L${ANTE_START}부터 BB 앤티 발생` : ''} · 레벨당 {MONSTER.levelMinutes}분
        </p>
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px 6px 0' }}>레벨</th>
                <th style={{ padding: '6px 8px' }}>SB</th>
                <th style={{ padding: '6px 8px' }}>BB</th>
                <th style={{ padding: '6px 8px' }}>앤티</th>
                <th style={{ padding: '6px 0 6px 8px' }}>누적 시간</th>
              </tr>
            </thead>
            <tbody>
              {MONSTER.levels.map((l, i) => {
                const isCur = l.level === cur.level;
                const isReg = MONSTER.lateRegLevel === l.level;
                return (
                  <tr
                    key={l.level}
                    style={{
                      borderTop: '1px solid var(--border)',
                      textAlign: 'right',
                      background: isCur ? 'rgba(240,180,0,0.12)' : undefined,
                    }}
                  >
                    <td style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600 }}>
                      Lv{l.level}
                      {isReg ? <span className="muted"> · 레지마감</span> : ''}
                      {isCur ? ' ◀' : ''}
                    </td>
                    <td style={{ padding: '8px' }}>{fmt(l.smallBlind)}</td>
                    <td style={{ padding: '8px', fontWeight: 700 }}>{fmt(l.bigBlind)}</td>
                    <td style={{ padding: '8px' }}>{l.ante ? fmt(l.ante) : '—'}</td>
                    <td style={{ padding: '8px 0 8px 8px' }}>{minsLabel(i * MONSTER.levelMinutes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 상금 계산 */}
      <div className="card">
        <h2>상금 계산</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          바이인·리바이 각 {fmt(MONSTER_GAME.buyIn)}원 전액 프라이즈풀 · 7엔트리당 1명 지급.
        </p>
        <div className="row">
          <div>
            <label>엔트리 수</label>
            <input
              type="number"
              min={0}
              step={1}
              value={entriesStr}
              onChange={(e) => setEntriesStr(e.target.value)}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[21, 28, 35].map((n) => (
                <button
                  key={n}
                  className="secondary preset"
                  onClick={() => {
                    setEntriesStr(String(n));
                    setRebuysStr(String(Math.round(n * 0.7)));
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label>리바이 수</label>
            <input
              type="number"
              min={0}
              step={1}
              value={rebuysStr}
              onChange={(e) => setRebuysStr(e.target.value)}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="stat">
            <span>지급 인원</span>
            <span className="val">{prize.paidCount}명</span>
          </div>
          <div className="stat">
            <span>프라이즈풀</span>
            <span className="val">{fmt(prize.pool)}원</span>
          </div>
        </div>
        <div className="table-scroll" style={{ marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px 6px 0' }}>순위</th>
                <th style={{ padding: '6px 8px' }}>배분율</th>
                <th style={{ padding: '6px 0 6px 8px' }}>상금</th>
              </tr>
            </thead>
            <tbody>
              {prize.payouts.map((amt, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                  <td style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600 }}>
                    {i + 1}위
                  </td>
                  <td style={{ padding: '8px' }}>
                    {prize.pool > 0 ? ((amt / prize.pool) * 100).toFixed(1) : '0'}%
                  </td>
                  <td style={{ padding: '8px 0 8px 8px', fontWeight: 700 }}>{fmt(amt)}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/icm" className="feature" style={{ padding: '10px 14px', flex: '1 1 220px' }}>
            <h3 style={{ margin: 0 }}>🏆 ICM · 딜 계산기</h3>
            <p style={{ margin: '4px 0 0' }}>파이널 나인 딜(칩찹/ICM)과 버블 팩터 계산</p>
          </Link>
          <Link href="/pushfold" className="feature" style={{ padding: '10px 14px', flex: '1 1 220px' }}>
            <h3 style={{ margin: 0 }}>📈 실전 셔브 차트</h3>
            <p style={{ margin: '4px 0 0' }}>칩·레벨 → 유효 BB·M → 푸시/폴드 판단</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
