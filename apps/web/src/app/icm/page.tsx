'use client';

import { useMemo, useState } from 'react';
import {
  icm,
  riskPremium,
  bubbleFactor,
  dealCalc,
  icmShoveEv,
  allGridLabels,
  payoutsFor,
  PAYOUT_PRESETS,
  MONSTER_GAME,
  monsterPaidCount,
  monsterPrizePool,
  monsterPayouts,
} from '@gto/engine';
import { RangeGrid } from '@/components/RangeGrid';

const CUSTOM_ID = 'custom';
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
const MAX_PLACES = 10;
const DEFAULT_PRESET = 'sng-9max';

interface PlayerRow {
  name: string;
  stack: string;
}

const DEFAULT_PLAYERS: PlayerRow[] = [
  { name: '플레이어 1', stack: '5000' },
  { name: '플레이어 2', stack: '4000' },
  { name: '플레이어 3', stack: '3000' },
  { name: '플레이어 4', stack: '1500' },
];

/** 0.335 → "33.5" (프리셋 분수를 % 입력 문자열로). */
function fractionToPctStr(f: number): string {
  return String(Math.round(f * 10000) / 100);
}

/** 금액 표시 (₩/칩 공용, -0 방지). */
function fmtAmount(x: number): string {
  return (Math.round(x) || 0).toLocaleString('ko-KR');
}

function bfAdvice(bf: number): string {
  if (!Number.isFinite(bf)) return '이겨도 ICM 지분이 늘지 않는 스팟 — 올인할 이유가 없습니다';
  if (bf <= 1.05) return '칩EV와 거의 동일 — 부담 없이 플레이';
  if (bf < 1.25) return '가벼운 ICM 압박 — 약간 타이트하게';
  if (bf < 1.7) return '상당한 압박 — 타이트하게';
  return '극심한 버블 압박 — 매우 타이트하게';
}

export default function IcmPage() {
  const [players, setPlayers] = useState<PlayerRow[]>(DEFAULT_PLAYERS);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET);
  const [prizePoolStr, setPrizePoolStr] = useState('1000000');
  const [payoutPcts, setPayoutPcts] = useState<string[]>(() =>
    payoutsFor(DEFAULT_PLAYERS.length, DEFAULT_PRESET).map(fractionToPctStr),
  );
  const [heroIdx, setHeroIdx] = useState(0);
  const [villainIdx, setVillainIdx] = useState(1);

  // ---- 몬스터 게임 (파이널 나인) 빠른 설정 ----
  const [entriesStr, setEntriesStr] = useState('21');
  const [rebuysStr, setRebuysStr] = useState(() => String(Math.round(21 * 0.7)));
  // 리바이를 사용자가 직접 고치기 전에는 엔트리 변경 시 자동으로 70%로 따라갑니다.
  const [rebuysAuto, setRebuysAuto] = useState(true);

  const monster = useMemo(() => {
    const entries = Math.max(0, Math.floor(Number(entriesStr) || 0));
    const rebuys = Math.max(0, Math.floor(Number(rebuysStr) || 0));
    const paidCount = monsterPaidCount(entries);
    const pool = monsterPrizePool(entries, rebuys);
    const avgPayout = paidCount > 0 ? pool / paidCount : 0;
    return { entries, rebuys, paidCount, pool, avgPayout };
  }, [entriesStr, rebuysStr]);

  function setEntries(value: string) {
    setEntriesStr(value);
    if (rebuysAuto) {
      const entries = Math.max(0, Math.floor(Number(value) || 0));
      setRebuysStr(String(Math.round(entries * 0.7)));
    }
  }

  function setRebuys(value: string) {
    setRebuysStr(value);
    setRebuysAuto(false);
  }

  function applyMonster() {
    setPrizePoolStr(String(monster.pool));
    setPayoutPcts(monsterPayouts(monster.paidCount).map(fractionToPctStr));
    // 커스텀 모드로 전환해 지급 인원(paidCount)만큼의 순위가 그대로 유지되도록 합니다.
    setPresetId(CUSTOM_ID);
  }

  // ---- 파생 값 ----
  const stacks = useMemo(
    () => players.map((p) => Math.max(0, Number(p.stack) || 0)),
    [players],
  );
  const totalChips = useMemo(() => stacks.reduce((a, b) => a + b, 0), [stacks]);
  const fractions = useMemo(
    () => payoutPcts.map((s) => Math.max(0, Number(s) || 0) / 100),
    [payoutPcts],
  );
  const pctSum = useMemo(() => fractions.reduce((a, b) => a + b, 0) * 100, [fractions]);
  const sumOk = Math.abs(pctSum - 100) < 0.5;
  const prizePool = Math.max(0, Number(prizePoolStr) || 0);

  const canCalc = totalChips > 0 && fractions.some((f) => f > 0);

  const result = useMemo(() => {
    if (!canCalc) return null;
    return icm(stacks, fractions);
  }, [canCalc, stacks, fractions]);

  // 딜 계산: 실제 상금(₩) 기준 ICM vs 플로어 있는 칩찹(chip-chop).
  const deal = useMemo(() => {
    if (!canCalc || prizePool <= 0) return null;
    return dealCalc(stacks, fractions.map((f) => f * prizePool));
  }, [canCalc, stacks, fractions, prizePool]);

  // ---- 버블 팩터 (히어로/빌런 인덱스는 인원 변경 시 안전하게 클램프) ----
  const n = players.length;
  const hero = Math.min(heroIdx, n - 1);
  let villain = Math.min(villainIdx, n - 1);
  if (villain === hero) villain = hero === 0 ? 1 : 0;

  const bubble = useMemo(() => {
    if (!canCalc || stacks[hero] <= 0 || stacks[villain] <= 0) return null;
    const bf = bubbleFactor(stacks, fractions, hero, villain);
    const amount = Math.min(stacks[hero], stacks[villain]);
    const rp = riskPremium(stacks, fractions, hero, villain, amount);
    return { bf, rp };
  }, [canCalc, stacks, fractions, hero, villain]);

  // ---- ICM 셔브 판단 (퍼스트-인 올인 모델) ----
  const [shoveHand, setShoveHand] = useState('AKo');
  const [callRange, setCallRange] = useState('88+, ATs+, AJo+, KQs');
  const [shoveBBStr, setShoveBBStr] = useState('200');
  const [shoveAnteStr, setShoveAnteStr] = useState('0');

  const shove = useMemo(() => {
    if (!canCalc || stacks[hero] <= 0) return null;
    const bb = Math.max(0, Number(shoveBBStr) || 0);
    const ante = Math.max(0, Number(shoveAnteStr) || 0);
    // 히어로를 제외한 나머지 플레이어를 (순서대로) 콜러로 두고 같은 콜 레인지 적용.
    const callerRanges = players
      .map((_, i) => i)
      .filter((i) => i !== hero && stacks[i] > 0)
      .map((idx) => ({ idx, range: callRange }));
    if (!callerRanges.length) return null;
    try {
      const r = icmShoveEv({
        stacks,
        payouts: fractions,
        heroIdx: hero,
        heroHand: shoveHand.trim(),
        callerRanges,
        sb: Math.floor(bb / 2),
        bb,
        ante,
        iterations: 3000,
        seed: 2026,
      });
      return { ...r, error: null as string | null };
    } catch (e) {
      return { error: (e as Error).message } as {
        error: string;
        evFoldICM?: number;
        evShoveICM?: number;
        deltaICM?: number;
        shoveOk?: boolean;
      };
    }
  }, [canCalc, stacks, fractions, hero, players, shoveHand, callRange, shoveBBStr, shoveAnteStr]);

  // 전체 169핸드 ICM 셔브 레인지 (버튼으로 계산 — 몬테카를로라 다소 무거움).
  const [shoveGrid, setShoveGrid] = useState<Map<string, number> | null>(null);
  const [computingGrid, setComputingGrid] = useState(false);

  function computeShoveGrid() {
    if (!canCalc || stacks[hero] <= 0) return;
    setComputingGrid(true);
    setShoveGrid(null);
    // 스피너가 먼저 그려지도록 계산을 다음 틱으로 미룹니다.
    setTimeout(() => {
      const bb = Math.max(0, Number(shoveBBStr) || 0);
      const ante = Math.max(0, Number(shoveAnteStr) || 0);
      const callerRanges = players
        .map((_, i) => i)
        .filter((i) => i !== hero && stacks[i] > 0)
        .map((idx) => ({ idx, range: callRange }));
      const grid = new Map<string, number>();
      if (callerRanges.length) {
        for (const label of allGridLabels()) {
          try {
            const r = icmShoveEv({
              stacks,
              payouts: fractions,
              heroIdx: hero,
              heroHand: label,
              callerRanges,
              sb: Math.floor(bb / 2),
              bb,
              ante,
              iterations: 600,
              seed: 2026,
            });
            if (r.shoveOk) grid.set(label, 1);
          } catch {
            /* 잘못된 콜 레인지 등은 무시 */
          }
        }
      }
      setShoveGrid(grid);
      setComputingGrid(false);
    }, 20);
  }

  // ---- 핸들러 ----
  function applyPreset(id: string) {
    setPresetId(id);
    if (id === CUSTOM_ID) return;
    setPayoutPcts(payoutsFor(players.length, id).map(fractionToPctStr));
  }

  function syncPayoutsToCount(count: number) {
    if (presetId !== CUSTOM_ID) {
      setPayoutPcts(payoutsFor(count, presetId).map(fractionToPctStr));
    }
  }

  function addPlayer() {
    if (players.length >= MAX_PLAYERS) return;
    const next = [...players, { name: `플레이어 ${players.length + 1}`, stack: '1000' }];
    setPlayers(next);
    syncPayoutsToCount(next.length);
  }

  function removePlayer(i: number) {
    if (players.length <= MIN_PLAYERS) return;
    const next = players.filter((_, x) => x !== i);
    setPlayers(next);
    syncPayoutsToCount(next.length);
  }

  function updatePlayer(i: number, patch: Partial<PlayerRow>) {
    setPlayers(players.map((p, x) => (x === i ? { ...p, ...patch } : p)));
  }

  function updatePayout(i: number, value: string) {
    setPayoutPcts(payoutPcts.map((v, x) => (x === i ? value : v)));
    setPresetId(CUSTOM_ID);
  }

  function addPayoutPlace() {
    if (payoutPcts.length >= MAX_PLACES) return;
    setPayoutPcts([...payoutPcts, '5']);
    setPresetId(CUSTOM_ID);
  }

  function removePayoutPlace(i: number) {
    if (payoutPcts.length <= 1) return;
    setPayoutPcts(payoutPcts.filter((_, x) => x !== i));
    setPresetId(CUSTOM_ID);
  }

  function onHeroChange(i: number) {
    if (i === villain) setVillainIdx(hero);
    setHeroIdx(i);
  }

  function onVillainChange(i: number) {
    if (i === hero) setHeroIdx(villain);
    setVillainIdx(i);
  }

  const playerName = (i: number) => players[i]?.name.trim() || `플레이어 ${i + 1}`;

  return (
    <div className="container">
      <h1>ICM 계산기</h1>
      <p className="subtitle">
        Malmuth-Harville 모델로 칩 스택을 상금 기대값으로 환산합니다. 상금 구조 프리셋, 칩찹(chip-chop)
        비교, 버블 팩터까지 한 번에 확인하세요.
      </p>

      {/* 0. 몬스터 게임 (파이널 나인) 빠른 설정 */}
      <div className="card">
        <h2>🎰 몬스터 게임 (파이널 나인)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          파이널 나인 홀덤펍 몬스터 게임 구조를 한 번에 세팅합니다. 바이인·리바이 각{' '}
          {fmtAmount(MONSTER_GAME.buyIn)}원 전액이 프라이즈풀에 포함되며, 7엔트리당 1명 지급 (지급 인원 =
          엔트리 ÷ 7). 스타트 {fmtAmount(MONSTER_GAME.startStack)} 칩, 리바이{' '}
          {fmtAmount(MONSTER_GAME.rebuyStack)} 칩 (스택은 아래 표에 실제 값으로 입력).
        </p>

        <div className="row">
          <div>
            <label>엔트리 수</label>
            <input
              type="number"
              min={0}
              step={1}
              value={entriesStr}
              onChange={(e) => setEntries(e.target.value)}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[21, 28, 35].map((n) => (
                <button
                  key={n}
                  className="secondary preset"
                  onClick={() => setEntries(String(n))}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label>리바이 수 (기본 엔트리 × 70%)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={rebuysStr}
              onChange={(e) => setRebuys(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="stat">
            <span>지급 인원 (엔트리 ÷ 7)</span>
            <span className="val">{monster.paidCount}명</span>
          </div>
          <div className="stat">
            <span>
              프라이즈풀 ({monster.entries} 엔트리 + {monster.rebuys} 리바이) ×{' '}
              {fmtAmount(MONSTER_GAME.buyIn)}원
            </span>
            <span className="val">{fmtAmount(monster.pool)}원</span>
          </div>
          <div className="stat">
            <span>1인 평균 지급</span>
            <span className="val">{fmtAmount(monster.avgPayout)}원</span>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={applyMonster} disabled={monster.pool <= 0}>
            이 구조 적용
          </button>
          <span className="muted">
            총 상금과 순위별 배분율({monster.paidCount}자리)을 자동으로 채웁니다. 이후 아래 표에 남은
            플레이어 스택을 입력하면 ICM 지분·상금과 버블 팩터를 확인할 수 있습니다.
          </span>
        </div>
      </div>

      {/* 1. 상금 구조 */}
      <div className="card">
        <h2>상금 구조</h2>
        <div className="row">
          <div>
            <label>프리셋</label>
            <select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
              {PAYOUT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={CUSTOM_ID}>커스텀 (직접 입력)</option>
            </select>
          </div>
          <div>
            <label>총 상금 (₩ 또는 칩)</label>
            <input
              type="number"
              min={0}
              step="any"
              value={prizePoolStr}
              onChange={(e) => setPrizePoolStr(e.target.value)}
            />
          </div>
        </div>

        <label style={{ marginTop: 16 }}>순위별 배분율 (%)</label>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 10,
          }}
        >
          {payoutPcts.map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="muted" style={{ minWidth: 30, textAlign: 'right' }}>
                {i + 1}위
              </span>
              <input
                type="number"
                min={0}
                step="any"
                value={v}
                onChange={(e) => updatePayout(i, e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                className="secondary"
                onClick={() => removePayoutPlace(i)}
                disabled={payoutPcts.length <= 1}
                title="이 순위 삭제"
                style={{ padding: '6px 10px' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="secondary" onClick={addPayoutPlace} disabled={payoutPcts.length >= MAX_PLACES}>
            + 순위 추가
          </button>
          <span className={`pill ${sumOk ? 'push' : 'marginal'}`}>합계 {pctSum.toFixed(2)}%</span>
          {!sumOk && (
            <span className="muted" style={{ color: 'var(--warn)' }}>
              배분율 합계가 100%가 아닙니다 — ICM 상금 합계가 총 상금과 달라집니다.
            </span>
          )}
        </div>
      </div>

      {/* 2. 플레이어 스택 */}
      <div className="card">
        <h2>
          플레이어 스택 <span className="muted">({MIN_PLAYERS}~{MAX_PLAYERS}명)</span>
        </h2>
        <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
          <span className="muted" style={{ flex: 1.2, minWidth: 0 }}>
            이름
          </span>
          <span className="muted" style={{ flex: 1, minWidth: 0 }}>
            스택 (칩)
          </span>
          <span style={{ width: 38 }} />
        </div>
        {players.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={p.name}
              onChange={(e) => updatePlayer(i, { name: e.target.value })}
              style={{ flex: 1.2, minWidth: 0 }}
            />
            <input
              type="number"
              min={0}
              step="any"
              value={p.stack}
              onChange={(e) => updatePlayer(i, { stack: e.target.value })}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              className="secondary"
              onClick={() => removePlayer(i)}
              disabled={players.length <= MIN_PLAYERS}
              title="이 플레이어 삭제"
              style={{ padding: '6px 10px', width: 38 }}
            >
              ×
            </button>
          </div>
        ))}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="secondary" onClick={addPlayer} disabled={players.length >= MAX_PLAYERS}>
            + 플레이어 추가
          </button>
          <span className="muted">총 칩: {fmtAmount(totalChips)}</span>
        </div>
      </div>

      {/* 3. 결과 테이블 */}
      {result ? (
        <div className="card">
          <h2>ICM 결과 — 딜 계산기 (ICM vs 칩찹)</h2>
          {deal && (
            <p className="muted" style={{ marginTop: 0 }}>
              지금 딜하면 각자 받는 금액입니다. 분배 대상 상금{' '}
              <strong>{fmtAmount(deal.totalPrize)}</strong> · 각자 보장(플로어){' '}
              <strong>{fmtAmount(deal.floor)}</strong>.
            </p>
          )}
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px 6px 0' }}>플레이어</th>
                  <th style={{ padding: '6px 8px' }}>스택</th>
                  <th style={{ padding: '6px 8px' }}>스택 점유율</th>
                  <th style={{ padding: '6px 8px' }}>ICM 지분</th>
                  <th style={{ padding: '6px 8px' }}>ICM 상금</th>
                  <th style={{ padding: '6px 8px' }}>칩찹 상금</th>
                  <th style={{ padding: '6px 0 6px 8px' }}>ICM − 칩찹</th>
                </tr>
              </thead>
              <tbody>
                {players.map((_, i) => {
                  const eq = result.equities[i]; // 상금 풀 분수
                  const stackShare = totalChips > 0 ? stacks[i] / totalChips : 0;
                  const icmPrize = eq * prizePool;
                  // 플로어 있는 칩찹(실제 딜 방식); 프라이즈풀 0이면 단순 비례로 폴백.
                  const chopPrize = deal ? deal.chipChop[i] : stackShare * prizePool;
                  const diff = icmPrize - chopPrize;
                  const rel = eq - stackShare;
                  const better = rel > 0.001;
                  const worse = rel < -0.001;
                  const color = better ? 'var(--accent)' : worse ? 'var(--danger)' : 'var(--text-dim)';
                  return (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600 }}>
                        {playerName(i)}
                      </td>
                      <td style={{ padding: '8px' }}>{fmtAmount(stacks[i])}</td>
                      <td style={{ padding: '8px' }}>{(stackShare * 100).toFixed(2)}%</td>
                      <td style={{ padding: '8px', fontWeight: 700 }}>{(eq * 100).toFixed(2)}%</td>
                      <td style={{ padding: '8px', fontWeight: 700 }}>{fmtAmount(icmPrize)}</td>
                      <td style={{ padding: '8px' }}>{fmtAmount(chopPrize)}</td>
                      <td style={{ padding: '8px 0 8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ color, fontWeight: 700, marginRight: 8 }}>
                          {diff >= 0 ? '+' : ''}
                          {fmtAmount(diff)}
                        </span>
                        <span className={`pill ${better ? 'push' : worse ? 'fold' : 'marginal'}`}>
                          {better ? 'ICM 유리' : worse ? 'ICM 불리' : '비슷'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            칩찹(chip-chop)은 각자 최소 상금(플로어)을 먼저 확보한 뒤 남는 상금을 스택 비율로 나누는
            실제 딜 방식입니다. 숏스택은 보통 ICM이 유리(생존 가치 반영)하고, 빅스택은 칩찹이 유리합니다.
            현실에서는 두 값 사이에서 협상하는 경우가 많습니다 — 파이널 나인 딜 시 참고하세요.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            스택 합계가 0이거나 배분율이 비어 있어 계산할 수 없습니다. 입력을 확인하세요.
          </p>
        </div>
      )}

      {/* 4. 버블 팩터 미니 툴 */}
      <div className="card">
        <h2>버블 팩터</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          히어로가 빌런과 이펙티브 스택 올인을 할 때, 이기며 얻는 ICM 지분 대비 지며 잃는 지분의
          비율입니다. 칩EV에서는 항상 1이며, 클수록 타이트하게 플레이해야 합니다.
        </p>
        <div className="row">
          <div>
            <label>히어로</label>
            <select value={hero} onChange={(e) => onHeroChange(Number(e.target.value))}>
              {players.map((_, i) => (
                <option key={i} value={i}>
                  {playerName(i)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>빌런</label>
            <select value={villain} onChange={(e) => onVillainChange(Number(e.target.value))}>
              {players.map((_, i) => (
                <option key={i} value={i}>
                  {playerName(i)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {bubble ? (
          <div style={{ marginTop: 14 }}>
            <div className="stat">
              <span>버블 팩터</span>
              <span
                className="val"
                style={{
                  color:
                    !Number.isFinite(bubble.bf) || bubble.bf > 1.25
                      ? 'var(--warn)'
                      : 'var(--accent)',
                }}
              >
                {Number.isFinite(bubble.bf) ? bubble.bf.toFixed(2) : '∞'}
              </span>
            </div>
            <div className="stat">
              <span>리스크 프리미엄 (칩EV 50% 대비)</span>
              <span
                className="val"
                style={{ color: bubble.rp > 0 ? 'var(--warn)' : 'var(--accent)' }}
              >
                {(bubble.rp * 100).toFixed(2)}%p
              </span>
            </div>
            <div className="stat">
              <span>필요 콜 에쿼티</span>
              <span className="val">{((0.5 + bubble.rp) * 100).toFixed(1)}%</span>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              {Number.isFinite(bubble.bf)
                ? `${bubble.bf.toFixed(2)} = 이득 1당 리스크 ${bubble.bf.toFixed(2)} — ${bfAdvice(bubble.bf)}.`
                : `∞ — ${bfAdvice(bubble.bf)}.`}
            </p>
          </div>
        ) : (
          <p className="muted" style={{ marginBottom: 0, marginTop: 14 }}>
            히어로와 빌런 모두 0보다 큰 스택이 필요합니다.
          </p>
        )}
      </div>

      {/* 5. ICM 셔브 판단 */}
      <div className="card">
        <h2>ICM 셔브 판단</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          히어로(위에서 선택)가 퍼스트-인으로 올인할 때 ICM 기준 셔브 EV와 폴드 EV를 비교합니다.
          뒤 플레이어들이 아래 콜 레인지로 콜한다고 가정합니다 (몬테카를로 근사).
        </p>
        <div className="row">
          <div>
            <label>히어로 핸드 (예: AKo, 99, AsKh)</label>
            <input value={shoveHand} onChange={(e) => setShoveHand(e.target.value)} />
          </div>
          <div>
            <label>상대 콜 레인지</label>
            <input value={callRange} onChange={(e) => setCallRange(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>빅블라인드 (칩)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={shoveBBStr}
              onChange={(e) => setShoveBBStr(e.target.value)}
            />
          </div>
          <div>
            <label>앤티 (칩, 1인당)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={shoveAnteStr}
              onChange={(e) => setShoveAnteStr(e.target.value)}
            />
          </div>
        </div>

        {shove && shove.error && (
          <p className="muted" style={{ marginTop: 14, marginBottom: 0, color: 'var(--warn)' }}>
            {shove.error} — 핸드/레인지 표기를 확인하세요.
          </p>
        )}
        {shove && !shove.error && shove.evFoldICM != null && (
          <div style={{ marginTop: 14 }}>
            <div className="stat">
              <span>권장</span>
              <span className="val">
                <span className={`pill ${shove.shoveOk ? 'push' : 'fold'}`}>
                  {shove.shoveOk ? '셔브' : '폴드'}
                </span>
              </span>
            </div>
            <div className="stat">
              <span>셔브 ICM 지분</span>
              <span className="val">{((shove.evShoveICM ?? 0) * 100).toFixed(2)}%</span>
            </div>
            <div className="stat">
              <span>폴드 ICM 지분</span>
              <span className="val">{((shove.evFoldICM ?? 0) * 100).toFixed(2)}%</span>
            </div>
            <div className="stat">
              <span>셔브 − 폴드 (ΔICM)</span>
              <span
                className="val"
                style={{ color: (shove.deltaICM ?? 0) > 0 ? 'var(--accent)' : 'var(--warn)' }}
              >
                {(shove.deltaICM ?? 0) >= 0 ? '+' : ''}
                {((shove.deltaICM ?? 0) * 100).toFixed(3)}%p
                {prizePool > 0 ? ` (${fmtAmount((shove.deltaICM ?? 0) * prizePool)})` : ''}
              </span>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              ΔICM &gt; 0이면 셔브가 폴드보다 ICM상 이득입니다. 상대 콜 레인지를 넓히면 셔브 가치가
              내려갑니다 — 레인지를 조절하며 임계점을 찾아보세요.
            </p>
          </div>
        )}

        <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="secondary" onClick={computeShoveGrid} disabled={computingGrid || !canCalc}>
              {computingGrid ? '계산 중…' : '전체 셔브 레인지 계산 (169핸드)'}
            </button>
            {shoveGrid && (
              <span className="muted">
                +ICM 셔브 핸드 {shoveGrid.size}/169 · 위 콜 레인지·블라인드 기준
              </span>
            )}
          </div>
          {shoveGrid && shoveGrid.size > 0 && (
            <div style={{ marginTop: 12 }}>
              <RangeGrid range={shoveGrid} />
              <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
                초록 셀 = ICM 기준 셔브가 이득인 핸드(퍼스트-인 가정, 몬테카를로 근사). 콜 레인지를
                바꾼 뒤 다시 계산하세요.
              </p>
            </div>
          )}
          {shoveGrid && shoveGrid.size === 0 && !computingGrid && (
            <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
              이 스팟에서는 어떤 핸드도 셔브가 이득이 아닙니다 (또는 콜러/레인지 설정을 확인하세요).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
