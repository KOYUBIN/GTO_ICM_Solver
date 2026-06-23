'use client';

import { useMemo, useState } from 'react';
import { cardToString, type TableState, type Action, type Seat } from '@gto/engine';
import type { RoomView } from '@/lib/rooms';

const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RED = new Set(['h', 'd']);

/** Render an engine Card (-1 = face down). */
function Card({ card, small }: { card: number; small?: boolean }) {
  const w = small ? 26 : 30;
  const h = small ? 36 : 42;
  if (card < 0) {
    return (
      <span
        className="playing-card"
        style={{
          width: w,
          height: h,
          background: 'linear-gradient(135deg,#2a3a55,#1a2030)',
          color: '#5a6a85',
          border: '1px solid #3a4a65',
        }}
      >
        ?
      </span>
    );
  }
  const str = cardToString(card);
  const rank = str[0];
  const suit = str[1];
  return (
    <span
      className={`playing-card${RED.has(suit) ? ' red' : ''}`}
      style={{ width: w, height: h }}
    >
      {rank}
      {SUIT_GLYPH[suit]}
    </span>
  );
}

function statusBadge(s: Seat['status']): { label: string; color: string } | null {
  switch (s) {
    case 'folded':
      return { label: '폴드', color: 'var(--danger)' };
    case 'allin':
      return { label: '올인', color: 'var(--warn)' };
    case 'sittingOut':
      return { label: '대기', color: 'var(--text-dim)' };
    default:
      return null;
  }
}

const STREET_KO: Record<string, string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

export function Table({
  room,
  youId,
  onAction,
  onDeal,
  onLeave,
}: {
  room: RoomView;
  youId: string;
  onAction: (a: Action) => void;
  onDeal: () => void;
  onLeave: () => void;
}) {
  const state = room.gameState;
  const isHost = room.hostId === youId;

  const potTotal = useMemo(() => {
    if (!state) return 0;
    return state.pots.reduce((a, p) => a + p.amount, 0);
  }, [state]);

  return (
    <div>
      <div className="row" style={{ alignItems: 'center', marginBottom: 16 }}>
        <div style={{ flex: 2 }}>
          <h1 style={{ marginBottom: 2 }}>{room.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            방 코드 <strong style={{ color: 'var(--accent)', letterSpacing: 2 }}>{room.id}</strong> ·{' '}
            {room.config.presetName} · {room.config.smallBlind}/{room.config.bigBlind}
            {room.config.ante ? ` (A${room.config.ante})` : ''} · {room.players.length}명
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flex: 1 }}>
          <button
            className="secondary"
            onClick={() => navigator.clipboard?.writeText(room.id)}
            title="방 코드 복사"
          >
            코드 복사
          </button>
          <button className="secondary" onClick={onLeave}>
            나가기
          </button>
        </div>
      </div>

      {!state ? (
        <Lobby room={room} isHost={isHost} onDeal={onDeal} />
      ) : (
        <>
          <Felt state={state} youId={youId} potTotal={potTotal} />
          <ActionBar
            state={state}
            youId={youId}
            legal={room.legal ?? null}
            onAction={onAction}
            isHost={isHost}
            onDeal={onDeal}
          />
          <HandLog log={state.log} />
        </>
      )}
    </div>
  );
}

function Lobby({
  room,
  isHost,
  onDeal,
}: {
  room: RoomView;
  isHost: boolean;
  onDeal: () => void;
}) {
  return (
    <div className="card">
      <h2>로비</h2>
      <p className="muted">아직 핸드가 시작되지 않았습니다. 친구들이 참가하면 호스트가 딜합니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '12px 0' }}>
        {room.players.map((p) => (
          <span key={p.id} className="pill" style={{ background: 'var(--bg-elevated)' }}>
            {p.name}
            {p.id === room.hostId ? ' 👑' : ''}
          </span>
        ))}
      </div>
      {isHost ? (
        <button onClick={onDeal} disabled={room.players.length < 2}>
          {room.players.length < 2 ? '플레이어 2명 이상 필요' : '딜 시작'}
        </button>
      ) : (
        <p className="muted">호스트가 게임을 시작하길 기다리는 중…</p>
      )}
    </div>
  );
}

function Felt({
  state,
  youId,
  potTotal,
}: {
  state: TableState;
  youId: string;
  potTotal: number;
}) {
  const toActId = state.toAct >= 0 ? state.seats[state.toAct]?.id : undefined;
  const winnerIds = new Set(state.winners.map((w) => w.seatId));

  return (
    <div
      className="card"
      style={{
        background: 'radial-gradient(ellipse at center, #14361f 0%, #0d2415 70%, #0a1a10 100%)',
        border: '2px solid #21492e',
        padding: 24,
      }}
    >
      {/* Board + pot in the center */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="muted" style={{ marginBottom: 6 }}>
          {STREET_KO[state.currentStreet]} · 팟 {potTotal.toLocaleString()}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, minHeight: 42 }}>
          {state.board.length === 0 ? (
            <span className="muted">— 보드 —</span>
          ) : (
            state.board.map((c, i) => <Card key={i} card={c} />)
          )}
        </div>
        {state.pots.length > 1 && (
          <div className="muted" style={{ marginTop: 8 }}>
            {state.pots.map((p, i) => `${i === 0 ? '메인' : `사이드${i}`} ${p.amount}`).join(' · ')}
          </div>
        )}
      </div>

      {/* Seats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {state.seats.map((seat, idx) => {
          const isYou = seat.id === youId;
          const isTurn = seat.id === toActId;
          const isButton = idx === state.button;
          const isWinner = winnerIds.has(seat.id);
          const badge = statusBadge(seat.status);
          return (
            <div
              key={seat.id}
              style={{
                background: isYou ? 'var(--bg-card)' : 'var(--bg-elevated)',
                border: `2px solid ${
                  isTurn ? 'var(--accent)' : isWinner ? 'var(--warn)' : 'var(--border)'
                }`,
                borderRadius: 10,
                padding: 12,
                opacity: seat.status === 'folded' ? 0.55 : 1,
                boxShadow: isTurn ? '0 0 0 2px rgba(63,185,80,0.25)' : undefined,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14 }}>
                  {seat.name}
                  {isYou ? ' (나)' : ''} {isButton ? '🔘' : ''}
                </strong>
                {badge && (
                  <span className="pill" style={{ color: badge.color, background: 'rgba(0,0,0,0.25)' }}>
                    {badge.label}
                  </span>
                )}
              </div>
              <div className="muted" style={{ margin: '4px 0' }}>
                스택 {seat.stack.toLocaleString()}
                {seat.committedThisStreet > 0 ? ` · 베팅 ${seat.committedThisStreet}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {seat.holeCards.length ? (
                  seat.holeCards.map((c, i) => <Card key={i} card={c} small />)
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>—</span>
                )}
              </div>
              {isWinner && (
                <div style={{ color: 'var(--warn)', fontSize: 12, marginTop: 4, fontWeight: 700 }}>
                  +{state.winners.filter((w) => w.seatId === seat.id).reduce((a, w) => a + w.amount, 0)}{' '}
                  {state.winners.find((w) => w.seatId === seat.id)?.hand}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
  youId: string;
  legal: RoomView['legal'];
  onAction: (a: Action) => void;
  isHost: boolean;
  onDeal: () => void;
}) {
  const myTurn = state.toAct >= 0 && state.seats[state.toAct]?.id === youId;
  const showdown = state.currentStreet === 'showdown' || !state.handInProgress;

  if (showdown) {
    return (
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="muted">핸드 종료.</span>
        {isHost ? (
          <button onClick={onDeal}>다음 핸드</button>
        ) : (
          <span className="muted">호스트가 다음 핸드를 딜하길 기다리는 중…</span>
        )}
      </div>
    );
  }

  if (!myTurn || !legal) {
    const who = state.toAct >= 0 ? state.seats[state.toAct]?.name : '';
    return (
      <div className="card">
        <span className="muted">{who ? `${who}의 차례입니다…` : '대기 중…'}</span>
      </div>
    );
  }

  return <MyActions legal={legal} onAction={onAction} />;
}

function MyActions({
  legal,
  onAction,
}: {
  legal: NonNullable<RoomView['legal']>;
  onAction: (a: Action) => void;
}) {
  const canRaise = legal.actions.includes('bet') || legal.actions.includes('raise');
  const [amount, setAmount] = useState(legal.minRaiseTo);

  // Keep the slider within the current legal window.
  const clamped = Math.min(Math.max(amount, legal.minRaiseTo), legal.maxRaiseTo);
  const raiseType: Action['type'] = legal.actions.includes('bet') ? 'bet' : 'raise';

  return (
    <div className="card" style={{ border: '2px solid var(--accent)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: canRaise ? 14 : 0 }}>
        {legal.actions.includes('fold') && (
          <button className="secondary" onClick={() => onAction({ type: 'fold' })}>
            폴드
          </button>
        )}
        {legal.actions.includes('check') && (
          <button className="secondary" onClick={() => onAction({ type: 'check' })}>
            체크
          </button>
        )}
        {legal.actions.includes('call') && (
          <button onClick={() => onAction({ type: 'call' })}>콜 {legal.callAmount.toLocaleString()}</button>
        )}
        {canRaise && (
          <button onClick={() => onAction({ type: raiseType, amount: clamped })}>
            {raiseType === 'bet' ? '벳' : '레이즈'} {clamped.toLocaleString()}
          </button>
        )}
        {legal.actions.includes('allin') && (
          <button
            onClick={() => onAction({ type: 'allin' })}
            style={{ background: 'var(--warn)' }}
          >
            올인 {legal.maxRaiseTo.toLocaleString()}
          </button>
        )}
      </div>

      {canRaise && legal.maxRaiseTo > legal.minRaiseTo && (
        <div>
          <label>
            베팅 사이즈: <strong>{clamped.toLocaleString()}</strong> (최소 {legal.minRaiseTo} / 최대{' '}
            {legal.maxRaiseTo})
          </label>
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={1}
            value={clamped}
            onChange={(e) => setAmount(+e.target.value)}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {[0.5, 0.75, 1].map((frac) => {
              const v = Math.round(legal.minRaiseTo + (legal.maxRaiseTo - legal.minRaiseTo) * frac);
              return (
                <button key={frac} className="secondary" onClick={() => setAmount(v)} style={{ padding: '5px 10px' }}>
                  {frac === 1 ? '맥스' : `${frac * 100}%`}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function HandLog({ log }: { log: string[] }) {
  if (!log.length) return null;
  return (
    <div className="card">
      <h2>핸드 로그</h2>
      <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 13, lineHeight: 1.7 }}>
        {log
          .slice()
          .reverse()
          .map((line, i) => (
            <div key={i} className="muted" style={{ borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
              {line}
            </div>
          ))}
      </div>
    </div>
  );
}
