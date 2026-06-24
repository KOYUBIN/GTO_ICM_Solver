/**
 * Room store (server-only).
 *
 * Holds multiplayer Hold'em tables. Like the community store it is pluggable:
 * Postgres when POSTGRES_URL is set (cross-instance, the only thing that works
 * reliably on Vercel serverless), otherwise an in-memory/file fallback that is
 * fine for a single long-lived server or local dev.
 *
 * All game mutations (start a hand, apply an action) run through the @gto/engine
 * holdem state machine here, so the server is authoritative — clients only poll
 * and render. The engine state is stored as JSON (JSONB in Postgres).
 *
 * SERVERLESS CAVEAT: the file/memory backend is per-instance and ephemeral.
 * With multiple Vercel lambdas, two players can land on different instances and
 * see divergent state. For real multiplayer set POSTGRES_URL so all instances
 * share one row per room.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { sql } from '@vercel/postgres';
import {
  createGame,
  startHand,
  applyAction,
  forfeit,
  redactFor,
  legalActions,
  getPreset,
  type TableState,
  type Action,
  type BlindLevel,
} from '@gto/engine';
import type { Room, RoomConfig, RoomView, TournamentClock } from './rooms';

const usePg = !!process.env.POSTGRES_URL;
export const ROOM_STORE_BACKEND = usePg ? 'postgres' : 'file';

// ---------- shared logic over a raw Room ----------

function genCode(): string {
  // 4-char A-Z/2-9 code (no 0/1/O/I to avoid confusion).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function genId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Resolve the blind-level ladder for a config (preset ladder or single level). */
function resolveLevels(config: RoomConfig): BlindLevel[] {
  if (config.levels && config.levels.length) return config.levels;
  if (config.presetId && config.presetId !== 'custom') {
    return getPreset(config.presetId).levels;
  }
  return [{ level: 1, smallBlind: config.smallBlind, bigBlind: config.bigBlind, ante: config.ante }];
}

function newRoom(name: string, hostName: string, config: RoomConfig): { room: Room; playerId: string } {
  const hostId = genId('u');
  const now = new Date().toISOString();
  const room: Room = {
    id: genCode(),
    name: name || '홀덤 테이블',
    hostId,
    players: [{ id: hostId, name: hostName || '호스트', seat: 0 }],
    config: {
      ...config,
      levels: resolveLevels(config),
      actionTimeoutSec: config.actionTimeoutSec ?? 30,
      autoNextHand: config.autoNextHand ?? true,
      allowRebuy: config.allowRebuy ?? true,
    },
    gameState: null,
    createdAt: now,
    updatedAt: now,
  };
  return { room, playerId: hostId };
}

/** Current 0-based blind level from elapsed time (clamped). 0 for cash. */
function currentLevelIndex(room: Room): number {
  const lvls = room.config.levels ?? [];
  if (lvls.length <= 1 || room.config.levelMinutes <= 0 || !room.startedAt) return 0;
  const elapsedMin = (Date.now() - new Date(room.startedAt).getTime()) / 60000;
  return Math.min(lvls.length - 1, Math.floor(elapsedMin / room.config.levelMinutes));
}

/** Live tournament clock for the UI (null for cash / no ladder). */
function computeClock(room: Room): TournamentClock | null {
  const lvls = room.config.levels ?? [];
  if (lvls.length <= 1 || room.config.levelMinutes <= 0) return null;
  const idx = currentLevelIndex(room);
  const lvl = lvls[idx];
  const next = lvls[idx + 1];
  let secondsLeft = 0;
  if (room.startedAt) {
    const elapsedSec = (Date.now() - new Date(room.startedAt).getTime()) / 1000;
    const levelLen = room.config.levelMinutes * 60;
    secondsLeft = Math.max(0, Math.ceil(levelLen - (elapsedSec - idx * levelLen)));
    if (idx === lvls.length - 1) secondsLeft = 0;
  }
  return {
    level: lvl.level,
    smallBlind: lvl.smallBlind,
    bigBlind: lvl.bigBlind,
    ante: lvl.ante,
    levelMinutes: room.config.levelMinutes,
    secondsLeft,
    next: next ? { smallBlind: next.smallBlind, bigBlind: next.bigBlind, ante: next.ante } : undefined,
    isLastLevel: idx === lvls.length - 1,
  };
}

/** Add a player to a room (mutates and returns the new player's id), or null. */
function addPlayer(room: Room, name: string): string | null {
  if (room.players.length >= 9) return null;
  // Block joins mid-hand to keep seating stable; they can join next hand.
  const id = genId('u');
  room.players.push({ id, name: name || `P${room.players.length}`, seat: room.players.length });
  room.updatedAt = new Date().toISOString();
  return id;
}

/** Build (or rebuild) the engine table from the room's players + config. */
function freshGame(room: Room): TableState {
  return createGame({
    players: room.players.map((p) => ({ id: p.id, name: p.name, stack: room.config.startingStack })),
    smallBlind: room.config.smallBlind,
    bigBlind: room.config.bigBlind,
    ante: room.config.ante,
    seed: Math.floor(Math.random() * 1e9),
  });
}

/** Host starts/deals the next hand. Carries stacks over between hands. */
function dealNext(room: Room): TableState {
  let state = room.gameState;
  if (!state) {
    state = freshGame(room);
    room.startedAt = new Date().toISOString(); // start the blind clock
  } else {
    // Sync any players who joined since the table was created (seat them with a
    // starting stack), then deal the next hand keeping existing stacks.
    state = syncSeats(state, room);
  }
  // Remove players who left the table (skip them on the deal, chips cashed out).
  if (room.left?.length) {
    const left = new Set(room.left);
    state = {
      ...state,
      seats: state.seats.map((s) => (left.has(s.id) ? { ...s, status: 'empty' as const, stack: 0 } : s)),
    };
  }
  // Apply the current tournament blind level (no-op for cash / single level).
  const lvls = room.config.levels ?? [];
  if (lvls.length > 1 && room.config.levelMinutes > 0) {
    const lvl = lvls[currentLevelIndex(room)];
    state = { ...state, smallBlind: lvl.smallBlind, bigBlind: lvl.bigBlind, ante: lvl.ante };
  }
  const next = startHand(state);
  room.gameState = next;
  syncTimers(room);
  room.updatedAt = new Date().toISOString();
  return next;
}

/** Reset the action/hand-end timestamps to match the current game state. */
function syncTimers(room: Room): void {
  const st = room.gameState;
  if (st && st.handInProgress && st.toAct >= 0) {
    room.actingSince = new Date().toISOString();
    room.handEndedAt = undefined;
  } else {
    room.actingSince = undefined;
    if (st && !st.handInProgress && !room.handEndedAt) room.handEndedAt = new Date().toISOString();
  }
}

/**
 * Auto-act for players who ran out the action clock (lazy enforcement on poll).
 * Uses a virtual clock so several consecutive timeouts settle in one pass:
 * each timed-out player's successor starts when the predecessor expired.
 */
function tickTimeouts(room: Room): boolean {
  const timeout = room.config.actionTimeoutSec ?? 0;
  if (timeout <= 0 || !room.actingSince) return false;
  let st = room.gameState;
  if (!st || !st.handInProgress) return false;

  let changed = false;
  let deadline = new Date(room.actingSince).getTime() + timeout * 1000;
  let guard = 0;
  while (st && st.handInProgress && st.toAct >= 0 && Date.now() >= deadline && guard++ < 40) {
    const la = legalActions(st);
    if (!la.actions.length) break;
    const seatId = st.seats[st.toAct].id;
    const act: Action = la.actions.includes('check') ? { type: 'check' } : { type: 'fold' };
    st.log.push(`⏱ ${st.seats[st.toAct].name} 시간 초과 — 자동 ${act.type === 'check' ? '체크' : '폴드'}`);
    st = applyAction(st, seatId, act);
    room.gameState = st;
    changed = true;
    room.actingSince = new Date(deadline).toISOString();
    deadline += timeout * 1000;
  }
  if (changed) {
    // The hand may have ended on a timeout fold; resync the timestamps.
    if (!room.gameState?.handInProgress) {
      room.actingSince = undefined;
      if (!room.handEndedAt) room.handEndedAt = new Date().toISOString();
    }
    room.updatedAt = new Date().toISOString();
  }
  return changed;
}

/** Auto-deal the next hand a few seconds after a showdown (if enabled). */
function tickAutoAdvance(room: Room): boolean {
  if (!room.config.autoNextHand) return false;
  const st = room.gameState;
  if (!st || st.handInProgress || !room.handEndedAt) return false;
  if (Date.now() - new Date(room.handEndedAt).getTime() < 6000) return false;
  if (st.seats.filter((s) => s.stack > 0).length < 2) return false;
  dealNext(room);
  return true;
}

/** Load a room and apply any due timeouts / auto-advance, persisting changes. */
export async function tickAndGet(id: string): Promise<Room | undefined> {
  const room = await getRoom(id);
  if (!room) return undefined;
  let changed = tickTimeouts(room);
  // Mark a freshly-ended hand even if no timeout fired.
  const st = room.gameState;
  if (st && !st.handInProgress && !room.handEndedAt) {
    room.handEndedAt = new Date().toISOString();
    room.actingSince = undefined;
    changed = true;
  }
  if (tickAutoAdvance(room)) changed = true;
  if (changed) {
    room.updatedAt = new Date().toISOString();
    await persist(room);
  }
  return room;
}

/** Merge newly-joined room players into an existing engine state. */
function syncSeats(state: TableState, room: Room): TableState {
  const known = new Set(state.seats.map((s) => s.id));
  const additions = room.players.filter((p) => !known.has(p.id));
  if (!additions.length) return state;
  const seats = [
    ...state.seats,
    ...additions.map((p) => ({
      id: p.id,
      name: p.name,
      stack: room.config.startingStack,
      status: 'active' as const,
      holeCards: [] as number[],
      committedThisStreet: 0,
      committedTotal: 0,
      hasActed: false,
    })),
  ];
  return { ...state, seats };
}

/** Apply a player's action through the engine. */
function applyRoomAction(room: Room, playerId: string, action: Action): TableState {
  if (!room.gameState) throw new Error('아직 핸드가 시작되지 않았습니다.');
  const next = applyAction(room.gameState, playerId, action);
  room.gameState = next;
  syncTimers(room);
  room.updatedAt = new Date().toISOString();
  return next;
}

/** Public per-viewer view: redact opponents' cards + attach legal actions. */
export function toView(room: Room, viewerId?: string): RoomView {
  const view: RoomView = { ...room, you: viewerId };
  view.clock = computeClock(room);
  view.serverNow = Date.now();
  const timeout = room.config.actionTimeoutSec ?? 0;
  if (room.gameState) {
    view.gameState = redactFor(room.gameState, viewerId);
    // Only expose legal actions to the player whose turn it is.
    const toAct = room.gameState.seats[room.gameState.toAct];
    view.legal = toAct && viewerId && toAct.id === viewerId ? legalActions(room.gameState) : null;
    view.deadline =
      timeout > 0 && room.actingSince && room.gameState.handInProgress && room.gameState.toAct >= 0
        ? new Date(room.actingSince).getTime() + timeout * 1000
        : null;

    // Game over (between hands): either everyone left but one, or — in a
    // no-rebuy tournament — only one player still has chips.
    if (!room.gameState.handInProgress && room.gameState.handNumber > 0) {
      const withChips = room.players.filter((p) => {
        const seat = room.gameState!.seats.find((s) => s.id === p.id);
        return !seat || seat.stack > 0; // unseated joiners count as in
      });
      const overByLeave = room.players.length <= 1;
      const overByBust = !room.config.allowRebuy && withChips.length <= 1;
      if (overByLeave || overByBust) {
        view.gameOver = true;
        view.overallWinner = (withChips[0] ?? room.players[0])?.name;
      }
    }
  }
  return view;
}

// ---------- backend: file / memory ----------

function resolveDataDir(): string {
  if (process.env.ROOM_DATA_DIR) return process.env.ROOM_DATA_DIR;
  if (process.env.VERCEL) return path.join(os.tmpdir(), 'gto-rooms');
  return path.join(process.cwd(), '.data');
}
const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');

let cache: Record<string, Room> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function fileRead(): Promise<Record<string, Room>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache!;
}

function fileWrite(db: Record<string, Room>): Promise<void> {
  cache = db;
  writeChain = writeChain.then(async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${DATA_FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(db), 'utf8');
      await fs.rename(tmp, DATA_FILE);
    } catch {
      // persistence is best-effort; cache stays authoritative.
    }
  });
  return writeChain;
}

// ---------- backend: postgres ----------

let pgReady: Promise<void> | null = null;
function pgEnsure(): Promise<void> {
  if (!pgReady) {
    pgReady = sql`CREATE TABLE IF NOT EXISTS rooms (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL
    )`.then(() => undefined);
  }
  return pgReady;
}

async function pgGet(id: string): Promise<Room | undefined> {
  await pgEnsure();
  const { rows } = await sql`SELECT data FROM rooms WHERE id = ${id}`;
  return rows[0]?.data as Room | undefined;
}

async function pgPut(room: Room): Promise<void> {
  await pgEnsure();
  await sql`INSERT INTO rooms (id, created_at, updated_at, data)
    VALUES (${room.id}, ${room.createdAt}, ${room.updatedAt}, ${JSON.stringify(room)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET updated_at = ${room.updatedAt}, data = ${JSON.stringify(room)}::jsonb`;
}

// ---------- public API (backend-agnostic) ----------

export async function getRoom(id: string): Promise<Room | undefined> {
  const code = id.toUpperCase();
  if (usePg) return pgGet(code);
  const db = await fileRead();
  return db[code];
}

export async function listRooms(): Promise<Room[]> {
  if (usePg) {
    await pgEnsure();
    const { rows } = await sql`SELECT data FROM rooms ORDER BY updated_at DESC LIMIT 100`;
    return rows.map((r) => r.data as Room);
  }
  const db = await fileRead();
  return Object.values(db).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createRoom(
  name: string,
  hostName: string,
  config: RoomConfig,
): Promise<{ room: Room; playerId: string }> {
  const { room, playerId } = newRoom(name, hostName, config);
  if (usePg) {
    await pgPut(room);
  } else {
    const db = await fileRead();
    db[room.id] = room;
    await fileWrite(db);
  }
  return { room, playerId };
}

export async function joinRoom(
  id: string,
  name: string,
): Promise<{ room: Room; playerId: string } | null> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) return null;
  const playerId = addPlayer(room, name);
  if (!playerId) return null;
  await persist(room);
  return { room, playerId };
}

export async function startNextHand(id: string, playerId: string): Promise<Room> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  if (room.hostId !== playerId) throw new Error('호스트만 딜할 수 있습니다.');
  if (room.players.length < 2) throw new Error('플레이어가 2명 이상이어야 합니다.');
  dealNext(room);
  await persist(room);
  return room;
}

/** A busted player buys back to the starting stack (if rebuys are allowed). */
export async function rebuyPlayer(id: string, playerId: string): Promise<Room | undefined> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) return undefined;
  if (!room.config.allowRebuy) throw new Error('이 테이블은 리바이를 허용하지 않습니다.');
  if (!room.players.some((p) => p.id === playerId)) throw new Error('테이블에 없는 플레이어입니다.');
  if (!room.gameState) throw new Error('아직 게임이 시작되지 않았습니다.');
  const seat = room.gameState.seats.find((s) => s.id === playerId);
  if (!seat) throw new Error('좌석을 찾을 수 없습니다.');
  if (seat.stack > 0) throw new Error('아직 칩이 남아 있어 리바이할 수 없습니다.');

  const live = room.gameState.handInProgress;
  room.gameState = {
    ...room.gameState,
    seats: room.gameState.seats.map((s) =>
      s.id === playerId
        ? { ...s, stack: room.config.startingStack, status: live ? ('folded' as const) : ('active' as const) }
        : s,
    ),
  };
  room.updatedAt = new Date().toISOString();
  await persist(room);
  return room;
}

export async function leaveRoom(id: string, playerId: string): Promise<Room | undefined> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) return undefined;
  room.players = room.players.filter((p) => p.id !== playerId);
  room.left = room.left ?? [];
  if (!room.left.includes(playerId)) room.left.push(playerId);
  // Fold them out of the live hand (no-op if they're not seated / not active).
  if (room.gameState) {
    room.gameState = forfeit(room.gameState, playerId);
    syncTimers(room);
    // Between hands, hide their seat immediately (chips cashed out).
    if (!room.gameState.handInProgress) {
      room.gameState = {
        ...room.gameState,
        seats: room.gameState.seats.map((s) =>
          s.id === playerId ? { ...s, status: 'empty' as const, stack: 0 } : s,
        ),
      };
    }
  }
  // Hand the host role to whoever remains.
  if (room.hostId === playerId && room.players.length) room.hostId = room.players[0].id;
  room.updatedAt = new Date().toISOString();
  await persist(room);
  return room;
}

export async function doAction(id: string, playerId: string, action: Action): Promise<Room> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  applyRoomAction(room, playerId, action);
  await persist(room);
  return room;
}

async function persist(room: Room): Promise<void> {
  if (usePg) {
    await pgPut(room);
  } else {
    const db = await fileRead();
    db[room.id] = room;
    await fileWrite(db);
  }
}
