'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRoom,
  joinRoom,
  fetchRoom,
  startHandReq,
  sendAction,
  leaveRoom as leaveRoomReq,
  rebuy as rebuyReq,
  type RoomView,
  type RoomConfig,
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
    allowRebuy: p.isCash, // cash: rebuy on; tournaments: off (play to a winner)
  };
}

export default function PlayPage() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState('');

  // Restore a session from localStorage on mount (seated or spectating).
  useEffect(() => {
    const r = localStorage.getItem(LS_ROOM);
    const p = localStorage.getItem(LS_PLAYER);
    if (r) {
      setRoomId(r);
      if (p) setPlayerId(p);
    }
  }, []);

  const poll = useCallback(async () => {
    if (!roomId) return;
    try {
      const v = await fetchRoom(roomId, playerId ?? undefined);
      setRoom(v);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [roomId, playerId]);

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
          />
        ) : (
          <p className="muted">방 불러오는 중…</p>
        )}
      </div>
    );
  }

  return <Landing onEnter={enterRoom} onSpectate={spectate} />;
}

// ---------- landing: create / join ----------

function Landing({
  onEnter,
  onSpectate,
}: {
  onEnter: (id: string, pid: string, name: string) => void;
  onSpectate: (id: string) => void;
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
    return presetToConfig(getPreset(presetId));
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
      });
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

      {roomBackend === 'file' && (
        <div className="card" style={{ border: '2px solid var(--warn)', background: 'rgba(210,153,34,0.08)' }}>
          <strong style={{ color: 'var(--warn)' }}>⚠️ 멀티플레이 저장소가 임시 모드입니다</strong>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            이 배포는 데이터베이스가 연결돼 있지 않아 방이 서버 인스턴스마다 따로 저장됩니다. 그래서 다른
            사람이 같은 코드로 들어와도 <strong>“방이 존재하지 않습니다”</strong>가 뜰 수 있습니다.
            친구들과 함께 하려면 Vercel 대시보드에서 Postgres 데이터베이스(예: Neon)를 만들어 프로젝트에
            연결한 뒤 재배포하세요. (연결되면 이 경고가 사라집니다.)
          </p>
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

        <div style={{ marginTop: 18 }}>
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
