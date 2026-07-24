'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  createRoom,
  joinRoom,
  fetchRoom,
  startHandReq,
  sendAction,
  leaveRoom as leaveRoomReq,
  rebuy as rebuyReq,
  makeDeal as makeDealReq,
  listPublicRooms,
  type RoomView,
  type RoomConfig,
  type PublicRoomSummary,
} from '@/lib/rooms';
import { PRESET_LIST, getPreset, type BlindPreset } from '@gto/engine';
import type { Action } from '@gto/engine';
import { Table } from './Table';

const LS_ROOM = 'gto-play-room';
const LS_PLAYER = 'gto-play-player';
const LS_NAME = 'gto-play-name';

function presetToConfig(p: BlindPreset): RoomConfig {
  const lv = p.levels[0];
  return {
    presetId: p.id.toString(),
    presetName: p.name,
    startingStack: p.startingStack,
    smallBlind: lv.smallBlind,
    bigBlind: lv.bigBlind,
    ante: lv.ante,
    levelMinutes: p.levelMinutes,
    actionTimeoutSec: 30,
    autoNextHand: true,
    // Cash + rebuy tournaments (몬스터) allow rebuys; freezeouts play to a winner.
    allowRebuy: p.isCash || p.rebuyStack != null,
    rebuyStack: p.rebuyStack,
    lateRegLevel: p.lateRegLevel,
  };
}

export default function PlayPage() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Restore a session from localStorage on mount (seated or spectating).
  useEffect(() => {
    const r = localStorage.getItem(LS_ROOM);
    const p = localStorage.getItem(LS_PLAYER);
    if (r) {
      setRoomId(r);
      if (p) setPlayerId(p);
    }
  }, []);

  /** Drop the saved session and return to the lobby (no server call). */
  const resetToLobby = useCallback((msg?: string) => {
    localStorage.removeItem(LS_ROOM);
    localStorage.removeItem(LS_PLAYER);
    setRoomId(null);
    setPlayerId(null);
    setRoom(null);
    setError('');
    if (msg) setNotice(msg);
  }, []);

  const poll = useCallback(async () => {
    if (!roomId) return;
    try {
      const v = await fetchRoom(roomId, playerId ?? undefined);
      setRoom(v);
      setError('');
    } catch (e) {
      // The saved room no longer exists (expired / server restarted / storage
      // switched): clear the stale session instead of polling a dead room.
      if ((e as Error).name === 'RoomNotFound') {
        resetToLobby(
          `저장돼 있던 방(${roomId})을 찾을 수 없어 로비로 돌아왔습니다. 방이 만료됐거나 서버 저장소가 초기화됐습니다 — 새 방을 만들어 주세요.`,
        );
        return;
      }
      setError((e as Error).message);
    }
  }, [roomId, playerId, resetToLobby]);

  // Poll fast (1s) while a hand is running so the table feels live; relax to
  // 2.5s between hands / in the lobby.
  const inHand = !!room?.gameState?.handInProgress;
  useEffect(() => {
    if (!roomId) return;
    poll();
    const t = setInterval(poll, inHand ? 1000 : 2500);
    return () => clearInterval(t);
  }, [roomId, poll, inHand]);

  function enterRoom(id: string, pid: string, name: string) {
    localStorage.setItem(LS_ROOM, id);
    localStorage.setItem(LS_PLAYER, pid);
    localStorage.setItem(LS_NAME, name);
    setRoomId(id);
    setPlayerId(pid);
  }

  function spectate(id: string) {
    localStorage.setItem(LS_ROOM, id);
    localStorage.removeItem(LS_PLAYER);
    setRoomId(id);
    setPlayerId(null);
    setRoom(null);
  }

  function leave() {
    if (roomId && playerId) leaveRoomReq(roomId, playerId); // tell the server (fire-and-forget)
    localStorage.removeItem(LS_ROOM);
    localStorage.removeItem(LS_PLAYER);
    setRoomId(null);
    setPlayerId(null);
    setRoom(null);
  }

  async function onAction(action: Action) {
    if (!roomId || !playerId) return;
    try {
      const v = await sendAction(roomId, playerId, action);
      setRoom(v);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDeal() {
    if (!roomId || !playerId) return;
    try {
      const v = await startHandReq(roomId, playerId);
      setRoom(v);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onRebuy() {
    if (!roomId || !playerId) return;
    try {
      const v = await rebuyReq(roomId, playerId);
      setRoom(v);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onMakeDeal(method: 'icm' | 'chip') {
    if (!roomId || !playerId) return;
    try {
      const v = await makeDealReq(roomId, playerId, method);
      setRoom(v);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (roomId) {
    return (
      <div className="container">
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {room ? (
          <Table
            room={room}
            youId={playerId}
            onAction={onAction}
            onDeal={onDeal}
            onLeave={leave}
            onRebuy={onRebuy}
            onMakeDeal={onMakeDeal}
          />
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <p className="muted" style={{ marginTop: 0 }}>방 불러오는 중…</p>
            <button className="secondary" onClick={() => resetToLobby()}>
              처음으로 돌아가기
            </button>
          </div>
        )}
      </div>
    );
  }

  return <Landing onEnter={enterRoom} onSpectate={spectate} notice={notice} />;
}

// ---------- landing: create / join ----------

function Landing({
  onEnter,
  onSpectate,
  notice,
}: {
  onEnter: (id: string, pid: string, name: string) => void;
  onSpectate: (id: string) => void;
  notice?: string;
}) {
  const [name, setName] = useState('');
  const [presetId, setPresetId] = useState('classic');
  const [roomName, setRoomName] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({
    startingStack: 1500,
    smallBlind: 10,
    bigBlind: 20,
    ante: 0,
    levelMinutes: 0,
    actionTimeoutSec: 30,
    autoNextHand: true,
    allowRebuy: true,
  });
  // Optional extra blind levels (level 1 is the sb/bb/ante above).
  const [extraLevels, setExtraLevels] = useState<{ smallBlind: number; bigBlind: number; ante: number }[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [aiCount, setAiCount] = useState(0);
  const [botLevel, setBotLevel] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [lobby, setLobby] = useState<PublicRoomSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 'file' backend on a serverless deploy means rooms don't persist across
  // instances, so other people can't join. Surface that up front.
  const [roomBackend, setRoomBackend] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setRoomBackend(d.roomBackend ?? null))
      .catch(() => {});
  }, []);

  // 몬스터 허브 등에서 ?preset=monster 로 넘어오면 해당 프리셋을 미리 선택.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('preset');
    if (p && PRESET_LIST.some((x) => x.id === p)) {
      setPresetId(p);
      if (p === 'monster') setRoomName('몬스터 게임');
    }
  }, []);

  // Refresh the public lobby list while on the landing page.
  useEffect(() => {
    let alive = true;
    const load = () => listPublicRooms().then((r) => alive && setLobby(r)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  function addLevel() {
    const last = extraLevels[extraLevels.length - 1] ?? {
      smallBlind: custom.smallBlind,
      bigBlind: custom.bigBlind,
      ante: custom.ante,
    };
    setExtraLevels([
      ...extraLevels,
      { smallBlind: last.bigBlind, bigBlind: last.bigBlind * 2, ante: last.ante },
    ]);
  }
  function updateLevel(i: number, key: 'smallBlind' | 'bigBlind' | 'ante', v: number) {
    setExtraLevels(extraLevels.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)));
  }
  function removeLevel(i: number) {
    setExtraLevels(extraLevels.filter((_, idx) => idx !== i));
  }

  useEffect(() => {
    setName(localStorage.getItem(LS_NAME) ?? '');
    // Logged-in account: prefill the nickname with the account nick (editable).
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.nick) setName(d.user.nick);
      })
      .catch(() => {});
  }, []);

  function buildConfig(): RoomConfig {
    if (showCustom) {
      const levels =
        extraLevels.length > 0
          ? [
              { level: 1, smallBlind: custom.smallBlind, bigBlind: custom.bigBlind, ante: custom.ante },
              ...extraLevels.map((l, i) => ({ level: i + 2, ...l })),
            ]
          : undefined;
      return {
        presetId: 'custom',
        presetName: '커스텀',
        isPublic,
        botLevel,
        startingStack: custom.startingStack,
        smallBlind: custom.smallBlind,
        bigBlind: custom.bigBlind,
        ante: custom.ante,
        levelMinutes: custom.levelMinutes,
        actionTimeoutSec: custom.actionTimeoutSec,
        autoNextHand: custom.autoNextHand,
        allowRebuy: custom.allowRebuy,
        levels,
      };
    }
    return { ...presetToConfig(getPreset(presetId)), isPublic, botLevel };
  }

  async function onCreate() {
    if (!name.trim()) {
      setError('이름을 입력하세요.');
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { room, playerId } = await createRoom({
        name: roomName.trim() || `${name}의 테이블`,
        hostName: name.trim(),
        config: buildConfig(),
        aiCount,
      });
      onEnter(room.id, playerId, name.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinById(id: string) {
    if (!name.trim()) {
      setError('이름을 입력하세요.');
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { room, playerId } = await joinRoom(id, name.trim());
      onEnter(room.id, playerId, name.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onJoin() {
    if (!name.trim()) {
      setError('이름을 입력하세요.');
      nameRef.current?.focus();
      return;
    }
    if (!joinCode.trim()) {
      setError('방 코드를 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { room, playerId } = await joinRoom(joinCode.trim().toUpperCase(), name.trim());
      onEnter(room.id, playerId, name.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <h1>홀덤 — 친구들과 플레이</h1>
      <p className="subtitle">
        방을 만들어 코드를 공유하면 친구들이 참가합니다. 칩·블라인드 프리셋을 고르거나 직접
        설정하세요.
      </p>

      {notice && (
        <div className="card" style={{ border: '1px solid var(--blue)', background: 'rgba(88,166,255,0.07)' }}>
          <span className="muted" style={{ color: 'var(--blue)' }}>{notice}</span>
        </div>
      )}

      {roomBackend === 'file' && (
        <div className="card" style={{ border: '2px solid var(--warn)', background: 'rgba(210,153,34,0.08)' }}>
          <strong style={{ color: 'var(--warn)' }}>⚠️ 멀티플레이 저장소가 임시 모드입니다</strong>
          <p className="muted" style={{ margin: '6px 0 10px', fontSize: 13 }}>
            데이터베이스가 연결돼 있지 않아 다른 사람이 같은 코드로 들어와도{' '}
            <strong>“방이 존재하지 않습니다”</strong>가 뜰 수 있습니다. 2~3분이면 무료로 연결할 수 있어요.
          </p>
          <Link href="/setup" className="btn-link" style={{ background: 'var(--warn)' }}>
            DB 연결 가이드 열기 →
          </Link>
        </div>
      )}

      <div className="card">
        <label>닉네임</label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          maxLength={16}
          placeholder="예: 철수"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="card">
        <h2>🌐 공개 테이블 ({lobby?.length ?? 0})</h2>
        {lobby === null ? (
          <p className="muted">목록 불러오는 중…</p>
        ) : lobby.length === 0 ? (
          <p className="muted">지금 열려 있는 공개 테이블이 없습니다. 첫 테이블을 만들어 보세요!</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lobby.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                <div style={{ flex: 1, minWidth: 140 }}>
                  <strong>{r.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.presetName} · {r.smallBlind}/{r.bigBlind} · {r.players}명
                    {r.handNumber > 0 ? ` · 핸드 #${r.handNumber}` : ' · 대기 중'}
                  </div>
                </div>
                <button onClick={() => joinById(r.id)} disabled={busy} style={{ padding: '8px 16px' }}>
                  참가
                </button>
                <button
                  className="secondary"
                  onClick={() => onSpectate(r.id)}
                  style={{ padding: '8px 12px' }}
                >
                  관전
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>방 만들기</h2>
        <label>테이블 이름 (선택)</label>
        <input
          type="text"
          value={roomName}
          maxLength={24}
          placeholder="예: 금요일 홈게임"
          onChange={(e) => setRoomName(e.target.value)}
        />

        <div style={{ marginTop: 16 }}>
          <label>블라인드 / 칩 프리셋</label>
          <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))' }}>
            {PRESET_LIST.map((p) => {
              const lv = p.levels[0];
              const active = !showCustom && presetId === p.id;
              return (
                <button
                  key={p.id}
                  className="secondary"
                  onClick={() => {
                    setShowCustom(false);
                    setPresetId(p.id.toString());
                  }}
                  style={{
                    textAlign: 'left',
                    borderColor: active ? 'var(--accent)' : undefined,
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    시작 {p.startingStack.toLocaleString()}
                  </div>
                  <div className="muted">
                    {lv.smallBlind}/{lv.bigBlind}
                    {lv.ante ? ` (A${lv.ante})` : ''}
                  </div>
                  <div className="muted">{p.isCash ? '캐시' : `${p.levelMinutes}분/레벨`}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button
            className="secondary"
            onClick={() => setShowCustom((v) => !v)}
            style={{ borderColor: showCustom ? 'var(--accent)' : undefined }}
          >
            상세 설정 {showCustom ? '▲' : '▼'}
          </button>
        </div>

        {showCustom && (
          <div style={{ marginTop: 14 }}>
            <div className="row">
              <div>
                <label>시작 스택</label>
                <input
                  type="number"
                  value={custom.startingStack}
                  onChange={(e) => setCustom({ ...custom, startingStack: +e.target.value })}
                />
              </div>
              <div>
                <label>스몰블라인드</label>
                <input
                  type="number"
                  value={custom.smallBlind}
                  onChange={(e) => setCustom({ ...custom, smallBlind: +e.target.value })}
                />
              </div>
              <div>
                <label>빅블라인드</label>
                <input
                  type="number"
                  value={custom.bigBlind}
                  onChange={(e) => setCustom({ ...custom, bigBlind: +e.target.value })}
                />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div>
                <label>앤티</label>
                <input
                  type="number"
                  value={custom.ante}
                  onChange={(e) => setCustom({ ...custom, ante: +e.target.value })}
                />
              </div>
              <div>
                <label>레벨 시간(분, 0=고정)</label>
                <input
                  type="number"
                  value={custom.levelMinutes}
                  onChange={(e) => setCustom({ ...custom, levelMinutes: +e.target.value })}
                />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div>
                <label>액션 제한시간(초, 0=무제한)</label>
                <input
                  type="number"
                  value={custom.actionTimeoutSec}
                  onChange={(e) => setCustom({ ...custom, actionTimeoutSec: +e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={custom.autoNextHand}
                    onChange={(e) => setCustom({ ...custom, autoNextHand: e.target.checked })}
                    style={{ width: 'auto' }}
                  />
                  자동 다음 핸드
                </label>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={custom.allowRebuy}
                  onChange={(e) => setCustom({ ...custom, allowRebuy: e.target.checked })}
                  style={{ width: 'auto' }}
                />
                리바이 허용 (버스트 시 재구매)
              </label>
            </div>

            <div style={{ marginTop: 16 }}>
              <label>블라인드 래더 (선택 — 토너먼트 자동 상승)</label>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                레벨 1은 위 SB/BB/앤티입니다. 레벨을 추가하면 {custom.levelMinutes || '?'}분마다 자동
                상승합니다.
                {custom.levelMinutes === 0 && extraLevels.length > 0 && (
                  <span style={{ color: 'var(--warn)' }}> · 레벨 시간이 0이면 상승하지 않습니다</span>
                )}
              </div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Lv.1 — {custom.smallBlind}/{custom.bigBlind}
                {custom.ante ? ` (A${custom.ante})` : ''}
              </div>
              {extraLevels.map((l, i) => (
                <div key={i} className="row" style={{ marginTop: 6, alignItems: 'center' }}>
                  <span style={{ flex: '0 0 46px', fontWeight: 600 }}>Lv.{i + 2}</span>
                  <input
                    type="number"
                    value={l.smallBlind}
                    onChange={(e) => updateLevel(i, 'smallBlind', +e.target.value)}
                    placeholder="SB"
                  />
                  <input
                    type="number"
                    value={l.bigBlind}
                    onChange={(e) => updateLevel(i, 'bigBlind', +e.target.value)}
                    placeholder="BB"
                  />
                  <input
                    type="number"
                    value={l.ante}
                    onChange={(e) => updateLevel(i, 'ante', +e.target.value)}
                    placeholder="앤티"
                  />
                  <button
                    className="secondary"
                    onClick={() => removeLevel(i)}
                    style={{ flex: '0 0 auto', padding: '6px 10px' }}
                  >
                    삭제
                  </button>
                </div>
              ))}
              <button className="secondary" style={{ marginTop: 8 }} onClick={addLevel}>
                + 레벨 추가
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              style={{ width: 'auto' }}
            />
            공개 테이블 목록에 표시 (끄면 코드로만 참가 가능)
          </label>
        </div>
        <div style={{ marginTop: 14 }}>
          <label>🤖 AI 플레이어 (혼자서도 바로 게임!)</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className="secondary"
                onClick={() => setAiCount(n)}
                style={{
                  padding: '8px 14px',
                  fontWeight: 700,
                  borderColor: aiCount === n ? 'var(--accent)' : 'var(--border)',
                  color: aiCount === n ? 'var(--accent)' : 'var(--text-dim)',
                  background: aiCount === n ? 'rgba(63,185,80,0.12)' : 'var(--bg-elevated)',
                }}
              >
                {n === 0 ? '없음' : `${n}명`}
              </button>
            ))}
          </div>
          {aiCount > 0 && (
            <>
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 13 }}>AI 난이도</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {([
                    ['easy', '쉬움', '콜을 많이 하는 초보'],
                    ['normal', '보통', '아마추어 중수'],
                    ['hard', '어려움', '타이트·공격적'],
                  ] as const).map(([lv, ko, desc]) => (
                    <button
                      key={lv}
                      type="button"
                      className="secondary"
                      onClick={() => setBotLevel(lv)}
                      title={desc}
                      style={{
                        flex: 1,
                        padding: '8px 6px',
                        fontWeight: 700,
                        borderColor: botLevel === lv ? 'var(--accent)' : 'var(--border)',
                        color: botLevel === lv ? 'var(--accent)' : 'var(--text-dim)',
                        background: botLevel === lv ? 'rgba(63,185,80,0.12)' : 'var(--bg-elevated)',
                      }}
                    >
                      {ko}
                    </button>
                  ))}
                </div>
              </div>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                AI {aiCount}명이 함께 앉습니다(난이도: {botLevel === 'easy' ? '쉬움' : botLevel === 'hard' ? '어려움' : '보통'}).
                자동으로 플레이하며 상금 정산 대상은 아닙니다.
              </p>
            </>
          )}
        </div>
        {!showCustom && presetId === 'monster' && (
          <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
            🎰 몬스터 게임은 <strong>바이인 30,000 게임머니</strong>입니다(로그인 시 차감·리바이도 동일).
            우승·입상하면 상금이 게임머니로 지급되고 <a href="/ranking">랭킹</a>에 반영됩니다.
          </p>
        )}
        <div style={{ marginTop: 14 }}>
          <button onClick={onCreate} disabled={busy}>
            {busy ? '생성 중…' : '방 만들기'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>방 코드로 참가</h2>
        <div className="row">
          <div style={{ flex: 2 }}>
            <label>방 코드</label>
            <input
              type="text"
              value={joinCode}
              maxLength={4}
              placeholder="예: K3F9"
              style={{ textTransform: 'uppercase', letterSpacing: 4, fontWeight: 700 }}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button className="secondary" onClick={onJoin} disabled={busy}>
              참가
            </button>
            <button
              className="secondary"
              onClick={() => joinCode.trim() && onSpectate(joinCode.trim().toUpperCase())}
              disabled={!joinCode.trim()}
              title="좌석 없이 관전만 합니다"
            >
              관전
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          관전은 좌석 없이 테이블을 구경합니다 (카드는 쇼다운 때 공개).
        </p>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
