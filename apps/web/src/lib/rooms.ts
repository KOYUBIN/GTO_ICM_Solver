/**
 * Room shared types + client-side fetch helpers.
 *
 * Types are shared by the server store (roomStore.ts) and the client UI; the
 * fetch helpers wrap the REST API under /api/rooms and are the only thing the
 * client imports (roomStore is server-only). Mirrors lib/community.ts.
 */

import type { TableState, LegalActions, Action, BlindLevel } from '@gto/engine';

export interface RoomPlayer {
  id: string;
  name: string;
  /** Seat index in the table; assigned on join. */
  seat: number;
}

/** How the table's blinds/stacks were configured. */
export interface RoomConfig {
  presetId: string; // 'classic' | ... | 'custom'
  presetName: string;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  levelMinutes: number;
  /** Blind-level ladder (tournament); a single level means fixed blinds. */
  levels?: BlindLevel[];
  /** Seconds a player has to act before being auto-checked/folded (0 = off). */
  actionTimeoutSec?: number;
  /** Auto-deal the next hand a few seconds after showdown. */
  autoNextHand?: boolean;
  /** Allow busted players to rebuy back to the starting stack (cash-style). */
  allowRebuy?: boolean;
  /** Rebuy stack size when it differs from the starting stack (e.g. 몬스터 리바이 300만). */
  rebuyStack?: number;
  /** Late-registration / rebuy cutoff level (1-based); rebuys close after this level. */
  lateRegLevel?: number;
  /** Show this table in the public lobby list (joinable without a code). */
  isPublic?: boolean;
}

/** One table-chat message (bounded ring buffer on the room). */
export interface ChatMsg {
  id: string;
  name: string;
  text: string;
  at: string; // ISO
}

/** Summary of a finished hand, kept on the room for the history panel. */
export interface HandRecord {
  handNumber: number;
  board: string; // e.g. "Ks7h2cQd3s" ('' on a preflop fold-around)
  pot: number;
  winners: { name: string; amount: number; hand: string }[];
  /** Hole cards revealed at showdown (empty on an uncontested win). */
  revealed: { name: string; cards: string }[];
  endedAt: string;
}

/** Sanitized lobby row for the public room list. */
export interface PublicRoomSummary {
  id: string;
  name: string;
  presetName: string;
  smallBlind: number;
  bigBlind: number;
  players: number;
  handNumber: number;
  updatedAt: string;
}

export interface Room {
  id: string; // short join code, e.g. "K3F9"
  name: string;
  hostId: string;
  players: RoomPlayer[];
  config: RoomConfig;
  /** The holdem table state JSON (null until the first hand is dealt). */
  gameState: TableState | null;
  /** ISO time the first hand was dealt — drives the blind clock. */
  startedAt?: string;
  /** ISO time the current player's turn began — drives the action timer. */
  actingSince?: string;
  /** ISO time the last hand ended — drives auto-advance to the next hand. */
  handEndedAt?: string;
  /** Ids of players who left; skipped on future deals. */
  left?: string[];
  /** Ids of busted/left players in elimination order (first out = first). */
  finishOrder?: string[];
  /** Times a rebuy was taken (for the prize-pool estimate). */
  rebuyCount?: number;
  /** Table chat, newest last (capped server-side). */
  chat?: ChatMsg[];
  /** Finished-hand records, newest last (capped server-side). */
  history?: HandRecord[];
  createdAt: string;
  updatedAt: string;
}

/** Live tournament-clock info computed server-side for the UI. */
export interface TournamentClock {
  level: number; // 1-based
  smallBlind: number;
  bigBlind: number;
  ante: number;
  levelMinutes: number;
  /** Seconds left in the current level (0 when no clock / cash). */
  secondsLeft: number;
  /** The next level's blinds, if any. */
  next?: { smallBlind: number; bigBlind: number; ante: number };
  isLastLevel: boolean;
  /** Late-registration cutoff level (1-based), if the structure sets one. */
  lateRegLevel?: number;
  /** True once the clock has passed the late-reg level (rebuys closed). */
  registrationClosed?: boolean;
}

/** What the GET endpoint returns: a room with hole cards redacted per-viewer. */
export interface RoomView extends Room {
  /** The viewer's own seat id (so the UI can highlight it), if known. */
  you?: string;
  legal?: LegalActions | null;
  /** Live blind-level clock (tournaments only). */
  clock?: TournamentClock | null;
  /** Epoch ms when the current actor times out (null when no timer running). */
  deadline?: number | null;
  /** Server clock (epoch ms) so the client can render a skew-free countdown. */
  serverNow?: number;
  /** True when only one player has chips left (tournament finished). */
  gameOver?: boolean;
  /** Name of the overall winner when gameOver. */
  overallWinner?: string;
  /** Final standings (place 1 = winner) when gameOver, with optional prize. */
  standings?: { place: number; name: string; prize?: number }[];
}

// ----- client fetch helpers -----

export async function createRoom(payload: {
  name: string;
  hostName: string;
  config: RoomConfig;
}): Promise<{ room: Room; playerId: string }> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '방 생성 실패');
  return res.json();
}

export async function joinRoom(
  id: string,
  name: string,
): Promise<{ room: Room; playerId: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '참가 실패');
  return res.json();
}

export async function fetchRoom(id: string, playerId?: string): Promise<RoomView> {
  const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}${qs}`, { cache: 'no-store' });
  if (!res.ok) {
    const err = new Error((await safeErr(res)) || '방을 찾을 수 없습니다');
    // Mark 404s so the client can drop a stale saved session instead of
    // polling a dead room forever.
    if (res.status === 404) err.name = 'RoomNotFound';
    throw err;
  }
  return res.json();
}

export async function startHandReq(id: string, playerId: string): Promise<RoomView> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '딜 실패');
  return res.json();
}

export async function leaveRoom(id: string, playerId: string): Promise<void> {
  await fetch(`/api/rooms/${encodeURIComponent(id)}/leave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId }),
  }).catch(() => {});
}

export async function rebuy(id: string, playerId: string): Promise<RoomView> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}/rebuy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '리바이 실패');
  return res.json();
}

export async function sendAction(
  id: string,
  playerId: string,
  action: Action,
): Promise<RoomView> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, action }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '액션 실패');
  return res.json();
}

export async function listPublicRooms(): Promise<PublicRoomSummary[]> {
  const res = await fetch('/api/rooms', { cache: 'no-store' });
  if (!res.ok) return [];
  const j = await res.json();
  return Array.isArray(j?.rooms) ? j.rooms : [];
}

export async function sendChat(id: string, playerId: string, text: string): Promise<void> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, text }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '메시지 전송 실패');
}

async function safeErr(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error ?? '';
  } catch {
    return '';
  }
}
