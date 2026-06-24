import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  cardToString,
  PRESET_LIST,
  getPreset,
  type Action,
  type BlindPreset,
  type Seat,
  type TableState,
} from '@gto/engine';
import {
  createRoom,
  fetchRoom,
  joinRoom,
  leaveRoom as leaveRoomReq,
  rebuy as rebuyReq,
  sendAction,
  startHandReq,
  type LegalView,
  type RoomConfig,
  type RoomView,
} from '../lib/rooms';
import { Card, styles } from '../components/ui';
import { theme } from '../theme';

const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RED = new Set(['h', 'd']);
const STREET_KO: Record<string, string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

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
    allowRebuy: p.isCash, // cash: rebuy on; tournaments: off
  };
}

export default function PlayScreen() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState('');

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

  // Poll the room ~1.5s while in a room.
  useEffect(() => {
    if (!roomId) return;
    poll();
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  }, [roomId, poll]);

  function enterRoom(id: string, pid: string) {
    setRoomId(id);
    setPlayerId(pid);
    setRoom(null);
  }
  function spectate(id: string) {
    setRoomId(id);
    setPlayerId(null);
    setRoom(null);
  }
  function leave() {
    if (roomId && playerId) leaveRoomReq(roomId, playerId); // fire-and-forget
    setRoomId(null);
    setPlayerId(null);
    setRoom(null);
  }

  async function onAction(action: Action) {
    if (!roomId || !playerId) return;
    try {
      setRoom(await sendAction(roomId, playerId, action));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function onDeal() {
    if (!roomId || !playerId) return;
    try {
      setRoom(await startHandReq(roomId, playerId));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function onRebuy() {
    if (!roomId || !playerId) return;
    try {
      setRoom(await rebuyReq(roomId, playerId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (roomId) {
    return (
      <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
        {error ? <Text style={{ color: theme.danger, marginBottom: 8 }}>{error}</Text> : null}
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
          <Text style={{ color: theme.dim }}>방 불러오는 중…</Text>
        )}
      </ScrollView>
    );
  }

  return <Landing onEnter={enterRoom} onSpectate={spectate} />;
}

// ---------- landing: create / join ----------

function Landing({
  onEnter,
  onSpectate,
}: {
  onEnter: (id: string, pid: string) => void;
  onSpectate: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [presetId, setPresetId] = useState('classic');
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({
    startingStack: '1500',
    smallBlind: '10',
    bigBlind: '20',
    ante: '0',
    actionTimeoutSec: '30',
  });
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function buildConfig(): RoomConfig {
    if (showCustom) {
      const num = (s: string, d: number) => {
        const n = Number(s);
        return Number.isFinite(n) ? n : d;
      };
      return {
        presetId: 'custom',
        presetName: '커스텀',
        startingStack: num(custom.startingStack, 1500),
        smallBlind: num(custom.smallBlind, 10),
        bigBlind: num(custom.bigBlind, 20),
        ante: num(custom.ante, 0),
        levelMinutes: 0,
        actionTimeoutSec: num(custom.actionTimeoutSec, 30),
        autoNextHand: true,
        allowRebuy: true,
      };
    }
    return presetToConfig(getPreset(presetId));
  }

  async function onCreate() {
    if (!name.trim()) {
      setError('이름을 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { room, playerId } = await createRoom({
        name: roomName.trim() || `${name.trim()}의 테이블`,
        hostName: name.trim(),
        config: buildConfig(),
      });
      onEnter(room.id, playerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onJoin() {
    if (!name.trim()) {
      setError('이름을 입력하세요.');
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
      onEnter(room.id, playerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.h1}>홀덤 — 친구들과 플레이</Text>
      <Text style={styles.sub}>
        방을 만들어 코드를 공유하면 친구들이 참가합니다. 프리셋을 고르거나 직접 설정하세요.
      </Text>

      <Card>
        <LabelInput label="닉네임" value={name} onChangeText={setName} placeholder="예: 철수" maxLength={16} />
      </Card>

      <Card>
        <Text style={sectionTitle}>방 만들기</Text>
        <LabelInput
          label="테이블 이름 (선택)"
          value={roomName}
          onChangeText={setRoomName}
          placeholder="예: 금요일 홈게임"
          maxLength={24}
        />

        <Text style={[fieldLabel, { marginTop: 12 }]}>블라인드 / 칩 프리셋</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PRESET_LIST.map((p) => {
            const lv = p.levels[0];
            const active = !showCustom && presetId === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                onPress={() => {
                  setShowCustom(false);
                  setPresetId(p.id.toString());
                }}
                style={[presetCard, active && { borderColor: theme.accent }]}
              >
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>{p.name}</Text>
                <Text style={presetMeta}>시작 {p.startingStack.toLocaleString()}</Text>
                <Text style={presetMeta}>
                  {lv.smallBlind}/{lv.bigBlind}
                  {lv.ante ? ` (A${lv.ante})` : ''}
                </Text>
                <Text style={presetMeta}>{p.isCash ? '캐시' : `${p.levelMinutes}분/레벨`}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={() => setShowCustom((v) => !v)}
          style={[secondaryBtn, { marginTop: 14, alignSelf: 'flex-start' }, showCustom && { borderColor: theme.accent }]}
        >
          <Text style={secondaryText}>상세 설정 {showCustom ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showCustom && (
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <LabelInput
                  label="시작 스택"
                  value={custom.startingStack}
                  onChangeText={(t) => setCustom({ ...custom, startingStack: t })}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <LabelInput
                  label="스몰블라인드"
                  value={custom.smallBlind}
                  onChangeText={(t) => setCustom({ ...custom, smallBlind: t })}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <LabelInput
                  label="빅블라인드"
                  value={custom.bigBlind}
                  onChangeText={(t) => setCustom({ ...custom, bigBlind: t })}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <LabelInput
                  label="앤티"
                  value={custom.ante}
                  onChangeText={(t) => setCustom({ ...custom, ante: t })}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <LabelInput
              label="액션 제한시간(초, 0=무제한)"
              value={custom.actionTimeoutSec}
              onChangeText={(t) => setCustom({ ...custom, actionTimeoutSec: t })}
              keyboardType="numeric"
            />
          </View>
        )}

        <TouchableOpacity onPress={onCreate} disabled={busy} style={[styles.button, { marginTop: 16 }]}>
          <Text style={styles.buttonText}>{busy ? '생성 중…' : '방 만들기'}</Text>
        </TouchableOpacity>
      </Card>

      <Card>
        <Text style={sectionTitle}>방 코드로 참가 / 관전</Text>
        <LabelInput
          label="방 코드"
          value={joinCode}
          onChangeText={(t) => setJoinCode(t.toUpperCase())}
          placeholder="예: K3F9"
          maxLength={4}
          autoCapitalize="characters"
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <TouchableOpacity onPress={onJoin} disabled={busy} style={[secondaryBtn, { flex: 1 }]}>
            <Text style={secondaryText}>참가</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => joinCode.trim() && onSpectate(joinCode.trim().toUpperCase())}
            disabled={!joinCode.trim()}
            style={[secondaryBtn, { flex: 1 }, !joinCode.trim() && { opacity: 0.5 }]}
          >
            <Text style={secondaryText}>관전</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: theme.dim, fontSize: 12, marginTop: 8 }}>
          관전은 좌석 없이 테이블을 구경합니다 (카드는 쇼다운 때 공개).
        </Text>
      </Card>

      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
    </ScrollView>
  );
}

// ---------- table ----------

function Table({
  room,
  youId,
  onAction,
  onDeal,
  onLeave,
  onRebuy,
}: {
  room: RoomView;
  youId: string | null;
  onAction: (a: Action) => void;
  onDeal: () => void;
  onLeave: () => void;
  onRebuy: () => void;
}) {
  const state = room.gameState;
  const isHost = !!youId && room.hostId === youId;
  const spectating = !youId;
  const mySeat = youId && state ? state.seats.find((s) => s.id === youId) : undefined;
  const canRebuy =
    !!room.config.allowRebuy && !!mySeat && mySeat.stack === 0 && mySeat.status !== 'empty';
  const potTotal = state ? state.pots.reduce((a, p) => a + p.amount, 0) : 0;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text style={styles.h1}>{room.name}</Text>
            {spectating ? (
              <Text style={[pill, { color: theme.blue }]}>관전 중</Text>
            ) : null}
          </View>
          <Text style={{ color: theme.dim, fontSize: 13 }}>
            방 코드 <Text style={{ color: theme.accent, fontWeight: '700', letterSpacing: 2 }}>{room.id}</Text> ·{' '}
            {room.config.presetName} · {room.config.smallBlind}/{room.config.bigBlind}
            {room.config.ante ? ` (A${room.config.ante})` : ''} · {room.players.length}명
          </Text>
        </View>
        <TouchableOpacity onPress={onLeave} style={secondaryBtn}>
          <Text style={secondaryText}>{spectating ? '관전 종료' : '나가기'}</Text>
        </TouchableOpacity>
      </View>

      {room.clock ? <ClockBar clock={room.clock} /> : null}

      {!state ? (
        <Lobby room={room} isHost={isHost} spectating={spectating} onDeal={onDeal} />
      ) : (
        <>
          <Felt state={state} youId={youId} potTotal={potTotal} />

          {canRebuy ? (
            <View style={[styles.card, { borderColor: theme.warn, borderWidth: 2 }]}>
              <Text style={{ color: theme.dim, marginBottom: 10 }}>
                칩이 떨어졌습니다. 리바이로 다음 핸드부터 다시 참가하세요.
              </Text>
              <TouchableOpacity onPress={onRebuy} style={[styles.button, { backgroundColor: theme.warn }]}>
                <Text style={styles.buttonText}>리바이 +{room.config.startingStack.toLocaleString()}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {room.gameOver ? (
            <View style={[styles.card, { borderColor: theme.warn, borderWidth: 2, alignItems: 'center' }]}>
              <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700', marginVertical: 4 }}>
                🏆 게임 종료
              </Text>
              <Text style={{ color: theme.text, marginBottom: 12 }}>
                우승: <Text style={{ color: theme.warn, fontWeight: '700', fontSize: 18 }}>{room.overallWinner ?? '—'}</Text>
              </Text>
              <TouchableOpacity onPress={onLeave} style={secondaryBtn}>
                <Text style={secondaryText}>{spectating ? '관전 종료' : '테이블 나가기'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {state.handInProgress && room.deadline && room.serverNow && room.config.actionTimeoutSec ? (
                <TurnTimer
                  deadline={room.deadline}
                  serverNow={room.serverNow}
                  total={room.config.actionTimeoutSec}
                  who={state.toAct >= 0 ? state.seats[state.toAct]?.name ?? '' : ''}
                />
              ) : null}
              {!spectating ? (
                <ActionBar
                  state={state}
                  youId={youId}
                  legal={room.legal ?? null}
                  onAction={onAction}
                  isHost={isHost}
                  onDeal={onDeal}
                />
              ) : (
                <View style={styles.card}>
                  <Text style={{ color: theme.dim }}>관전 모드입니다. 카드는 쇼다운 때 공개됩니다.</Text>
                </View>
              )}
            </>
          )}

          <HandLog log={state.log} />
        </>
      )}
    </View>
  );
}

// ---------- pieces ----------

function PlayingCard({ card, small }: { card: number; small?: boolean }) {
  const w = small ? 26 : 32;
  const h = small ? 36 : 44;
  if (card < 0) {
    return (
      <View
        style={{
          width: w,
          height: h,
          borderRadius: 4,
          backgroundColor: '#1f2a3d',
          borderColor: '#3a4a65',
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#5a6a85', fontWeight: '700' }}>?</Text>
      </View>
    );
  }
  const str = cardToString(card);
  const red = RED.has(str[1]);
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: 4,
        backgroundColor: '#f5f5f0',
        borderColor: theme.border,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: red ? '#c0392b' : '#1a1a1a', fontWeight: '700', fontSize: small ? 13 : 15 }}>
        {str[0]}
        {SUIT_GLYPH[str[1]]}
      </Text>
    </View>
  );
}

function statusBadge(s: Seat['status']): { label: string; color: string } | null {
  switch (s) {
    case 'folded':
      return { label: '폴드', color: theme.danger };
    case 'allin':
      return { label: '올인', color: theme.warn };
    case 'sittingOut':
      return { label: '대기', color: theme.dim };
    default:
      return null;
  }
}

function ClockBar({ clock }: { clock: NonNullable<RoomView['clock']> }) {
  const mm = Math.floor(clock.secondsLeft / 60);
  const ss = clock.secondsLeft % 60;
  return (
    <View style={[styles.card, { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }]}>
      <View>
        <Text style={clockLabel}>레벨</Text>
        <Text style={{ color: theme.text, fontWeight: '700', fontSize: 18 }}>Lv.{clock.level}</Text>
      </View>
      <View>
        <Text style={clockLabel}>블라인드</Text>
        <Text style={{ color: theme.text, fontWeight: '700' }}>
          {clock.smallBlind}/{clock.bigBlind}
          {clock.ante ? ` (A${clock.ante})` : ''}
        </Text>
      </View>
      {!clock.isLastLevel ? (
        <View>
          <Text style={clockLabel}>다음 레벨까지</Text>
          <Text style={{ color: clock.secondsLeft <= 30 ? theme.warn : theme.text, fontWeight: '700', fontSize: 18 }}>
            {mm}:{ss.toString().padStart(2, '0')}
          </Text>
        </View>
      ) : (
        <Text style={{ color: theme.dim, alignSelf: 'center' }}>최종 레벨</Text>
      )}
      {clock.next ? (
        <View>
          <Text style={clockLabel}>다음</Text>
          <Text style={{ color: theme.dim }}>
            {clock.next.smallBlind}/{clock.next.bigBlind}
            {clock.next.ante ? ` (A${clock.next.ante})` : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Lobby({
  room,
  isHost,
  spectating,
  onDeal,
}: {
  room: RoomView;
  isHost: boolean;
  spectating: boolean;
  onDeal: () => void;
}) {
  const tooFew = room.players.length < 2;
  return (
    <View style={styles.card}>
      <Text style={sectionTitle}>로비</Text>
      <Text style={{ color: theme.dim }}>
        아직 핸드가 시작되지 않았습니다. 친구들이 참가하면 호스트가 딜합니다.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }}>
        {room.players.map((p) => (
          <Text key={p.id} style={[pill, { color: theme.text }]}>
            {p.name}
            {p.id === room.hostId ? ' 👑' : ''}
          </Text>
        ))}
      </View>
      {spectating ? (
        <Text style={{ color: theme.dim }}>관전 중 — 호스트가 게임을 시작하길 기다립니다.</Text>
      ) : isHost ? (
        <TouchableOpacity
          onPress={onDeal}
          disabled={tooFew}
          style={[styles.button, tooFew && { opacity: 0.5 }]}
        >
          <Text style={styles.buttonText}>{tooFew ? '플레이어 2명 이상 필요' : '딜 시작'}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ color: theme.dim }}>호스트가 게임을 시작하길 기다리는 중…</Text>
      )}
    </View>
  );
}

function Felt({ state, youId, potTotal }: { state: TableState; youId: string | null; potTotal: number }) {
  const toActId = state.toAct >= 0 ? state.seats[state.toAct]?.id : undefined;
  const winnerIds = new Set(state.winners.map((w) => w.seatId));

  return (
    <View style={[styles.card, { backgroundColor: '#0d2415', borderColor: '#21492e', borderWidth: 2 }]}>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ color: theme.dim, marginBottom: 8 }}>
          {STREET_KO[state.currentStreet]} · 팟{' '}
          <Text style={{ color: theme.text, fontWeight: '700' }}>{potTotal.toLocaleString()}</Text>
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, minHeight: 44, alignItems: 'center' }}>
          {state.board.length === 0 ? (
            <Text style={{ color: theme.dim }}>— 보드 —</Text>
          ) : (
            state.board.map((c, i) => <PlayingCard key={`${i}-${c}`} card={c} />)
          )}
        </View>
        {state.pots.length > 1 ? (
          <Text style={{ color: theme.dim, marginTop: 8, fontSize: 12 }}>
            {state.pots.map((p, i) => `${i === 0 ? '메인' : `사이드${i}`} ${p.amount}`).join(' · ')}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {state.seats.map((seat, idx) => {
          if (seat.status === 'empty') return null;
          const isYou = !!youId && seat.id === youId;
          const isTurn = seat.id === toActId;
          const isButton = idx === state.button;
          const isWinner = winnerIds.has(seat.id);
          const badge = statusBadge(seat.status);
          const winAmt = state.winners.filter((w) => w.seatId === seat.id).reduce((a, w) => a + w.amount, 0);
          return (
            <View
              key={seat.id}
              style={{
                width: '47%',
                backgroundColor: isYou ? theme.card : theme.elevated,
                borderColor: isTurn ? theme.accent : isWinner ? theme.warn : theme.border,
                borderWidth: 2,
                borderRadius: 10,
                padding: 10,
                opacity: seat.status === 'folded' ? 0.55 : 1,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 13, flexShrink: 1 }}>
                  {seat.name}
                  {isYou ? ' (나)' : ''} {isButton ? '🔘' : ''}
                </Text>
                {badge ? <Text style={[pill, { color: badge.color }]}>{badge.label}</Text> : null}
              </View>
              <Text style={{ color: theme.dim, fontSize: 12, marginVertical: 4 }}>
                스택 {seat.stack.toLocaleString()}
                {seat.committedThisStreet > 0 ? ` · 베팅 ${seat.committedThisStreet}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {seat.holeCards.length ? (
                  seat.holeCards.map((c, i) => <PlayingCard key={`${i}-${c}`} card={c} small />)
                ) : (
                  <Text style={{ color: theme.dim, fontSize: 12 }}>—</Text>
                )}
              </View>
              {isWinner ? (
                <Text style={{ color: theme.warn, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                  +{winAmt} {state.winners.find((w) => w.seatId === seat.id)?.hand}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TurnTimer({
  deadline,
  serverNow,
  total,
  who,
}: {
  deadline: number;
  serverNow: number;
  total: number;
  who: string;
}) {
  const offset = useRef(serverNow - Date.now());
  const [now, setNow] = useState(Date.now() + offset.current);
  useEffect(() => {
    offset.current = serverNow - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset.current), 300);
    return () => clearInterval(t);
  }, []);
  const remainingMs = Math.max(0, deadline - now);
  const sec = Math.ceil(remainingMs / 1000);
  const pct = Math.max(0, Math.min(100, (remainingMs / (total * 1000)) * 100));
  const low = sec <= 8;
  return (
    <View style={[styles.card, { paddingVertical: 10 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: theme.dim }}>{who ? `${who} 차례` : '액션 대기'}</Text>
        <Text style={{ color: low ? theme.danger : theme.text, fontWeight: '700' }}>{sec}초</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.bg, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: low ? theme.danger : theme.accent }} />
      </View>
    </View>
  );
}

function ActionBar({
  state,
  youId,
  legal,
  onAction,
  isHost,
  onDeal,
}: {
  state: TableState;
  youId: string | null;
  legal: LegalView | null;
  onAction: (a: Action) => void;
  isHost: boolean;
  onDeal: () => void;
}) {
  const myTurn = !!youId && state.toAct >= 0 && state.seats[state.toAct]?.id === youId;
  const showdown = state.currentStreet === 'showdown' || !state.handInProgress;

  if (showdown) {
    return (
      <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }]}>
        <Text style={{ color: theme.dim }}>핸드 종료.</Text>
        {isHost ? (
          <TouchableOpacity onPress={onDeal} style={styles.button}>
            <Text style={styles.buttonText}>딜 / 다음 핸드</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ color: theme.dim }}>호스트가 다음 핸드를 딜하길 기다리는 중…</Text>
        )}
      </View>
    );
  }

  if (!myTurn || !legal) {
    const who = state.toAct >= 0 ? state.seats[state.toAct]?.name : '';
    return (
      <View style={styles.card}>
        <Text style={{ color: theme.dim }}>{who ? `${who}의 차례입니다…` : '대기 중…'}</Text>
      </View>
    );
  }

  return <MyActions legal={legal} onAction={onAction} bigBlind={state.bigBlind} />;
}

function MyActions({
  legal,
  onAction,
  bigBlind,
}: {
  legal: LegalView;
  onAction: (a: Action) => void;
  bigBlind: number;
}) {
  const canRaise = legal.actions.includes('bet') || legal.actions.includes('raise');
  const raiseType: Action['type'] = legal.actions.includes('bet') ? 'bet' : 'raise';
  const [amount, setAmount] = useState(legal.minRaiseTo);
  // Re-clamp whenever the legal range shifts (new street / poll).
  useEffect(() => {
    setAmount((a) => Math.min(Math.max(a, legal.minRaiseTo), legal.maxRaiseTo));
  }, [legal.minRaiseTo, legal.maxRaiseTo]);
  const clamped = Math.min(Math.max(amount, legal.minRaiseTo), legal.maxRaiseTo);
  const step = Math.max(1, bigBlind);
  const hasRange = canRaise && legal.maxRaiseTo > legal.minRaiseTo;

  return (
    <View style={[styles.card, { borderColor: theme.accent, borderWidth: 2 }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: hasRange ? 12 : 0 }}>
        {legal.actions.includes('fold') ? (
          <TouchableOpacity onPress={() => onAction({ type: 'fold' })} style={secondaryBtn}>
            <Text style={secondaryText}>폴드</Text>
          </TouchableOpacity>
        ) : null}
        {legal.actions.includes('check') ? (
          <TouchableOpacity onPress={() => onAction({ type: 'check' })} style={secondaryBtn}>
            <Text style={secondaryText}>체크</Text>
          </TouchableOpacity>
        ) : null}
        {legal.actions.includes('call') ? (
          <TouchableOpacity onPress={() => onAction({ type: 'call' })} style={[styles.button, btnPad]}>
            <Text style={styles.buttonText}>콜 {legal.callAmount.toLocaleString()}</Text>
          </TouchableOpacity>
        ) : null}
        {canRaise ? (
          <TouchableOpacity
            onPress={() => onAction({ type: raiseType, amount: clamped })}
            style={[styles.button, btnPad]}
          >
            <Text style={styles.buttonText}>
              {raiseType === 'bet' ? '벳' : '레이즈'} {clamped.toLocaleString()}
            </Text>
          </TouchableOpacity>
        ) : null}
        {legal.actions.includes('allin') ? (
          <TouchableOpacity
            onPress={() => onAction({ type: 'allin' })}
            style={[styles.button, btnPad, { backgroundColor: theme.warn }]}
          >
            <Text style={styles.buttonText}>올인 {legal.maxRaiseTo.toLocaleString()}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {hasRange ? (
        <View>
          <Text style={{ color: theme.dim, fontSize: 13, marginBottom: 8 }}>
            베팅 사이즈: <Text style={{ color: theme.text, fontWeight: '700' }}>{clamped.toLocaleString()}</Text> (최소{' '}
            {legal.minRaiseTo} / 최대 {legal.maxRaiseTo})
          </Text>
          {/* No native slider dep — use −/+ steppers (1 BB) plus fraction presets. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Stepper label="−" onPress={() => setAmount(Math.max(legal.minRaiseTo, clamped - step))} />
            <Track min={legal.minRaiseTo} max={legal.maxRaiseTo} value={clamped} />
            <Stepper label="+" onPress={() => setAmount(Math.min(legal.maxRaiseTo, clamped + step))} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {[0.25, 0.5, 0.75, 1].map((frac) => {
              const v = Math.round(legal.minRaiseTo + (legal.maxRaiseTo - legal.minRaiseTo) * frac);
              return (
                <TouchableOpacity key={frac} onPress={() => setAmount(v)} style={[secondaryBtn, { paddingVertical: 6 }]}>
                  <Text style={secondaryText}>{frac === 1 ? '맥스' : `${frac * 100}%`}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 38,
        height: 38,
        borderRadius: 8,
        borderColor: theme.border,
        borderWidth: 1,
        backgroundColor: theme.elevated,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function Track({ min, max, value }: { min: number; max: number; value: number }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.bg, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: theme.accent }} />
    </View>
  );
}

function HandLog({ log }: { log: string[] }) {
  if (!log.length) return null;
  const lines = log.slice(-10).reverse();
  return (
    <View style={styles.card}>
      <Text style={sectionTitle}>핸드 로그</Text>
      {lines.map((line, i) => (
        <Text
          key={i}
          style={{
            color: theme.dim,
            fontSize: 13,
            lineHeight: 20,
            borderBottomColor: theme.border,
            borderBottomWidth: 1,
            paddingVertical: 3,
          }}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

// ---------- small label+input (mobile Field renders its own wrapper; here we
// reuse the same input style but allow numeric keyboards / capitalization). ----------

function LabelInput({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.dim}
        autoCorrect={false}
        {...props}
        style={styles.input}
      />
    </View>
  );
}

// ---------- inline style objects ----------

const sectionTitle = { color: theme.text, fontSize: 17, fontWeight: '700' as const, marginBottom: 8 };
const fieldLabel = { color: theme.dim, fontSize: 13, marginBottom: 6, fontWeight: '500' as const };
const clockLabel = { color: theme.dim, fontSize: 12 };
const btnPad = { paddingHorizontal: 16 };

const secondaryBtn = {
  backgroundColor: theme.elevated,
  borderColor: theme.border,
  borderWidth: 1,
  borderRadius: 8,
  paddingVertical: 11,
  paddingHorizontal: 14,
  alignItems: 'center' as const,
};
const secondaryText = { color: theme.text, fontWeight: '700' as const, fontSize: 14 };

const pill = {
  backgroundColor: 'rgba(0,0,0,0.25)',
  borderRadius: 999,
  paddingHorizontal: 8,
  paddingVertical: 2,
  fontSize: 12,
  overflow: 'hidden' as const,
};

const presetCard = {
  width: '47%' as const,
  backgroundColor: theme.elevated,
  borderColor: theme.border,
  borderWidth: 1,
  borderRadius: 8,
  padding: 12,
};
const presetMeta = { color: theme.dim, fontSize: 12, marginTop: 2 };
