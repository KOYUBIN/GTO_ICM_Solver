'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRoom,
  joinRoom,
  fetchRoom,
  startHandReq,
  sendAction,
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

  // Poll the room ~1.5s while seated.
  useEffect(() => {
    if (!roomId) return;
    poll();
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  }, [roomId, poll]);

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

  if (roomId) {
    return (
      <div className="container">
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {room ? (
          <Table room={room} youId={playerId} onAction={onAction} onDeal={onDeal} onLeave={leave} />
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
  });
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(localStorage.getItem(LS_NAME) ?? '');
  }, []);

  function buildConfig(): RoomConfig {
    if (showCustom) {
      return {
        presetId: 'custom',
        presetName: '커스텀',
        startingStack: custom.startingStack,
        smallBlind: custom.smallBlind,
        bigBlind: custom.bigBlind,
        ante: custom.ante,
        levelMinutes: custom.levelMinutes,
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
