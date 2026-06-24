/**
 * Room types + REST helpers for the mobile PLAY screen.
 * Mirrors apps/web/src/lib/rooms.ts but talks to the absolute API base
 * (EXPO_PUBLIC_API_URL) like community.tsx does.
 */

import type { TableState, Action, BlindLevel } from '@gto/engine';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface RoomPlayer {
  id: string;
  name: string;
  seat: number;
}

export interface RoomConfig {
  presetId: string;
  presetName: string;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  levelMinutes: number;
  levels?: BlindLevel[];
  actionTimeoutSec?: number;
  autoNextHand?: boolean;
  allowRebuy?: boolean;
}

export interface Room {
  id: string; // 4-char join code
  name: string;
  hostId: string;
  players: RoomPlayer[];
  config: RoomConfig;
  gameState: TableState | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TournamentClock {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  levelMinutes?: number;
  secondsLeft: number;
  next?: { smallBlind: number; bigBlind: number; ante: number };
  isLastLevel: boolean;
}

/** Legal-action info the server attaches for the viewer's seat. */
export interface LegalView {
  actions: string[];
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface RoomView extends Room {
  you?: string;
  legal?: LegalView | null;
  clock?: TournamentClock | null;
  deadline?: number | null;
  serverNow?: number;
  gameOver?: boolean;
  overallWinner?: string;
}

// ----- fetch helpers -----

async function safeErr(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error ?? '';
  } catch {
    return '';
  }
}

export async function createRoom(payload: {
  name: string;
  hostName: string;
  config: RoomConfig;
}): Promise<{ room: Room; playerId: string }> {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '방 생성 실패');
  return res.json();
}

export async function joinRoom(id: string, name: string): Promise<{ room: Room; playerId: string }> {
  const res = await fetch(`${BASE}/api/rooms/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '참가 실패');
  return res.json();
}

export async function fetchRoom(id: string, playerId?: string): Promise<RoomView> {
  const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
  const res = await fetch(`${BASE}/api/rooms/${encodeURIComponent(id)}${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error((await safeErr(res)) || '방을 찾을 수 없습니다');
  return res.json();
}

export async function startHandReq(id: string, playerId: string): Promise<RoomView> {
  const res = await fetch(`${BASE}/api/rooms/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '딜 실패');
  return res.json();
}

export async function leaveRoom(id: string, playerId: string): Promise<void> {
  await fetch(`${BASE}/api/rooms/${encodeURIComponent(id)}/leave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId }),
  }).catch(() => {});
}

export async function rebuy(id: string, playerId: string): Promise<RoomView> {
  const res = await fetch(`${BASE}/api/rooms/${encodeURIComponent(id)}/rebuy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '리바이 실패');
  return res.json();
}

export async function sendAction(id: string, playerId: string, action: Action): Promise<RoomView> {
  const res = await fetch(`${BASE}/api/rooms/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, action }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || '액션 실패');
  return res.json();
}
