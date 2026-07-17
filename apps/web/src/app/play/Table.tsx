'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cardToString,
  evaluate7,
  categoryOf,
  type TableState,
  type Action,
  type Seat,
} from '@gto/engine';
import { sendChat, type RoomView } from '@/lib/rooms';
import { sfx, primeAudio } from './sounds';
import { HandResult } from './HandResult';

const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RED = new Set(['h', 'd']);

const RANK_KO = [
  '하이카드',
  '원 페어',
  '투 페어',
  '트리플',
  '스트레이트',
  '플러시',
  '풀하우스',
  '포카드',
  '스트레이트 플러시',
];

const STREET_KO: Record<string, string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

/** Render an engine Card (-1 = face down). */
function Card({ card, w = 34, deal }: { card: number; w?: number; deal?: boolean }) {
  const h = Math.round(w * 1.4);
  const cls = deal ? ' card-deal' : '';
  if (card < 0) {
    return (
      <span
        className={`playing-card card-back${cls}`}
        style={{ width: w, height: h, fontSize: Math.round(w * 0.5) }}
      >
        ◆
      </span>
    );
  }
  const str = cardToString(card);
  return (
    <span
      className={`playing-card suit-${str[1]}${cls}`}
      style={{ width: w, height: h, fontSize: Math.round(w * 0.48) }}
    >
      {str[0]}
      {SUIT_GLYPH[str[1]]}
    </span>
  );
}

/** Clock-synced "now" that follows the server clock. */
function useServerNow(serverNow?: number, tick = 250): number {
  const offset = useRef(0);
  useEffect(() => {
    if (serverNow) offset.current = serverNow - Date.now();
  }, [serverNow]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(t);
  }, [tick]);
  return now + offset.current;
}

/** Seat anchor points around the table ellipse; index 0 = bottom center (hero). */
function seatPositions(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const theta = Math.PI / 2 + (2 * Math.PI * i) / n; // start at bottom, go clockwise
    out.push({ x: 50 + 44 * Math.cos(theta), y: 50 + 41 * Math.sin(theta) });
  }
  return out;
}

const LS_SOUND = 'gto-play-sound';

/** Play short sound cues when the table state changes between polls. */
function useTableSounds(room: RoomView, youId: string | null, enabled: boolean) {
  const prev = useRef<{ toAct?: string; hand?: number; winners?: number; level?: number } | null>(null);
  useEffect(() => {
    const st = room.gameState;
    const toAct = st && st.toAct >= 0 ? st.seats[st.toAct]?.id : undefined;
    const hand = st?.handNumber;
    const winners = st?.winners.length ?? 0;
    const level = room.clock?.level;
    const p = prev.current;
    if (enabled && p) {
      if (level !== undefined && p.level !== undefined && level > p.level) sfx('levelup');
      if (hand !== undefined && p.hand !== undefined && hand > p.hand) sfx('deal');
      if (winners > 0 && (p.winners ?? 0) === 0) sfx('win');
      if (toAct !== p.toAct) {
        if (youId && toAct === youId) sfx('turn');
        else if (toAct) sfx('action');
      }
    }
    prev.current = { toAct, hand, winners, level };
  }, [room, youId, enabled]);
}

export function Table({
  room,
  youId,
  onAction,
  onDeal,
  onLeave,
  onRebuy,
  onMakeDeal,
}: {
  room: RoomView;
  youId: string | null; // null = spectator
  onAction: (a: Action) => void;
  onDeal: () => void;
  onLeave: () => void;
  onRebuy: () => void;
  onMakeDeal: (method: 'icm' | 'chip') => void;
}) {
  const state = room.gameState;
  const isHost = !!youId && room.hostId === youId;
  const spectating = !youId;
  const mySeat = youId && state ? state.seats.find((s) => s.id === youId) : undefined;
  const regClosed = !!room.clock?.registrationClosed;
  const bustedNoChips = !!mySeat && mySeat.stack === 0 && mySeat.status !== 'empty';
  const canRebuy = !!room.config.allowRebuy && bustedNoChips && !regClosed;
  const rebuyChips = room.config.rebuyStack ?? room.config.startingStack;

  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    setSoundOn(localStorage.getItem(LS_SOUND) === '1');
  }, []);
  function toggleSound() {
    primeAudio();
    setSoundOn((v) => {
      const next = !v;
      localStorage.setItem(LS_SOUND, next ? '1' : '0');
      return next;
    });
  }
  useTableSounds(room, youId, soundOn);

  return (
    <div>
      <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: 2 }}>
          <h1 style={{ marginBottom: 2, fontSize: 22 }}>
            {room.name}
            {spectating && (
              <span className="pill" style={{ marginLeft: 10, background: 'var(--bg-elevated)', color: 'var(--blue)' }}>
                관전 중
              </span>
            )}
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            방 코드 <strong style={{ color: 'var(--accent)', letterSpacing: 2 }}>{room.id}</strong> ·{' '}
            {room.config.presetName} · {room.config.smallBlind}/{room.config.bigBlind}
            {room.config.ante ? ` (A${room.config.ante})` : ''} · {room.players.length}명
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flex: 1 }}>
          <button className="secondary" onClick={toggleSound} title="소리 켜기/끄기">
            {soundOn ? '🔊' : '🔇'}
          </button>
          <button className="secondary" onClick={() => navigator.clipboard?.writeText(room.id)} title="방 코드 복사">
            코드 복사
          </button>
          <button className="secondary" onClick={onLeave}>
            {spectating ? '관전 종료' : '나가기'}
          </button>
        </div>
      </div>

      {room.clock && <ClockBar clock={room.clock} />}

      {!state ? (
        <Lobby room={room} isHost={isHost} spectating={spectating} onDeal={onDeal} />
      ) : (
        <>
          <Felt room={room} state={state} youId={youId} />
          <HandResult state={state} youId={youId} />
          {canRebuy && (
            <div
              className="card"
              style={{ border: '2px solid var(--warn)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            >
              <span className="muted">칩이 떨어졌습니다. 리바이로 다음 핸드부터 다시 참가하세요.</span>
              <button onClick={onRebuy} style={{ background: 'var(--warn)' }}>
                리바이 +{rebuyChips.toLocaleString()}
              </button>
            </div>
          )}
          {room.config.allowRebuy && bustedNoChips && regClosed && (
            <div
              className="card"
              style={{ border: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            >
              <span className="muted">
                레지 마감 ({room.clock?.lateRegLevel}레벨 종료) — 더 이상 리바이할 수 없습니다.
              </span>
            </div>
          )}
          {!room.gameOver && room.canDeal && room.dealPreview && (
            <DealPanel preview={room.dealPreview} isHost={isHost} onMakeDeal={onMakeDeal} />
          )}
          {room.gameOver ? (
            <div className="card" style={{ border: '2px solid var(--warn)' }}>
              <h2 style={{ margin: '4px 0', textAlign: 'center' }}>🏆 게임 종료</h2>
              <p style={{ margin: '4px 0 12px', textAlign: 'center' }}>
                우승: <strong style={{ color: 'var(--warn)', fontSize: 18 }}>{room.overallWinner ?? '—'}</strong>
              </p>
              {room.standings && room.standings.length > 0 && (
                <div className="table-scroll" style={{ marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px 6px 0' }}>순위</th>
                        <th style={{ padding: '6px 8px' }}>플레이어</th>
                        {room.standings.some((s) => s.prize != null) && (
                          <th style={{ padding: '6px 0 6px 8px', textAlign: 'right' }}>예상 상금</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {room.standings.map((s) => (
                        <tr key={s.place} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 8px 8px 0', fontWeight: 700 }}>
                            {s.place === 1 ? '🥇 1위' : s.place === 2 ? '🥈 2위' : s.place === 3 ? '🥉 3위' : `${s.place}위`}
                          </td>
                          <td style={{ padding: '8px' }}>{s.name}</td>
                          {room.standings!.some((x) => x.prize != null) && (
                            <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', fontWeight: 700 }}>
                              {s.prize != null ? `${Math.round(s.prize).toLocaleString('ko-KR')}원` : '—'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ textAlign: 'center' }}>
                <button className="secondary" onClick={onLeave}>
                  {spectating ? '관전 종료' : '테이블 나가기'}
                </button>
              </div>
            </div>
          ) : spectating ? (
            <div className="card">
              <span className="muted">관전 모드입니다. 카드는 쇼다운 때 공개됩니다.</span>
            </div>
          ) : (
            <ActionBar
              state={state}
              youId={youId}
              legal={room.legal ?? null}
              onAction={(a) => {
                primeAudio();
                onAction(a);
              }}
              isHost={isHost}
              onDeal={onDeal}
            />
          )}
          <ChatPanel room={room} youId={youId} />
          <HandHistory room={room} />
          <HandLog log={state.log} />
        </>
      )}
    </div>
  );
}

// ---------- table chat ----------

const QUICK_EMOTES = ['👍', '😂', '😭', '🔥', '🙏', 'GG', '나이스핸드', 'ㅋㅋㅋ'];

function ChatPanel({ room, youId }: { room: RoomView; youId: string | null }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const msgs = room.chat ?? [];

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  async function send(t: string) {
    if (!youId || !t.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      await sendChat(room.id, youId, t);
      setText('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>💬 채팅</h2>
      <div
        ref={listRef}
        style={{ maxHeight: 160, overflowY: 'auto', fontSize: 13, lineHeight: 1.7, marginBottom: 10 }}
      >
        {msgs.length === 0 && <span className="muted">아직 메시지가 없습니다.</span>}
        {msgs.map((m) => (
          <div key={m.id}>
            <strong style={{ color: 'var(--blue)' }}>{m.name}</strong>{' '}
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      {youId ? (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {QUICK_EMOTES.map((e) => (
              <button
                key={e}
                className="secondary"
                onClick={() => send(e)}
                disabled={busy}
                style={{ padding: '4px 10px', fontSize: 14 }}
              >
                {e}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={text}
              maxLength={200}
              placeholder="메시지 입력…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send(text);
              }}
            />
            <button onClick={() => send(text)} disabled={busy || !text.trim()} style={{ flex: '0 0 auto' }}>
              전송
            </button>
          </div>
          {err && (
            <p className="muted" style={{ color: 'var(--danger)', marginTop: 6, fontSize: 12 }}>
              {err}
            </p>
          )}
        </>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>관전 중에는 채팅을 읽을 수만 있습니다.</p>
      )}
    </div>
  );
}

// ---------- hand history ----------

function HandHistory({ room }: { room: RoomView }) {
  const hist = room.history ?? [];
  if (!hist.length) return null;

  // Session stats from the recorded hands: wins and chips collected per player.
  const stats = new Map<string, { wins: number; won: number }>();
  for (const h of hist) {
    for (const w of h.winners) {
      const s = stats.get(w.name) ?? { wins: 0, won: 0 };
      s.wins += 1;
      s.won += w.amount;
      stats.set(w.name, s);
    }
  }
  const ranked = [...stats.entries()].sort((a, b) => b[1].won - a[1].won);

  /** Open a showdown hand in the /replay street-equity analyzer. */
  function analyze(h: NonNullable<RoomView['history']>[number]) {
    const cards: string[] = [];
    for (const r of h.revealed.slice(0, 2)) {
      const cs = r.cards.match(/.{2}/g) ?? [];
      cards.push(...cs.slice(0, 2));
    }
    for (const cs of h.board.match(/.{2}/g) ?? []) cards.push(cs);
    try {
      sessionStorage.setItem(
        'replayPrefill',
        JSON.stringify({ title: `${room.name} · 핸드 #${h.handNumber}`, pot: String(h.pot), cards }),
      );
    } catch {
      /* ignore */
    }
    window.open('/replay?from=history', '_blank');
  }

  return (
    <div className="card">
      <h2>🕘 지난 핸드</h2>
      {ranked.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {ranked.map(([name, s], i) => (
            <span key={name} className="pill" style={{ background: 'var(--bg-elevated)' }}>
              {i === 0 ? '👑 ' : ''}
              {name} {s.wins}승 · +{s.won.toLocaleString()}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
        {[...hist].reverse().map((h) => (
          <div
            key={h.handNumber}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <span>
                <strong>#{h.handNumber}</strong>{' '}
                {h.winners.map((w) => `${w.name} +${w.amount.toLocaleString()}`).join(' · ')}
                <span className="muted"> ({h.winners[0]?.hand === 'uncontested' ? '폴드 승' : h.winners[0]?.hand})</span>
              </span>
              <span className="muted">팟 {h.pot.toLocaleString()}</span>
            </div>
            {h.board && (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', gap: 3 }}>
                  {(h.board.match(/.{2}/g) ?? []).map((cs, i) => {
                    const red = cs[1] === 'h' || cs[1] === 'd';
                    return (
                      <span key={i} className={`playing-card suit-${cs[1]}`} style={{ width: 24, height: 34, fontSize: 12 }}>
                        {cs[0].toUpperCase()}
                        {SUIT_GLYPH[cs[1]]}
                      </span>
                    );
                  })}
                </span>
                {h.revealed.length >= 2 && (
                  <>
                    <span className="muted" style={{ fontSize: 12 }}>
                      쇼다운: {h.revealed.map((r) => `${r.name} ${r.cards}`).join(' vs ')}
                    </span>
                    <button
                      className="secondary"
                      onClick={() => analyze(h)}
                      style={{ padding: '3px 10px', fontSize: 12 }}
                    >
                      에쿼티 분석
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- the table itself ----------

function Felt({ room, state, youId }: { room: RoomView; state: TableState; youId: string | null }) {
  const now = useServerNow(room.serverNow);
  const seats = state.seats.filter((s) => s.status !== 'empty');
  const n = seats.length;

  // Rotate so the viewer (or seat 0 for spectators) sits bottom-center.
  const heroIdx = youId ? seats.findIndex((s) => s.id === youId) : 0;
  const ordered = heroIdx > 0 ? [...seats.slice(heroIdx), ...seats.slice(0, heroIdx)] : seats;
  const pos = seatPositions(Math.max(n, 2));

  const toActId = state.toAct >= 0 ? state.seats[state.toAct]?.id : undefined;
  const winnerIds = new Set(state.winners.map((w) => w.seatId));
  const buttonId = state.seats[state.button]?.id;
  const potTotal = state.pots.reduce((a, p) => a + p.amount, 0);
  const timeout = room.config.actionTimeoutSec ?? 0;
  const timerPct =
    room.deadline && timeout > 0 && state.handInProgress
      ? Math.max(0, Math.min(1, (room.deadline - now) / (timeout * 1000)))
      : null;

  return (
    <div className="poker-rail">
      <div className="poker-felt">
        {/* Center: street, board, pot */}
        <div className="board-center">
          <div className="pot-label">
            {STREET_KO[state.currentStreet]} · 팟{' '}
            <span key={potTotal} className="pot-bump" style={{ fontWeight: 800 }}>
              {potTotal.toLocaleString()}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', minHeight: 52 }}>
            {state.board.map((c, i) => (
              <Card key={`${i}-${c}`} card={c} w={38} deal />
            ))}
          </div>
          {state.pots.length > 1 && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {state.pots.map((p, i) => `${i === 0 ? '메인' : `사이드${i}`} ${p.amount.toLocaleString()}`).join(' · ')}
            </div>
          )}
        </div>

        {ordered.map((seat, i) => {
          const p = pos[i] ?? { x: 50, y: 50 };
          const isYou = !!youId && seat.id === youId;
          const isTurn = seat.id === toActId && state.handInProgress;
          const isWinner = winnerIds.has(seat.id);
          const folded = seat.status === 'folded';
          const won = state.winners.filter((w) => w.seatId === seat.id).reduce((a, w) => a + w.amount, 0);
          // Bet chips sit between the seat and the table center.
          const bx = p.x + (50 - p.x) * 0.42;
          const by = p.y + (50 - p.y) * 0.42;
          return (
            <div key={seat.id}>
              {seat.committedThisStreet > 0 && (
                <div className="bet-chip" style={{ left: `${bx}%`, top: `${by}%` }}>
                  <span className="chip-disc" />
                  {seat.committedThisStreet.toLocaleString()}
                </div>
              )}
              <div
                className={`pseat${isTurn ? ' pseat-turn' : ''}${isWinner ? ' pseat-winner' : ''}${folded ? ' pseat-folded' : ''}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                {seat.lastAction && state.handInProgress && (
                  <div className={`action-bubble${/폴드/.test(seat.lastAction) ? ' bubble-fold' : /레이즈|벳|올인/.test(seat.lastAction) ? ' bubble-raise' : ''}`}>
                    {seat.lastAction}
                  </div>
                )}
                <div className="pseat-top">
                  <div className="pseat-avatar-wrap">
                    {isTurn && timerPct != null && (
                      <svg className="turn-ring" viewBox="0 0 56 56">
                        <circle cx="28" cy="28" r="25" className="turn-ring-bg" />
                        <circle
                          cx="28"
                          cy="28"
                          r="25"
                          className="turn-ring-fg"
                          style={{
                            strokeDashoffset: 157 * (1 - timerPct),
                            stroke: timerPct < 0.3 ? 'var(--danger)' : 'var(--accent)',
                          }}
                        />
                      </svg>
                    )}
                    <div className="pseat-avatar" style={{ background: avatarColor(seat.name) }}>
                      {(seat.name || '?').slice(0, 1).toUpperCase()}
                    </div>
                    {seat.id === buttonId && <div className="dealer-btn dealer-inseat">D</div>}
                  </div>
                  <div className="pseat-cards">
                    {seat.holeCards.length > 0 &&
                      !folded &&
                      seat.holeCards.map((c, ci) => <Card key={`${ci}-${c}`} card={c} w={isYou ? 34 : 26} deal />)}
                  </div>
                </div>
                <div className="pseat-plate">
                  <div className="pseat-name">
                    {seat.name}
                    {isYou ? ' (나)' : ''}
                    {seat.status === 'allin' && <span className="pill-allin">올인</span>}
                  </div>
                  <div className="pseat-stack">{seat.stack.toLocaleString()}</div>
                </div>
                {isWinner && won > 0 && <div className="win-float">+{won.toLocaleString()}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function avatarColor(name: string): string {
  const palette = ['#7c5cff', '#0ea5e9', '#f97316', '#ec4899', '#14b8a6', '#eab308', '#8b5cf6', '#22c55e', '#ef4444'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

// ---------- action bar ----------

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
  legal: RoomView['legal'];
  onAction: (a: Action) => void;
  isHost: boolean;
  onDeal: () => void;
}) {
  const myTurn = !!youId && state.toAct >= 0 && state.seats[state.toAct]?.id === youId;
  const over = state.currentStreet === 'showdown' || !state.handInProgress;
  const me = youId ? state.seats.find((s) => s.id === youId) : undefined;

  // Pre-select an action while waiting (commercial-style 체크/폴드 · 콜 예약).
  const [preSel, setPreSel] = useState<null | 'checkfold' | 'call'>(null);
  useEffect(() => {
    if (!state.handInProgress) setPreSel(null);
  }, [state.handInProgress, state.handNumber]);
  useEffect(() => {
    if (!preSel || !myTurn || !legal || !legal.actions.length) return;
    const sel = preSel;
    setPreSel(null);
    if (sel === 'checkfold') {
      onAction({ type: legal.actions.includes('check') ? 'check' : 'fold' });
    } else {
      if (legal.actions.includes('call')) onAction({ type: 'call' });
      else if (legal.actions.includes('check')) onAction({ type: 'check' });
      else setPreSel(null); // e.g. must fold/raise — don't auto-act
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSel, myTurn, legal]);

  // Hero hand-rank badge (evaluate over hole + board; works from 2 to 7 cards).
  const rank = useMemo(() => {
    if (!me || me.holeCards.length !== 2 || me.holeCards.some((c) => c < 0)) return null;
    if (me.status === 'folded') return null;
    try {
      return RANK_KO[categoryOf(evaluate7([...me.holeCards, ...state.board]))];
    } catch {
      return null;
    }
  }, [me, state.board]);

  if (over) {
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
    const canPre = !!me && me.status === 'active';
    return (
      <div className="card actionbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className="muted">{who ? `${who}의 차례입니다…` : '대기 중…'}</span>
          {rank && <span className="rank-badge">{rank}</span>}
          {canPre && (
            <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button
                className={`secondary presel${preSel === 'checkfold' ? ' presel-on' : ''}`}
                onClick={() => setPreSel(preSel === 'checkfold' ? null : 'checkfold')}
              >
                체크/폴드 예약
              </button>
              <button
                className={`secondary presel${preSel === 'call' ? ' presel-on' : ''}`}
                onClick={() => setPreSel(preSel === 'call' ? null : 'call')}
              >
                콜 예약
              </button>
            </span>
          )}
        </div>
      </div>
    );
  }

  return <MyActions state={state} legal={legal} onAction={onAction} rank={rank} />;
}

function MyActions({
  state,
  legal,
  onAction,
  rank,
}: {
  state: TableState;
  legal: NonNullable<RoomView['legal']>;
  onAction: (a: Action) => void;
  rank: string | null;
}) {
  const canRaise = legal.actions.includes('bet') || legal.actions.includes('raise');
  const raiseType: Action['type'] = legal.actions.includes('bet') ? 'bet' : 'raise';
  const [amount, setAmount] = useState(legal.minRaiseTo);
  useEffect(() => setAmount(legal.minRaiseTo), [legal.minRaiseTo]);
  const clamped = Math.min(Math.max(amount, legal.minRaiseTo), legal.maxRaiseTo);

  const pot = state.pots.reduce((a, p) => a + p.amount, 0);
  const toCall = legal.callAmount;
  // Pot-fraction raise-to: currentBet + f * (pot after our call).
  const fracTo = (f: number) =>
    Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(state.currentBet + f * (pot + toCall))));

  const presets: { label: string; to: number }[] = [
    { label: '최소', to: legal.minRaiseTo },
    { label: '⅓팟', to: fracTo(1 / 3) },
    { label: '½팟', to: fracTo(1 / 2) },
    { label: '⅔팟', to: fracTo(2 / 3) },
    { label: '팟', to: fracTo(1) },
    { label: '올인', to: legal.maxRaiseTo },
  ];

  return (
    <div className="card actionbar actionbar-live">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ color: 'var(--accent)' }}>내 차례</strong>
        {rank && <span className="rank-badge">{rank}</span>}
      </div>
      <div className="action-buttons">
        {legal.actions.includes('fold') && (
          <button className="btn-fold" onClick={() => onAction({ type: 'fold' })}>
            폴드
          </button>
        )}
        {legal.actions.includes('check') && (
          <button className="btn-check" onClick={() => onAction({ type: 'check' })}>
            체크
          </button>
        )}
        {legal.actions.includes('call') && (
          <button className="btn-call" onClick={() => onAction({ type: 'call' })}>
            콜 {legal.callAmount.toLocaleString()}
          </button>
        )}
        {canRaise && (
          <button className="btn-raise" onClick={() => onAction({ type: raiseType, amount: clamped })}>
            {raiseType === 'bet' ? '벳' : '레이즈'} {clamped.toLocaleString()}
          </button>
        )}
        {legal.actions.includes('allin') && !canRaise && (
          <button className="btn-raise" onClick={() => onAction({ type: 'allin' })}>
            올인 {legal.maxRaiseTo.toLocaleString()}
          </button>
        )}
      </div>

      {canRaise && legal.maxRaiseTo > legal.minRaiseTo && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {presets.map((p) => (
              <button
                key={p.label}
                className={`secondary preset${clamped === p.to ? ' preset-on' : ''}`}
                onClick={() => setAmount(p.to)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={1}
            value={clamped}
            onChange={(e) => setAmount(+e.target.value)}
            style={{ width: '100%' }}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {legal.minRaiseTo.toLocaleString()} ~ {legal.maxRaiseTo.toLocaleString()} · 선택:{' '}
            <strong style={{ color: 'var(--text)' }}>{clamped.toLocaleString()}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- misc panels ----------

function DealPanel({
  preview,
  isHost,
  onMakeDeal,
}: {
  preview: NonNullable<RoomView['dealPreview']>;
  isHost: boolean;
  onMakeDeal: (method: 'icm' | 'chip') => void;
}) {
  const fmt = (x: number) => `${Math.round(x).toLocaleString('ko-KR')}원`;
  return (
    <div className="card" style={{ border: '2px solid var(--accent, #58a6ff)' }}>
      <h3 style={{ margin: '2px 0 6px' }}>🤝 파이널 딜 (상금 나누기)</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        남은 {preview.ids.length}명이 지금 딜하면 각자 받는 금액입니다. 총 상금 {fmt(preview.pool)} ·
        칩찹(칩 비율) vs ICM(생존 가치) 중 선택.
      </p>
      <div className="table-scroll">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px 6px 0' }}>플레이어</th>
              <th style={{ padding: '6px 8px' }}>스택</th>
              <th style={{ padding: '6px 8px' }}>칩찹</th>
              <th style={{ padding: '6px 0 6px 8px' }}>ICM</th>
            </tr>
          </thead>
          <tbody>
            {preview.names.map((name, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                <td style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 600 }}>{name}</td>
                <td style={{ padding: '8px' }}>{preview.stacks[i].toLocaleString('ko-KR')}</td>
                <td style={{ padding: '8px' }}>{fmt(preview.chip[i])}</td>
                <td style={{ padding: '8px 0 8px 8px', fontWeight: 700 }}>{fmt(preview.icm[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isHost ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => onMakeDeal('chip')}>칩찹으로 종료</button>
          <button onClick={() => onMakeDeal('icm')}>ICM으로 종료</button>
          <span className="muted" style={{ alignSelf: 'center' }}>
            종료하면 게임이 끝나고 최종 순위·상금이 확정됩니다.
          </span>
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
          방장이 딜을 확정하면 게임이 종료됩니다.
        </p>
      )}
    </div>
  );
}

function ClockBar({ clock }: { clock: NonNullable<RoomView['clock']> }) {
  const mm = Math.floor(clock.secondsLeft / 60);
  const ss = clock.secondsLeft % 60;
  return (
    <div className="clock-bar">
      <div>
        <div className="muted" style={{ fontSize: 12 }}>레벨</div>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Lv.{clock.level}</div>
      </div>
      <div>
        <div className="muted" style={{ fontSize: 12 }}>블라인드</div>
        <div style={{ fontWeight: 700 }}>
          {clock.smallBlind}/{clock.bigBlind}
          {clock.ante ? ` (A${clock.ante})` : ''}
        </div>
      </div>
      {!clock.isLastLevel && (
        <div>
          <div className="muted" style={{ fontSize: 12 }}>다음 레벨까지</div>
          <div className="clock-time" style={{ color: clock.secondsLeft <= 30 ? 'var(--warn)' : 'var(--text)' }}>
            {mm}:{ss.toString().padStart(2, '0')}
          </div>
        </div>
      )}
      {clock.next && (
        <div>
          <div className="muted" style={{ fontSize: 12 }}>다음</div>
          <div className="muted">
            {clock.next.smallBlind}/{clock.next.bigBlind}
            {clock.next.ante ? ` (A${clock.next.ante})` : ''}
          </div>
        </div>
      )}
      {clock.isLastLevel && <div className="muted">최종 레벨</div>}
      {clock.lateRegLevel != null && (
        <div>
          <div className="muted" style={{ fontSize: 12 }}>레지</div>
          <div
            style={{ fontWeight: 700, color: clock.registrationClosed ? 'var(--text-dim)' : 'var(--good, #3fb950)' }}
          >
            {clock.registrationClosed ? '마감' : `L${clock.lateRegLevel}까지`}
          </div>
        </div>
      )}
    </div>
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
      {spectating ? (
        <p className="muted">관전 중 — 호스트가 게임을 시작하길 기다립니다.</p>
      ) : isHost ? (
        <button onClick={onDeal} disabled={room.players.length < 2}>
          {room.players.length < 2 ? '플레이어 2명 이상 필요' : '딜 시작'}
        </button>
      ) : (
        <p className="muted">호스트가 게임을 시작하길 기다리는 중…</p>
      )}
    </div>
  );
}

function HandLog({ log }: { log: string[] }) {
  if (!log.length) return null;
  return (
    <div className="card">
      <h2>핸드 로그</h2>
      <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 13, lineHeight: 1.7 }}>
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
