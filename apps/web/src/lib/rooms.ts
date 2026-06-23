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
}

/** What the GET endpoint returns: a room with hole cards redacted per-viewer. */
export interface RoomView extends Room {
  /** The viewer's own seat id (so the UI can highlight it), if known. */
  you?: string;
  legal?: LegalActions | null;
  /** Live blind-level clock (tournaments only). */
  clock?: TournamentClock | null;
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
  if (!res.ok) throw new Error((await safeErr(res)) || '방을 찾을 수 없습니다');
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

async function safeErr(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error ?? '';
  } catch {
    return '';
  }
}
