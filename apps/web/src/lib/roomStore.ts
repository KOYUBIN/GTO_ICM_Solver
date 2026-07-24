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
import { HAS_PG, pgPool } from './pg';
import {
  createGame,
  startHand,
  applyAction,
  forfeit,
  redactFor,
  legalActions,
  getPreset,
  monsterPaidCount,
  monsterPrizePool,
  monsterPayouts,
  dealCalc,
  MONSTER_GAME,
  chenScore,
  pushFoldAdvice,
  evaluate7,
  categoryOf,
  cardRank,
  cardSuit,
  RANKS,
  type TableState,
  type Action,
  type BlindLevel,
} from '@gto/engine';
import { cardsToString } from '@gto/engine';
import { spend, awardPrize } from './auth';
import { appendPersonalHands, type PersonalHand } from './handhistory';
import type { Room, RoomConfig, RoomView, TournamentClock, ChatMsg, HandRecord, PublicRoomSummary } from './rooms';

const usePg = HAS_PG;
export const ROOM_STORE_BACKEND = usePg ? 'postgres' : 'file';
const pg = pgPool;

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

/** The rebuy/late-reg fields, falling back to the preset (몬스터: 300만 / L10). */
function resolveRebuyMeta(config: RoomConfig): { rebuyStack?: number; lateRegLevel?: number } {
  const preset =
    config.presetId && config.presetId !== 'custom' ? getPreset(config.presetId) : undefined;
  return {
    rebuyStack: config.rebuyStack ?? preset?.rebuyStack,
    lateRegLevel: config.lateRegLevel ?? preset?.lateRegLevel,
  };
}

function newRoom(
  name: string,
  hostName: string,
  config: RoomConfig,
  account?: string,
): { room: Room; playerId: string } {
  const hostId = genId('u');
  const now = new Date().toISOString();
  const room: Room = {
    id: genCode(),
    name: name || '홀덤 테이블',
    hostId,
    players: [{ id: hostId, name: hostName || '호스트', seat: 0, account }],
    config: {
      ...config,
      levels: resolveLevels(config),
      actionTimeoutSec: config.actionTimeoutSec ?? 30,
      autoNextHand: config.autoNextHand ?? true,
      allowRebuy: config.allowRebuy ?? true,
      ...resolveRebuyMeta(config),
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
  const lateRegLevel = room.config.lateRegLevel;
  return {
    level: lvl.level,
    smallBlind: lvl.smallBlind,
    bigBlind: lvl.bigBlind,
    ante: lvl.ante,
    levelMinutes: room.config.levelMinutes,
    secondsLeft,
    next: next ? { smallBlind: next.smallBlind, bigBlind: next.bigBlind, ante: next.ante } : undefined,
    isLastLevel: idx === lvls.length - 1,
    lateRegLevel,
    registrationClosed: lateRegLevel != null && lvl.level > lateRegLevel,
  };
}

/** Add a player to a room (mutates and returns the new player's id), or null. */
function addPlayer(room: Room, name: string, account?: string, isBot?: boolean): string | null {
  if (room.players.length >= 9) return null;
  // Block joins mid-hand to keep seating stable; they can join next hand.
  const id = genId(isBot ? 'b' : 'u');
  room.players.push({
    id,
    name: name || `P${room.players.length}`,
    seat: room.players.length,
    account,
    ...(isBot ? { isBot: true } : {}),
  });
  room.updatedAt = new Date().toISOString();
  return id;
}

const BOT_NAMES = ['🤖 알파', '🤖 브라보', '🤖 찰리', '🤖 델타', '🤖 에코'];

/** The monster buy-in in game money, or 0 for non-monster/free tables. */
function buyInOf(config: RoomConfig): number {
  return config.presetId === 'monster' ? MONSTER_GAME.buyIn : 0;
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

// ---------- AI players (server-driven, act on poll ticks) ----------

/** 13x13 grid label ("AKs" / "T9o" / "QQ") from two hole-card ints. */
function holeLabel(c1: number, c2: number): string {
  const r1 = cardRank(c1);
  const r2 = cardRank(c2);
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  if (hi === lo) return RANKS[hi] + RANKS[lo];
  return RANKS[hi] + RANKS[lo] + (cardSuit(c1) === cardSuit(c2) ? 's' : 'o');
}

/** Pick `prefer` when legal, else the safest legal fallback. */
function safeAction(la: ReturnType<typeof legalActions>, prefer: Action): Action {
  if (la.actions.includes(prefer.type)) return prefer;
  if (la.actions.includes('check')) return { type: 'check' };
  if (la.actions.includes('call')) return { type: 'call' };
  if (la.actions.includes('fold')) return { type: 'fold' };
  return { type: 'allin' };
}

/**
 * Heuristic bot policy — decent-amateur strength, always returns a legal
 * action. Preflop: Chen score bands + push/fold when short. Postflop: made-
 * hand category with a small bluff frequency. Randomness keeps it non-robotic.
 */
export type BotLevel = 'easy' | 'normal' | 'hard';

interface BotParams {
  premiumScore: number; // Chen ≥ → premium raise/3bet
  openScore: number; // Chen ≥ → will open playable
  openFreq: number; // freq of opening a playable hand
  callWideBB: number; // max bb to flat-call preflop with a playable hand
  weakCallFreq: number; // freq of a cheap call with a weak hand (calling-station-ness)
  valueRaise: number; // freq to raise 2pair+ postflop
  valueBet: number; // freq to bet 2pair+ postflop
  pairBet: number; // freq to bet top pair
  onePairPrice: number; // max pot-odds price to call with one pair
  weakPairPrice: number; // max price to call with a weak pair
  bluff: number; // high-card bluff freq
  floatPrice: number; // max price to call light with a high card
}

const BOT_PARAMS: Record<BotLevel, BotParams> = {
  // 루즈-패시브 콜링스테이션: 너무 많이 콜하고 잘 안 접는다.
  easy: {
    premiumScore: 12, openScore: 9, openFreq: 0.2, callWideBB: 5.5, weakCallFreq: 0.6,
    valueRaise: 0.3, valueBet: 0.5, pairBet: 0.3, onePairPrice: 0.5, weakPairPrice: 0.4, bluff: 0.04, floatPrice: 0.18,
  },
  // 아마추어 중수 (기존 정책).
  normal: {
    premiumScore: 11, openScore: 8, openFreq: 0.5, callWideBB: 3.5, weakCallFreq: 0.5,
    valueRaise: 0.7, valueBet: 0.85, pairBet: 0.55, onePairPrice: 0.38, weakPairPrice: 0.25, bluff: 0.12, floatPrice: 0.08,
  },
  // 타이트-어그레시브: 마진 핸드 접고, 밸류·블러프 공격적.
  hard: {
    premiumScore: 10, openScore: 8, openFreq: 0.72, callWideBB: 3, weakCallFreq: 0.2,
    valueRaise: 0.85, valueBet: 0.9, pairBet: 0.62, onePairPrice: 0.32, weakPairPrice: 0.18, bluff: 0.22, floatPrice: 0.05,
  },
};

function botAction(st: TableState, seatIdx: number, level: BotLevel = 'normal'): Action {
  const p = BOT_PARAMS[level] ?? BOT_PARAMS.normal;
  const seat = st.seats[seatIdx];
  const la = legalActions(st);
  const bb = st.bigBlind || 1;
  const toCall = la.callAmount;
  const stackBB = seat.stack / bb;
  const rand = Math.random();
  const potNow =
    st.pots.reduce((a, p2) => a + p2.amount, 0) + st.seats.reduce((a, s) => a + s.committedThisStreet, 0);
  const raiseTo = (target: number) =>
    Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, Math.round(target)));

  if (st.currentStreet === 'preflop') {
    const label = holeLabel(seat.holeCards[0], seat.holeCards[1]);
    const score = chenScore(label);
    // 숏스택: 푸시/폴드 차트를 따른다 (모든 난이도 공통 — 이론적으로 옳음).
    if (stackBB <= 12) {
      const behind = Math.max(1, st.seats.filter((s) => s.status === 'active').length - 1);
      const adv = pushFoldAdvice(label, Math.max(1, Math.round(stackBB)), behind);
      if (adv.action === 'push') return safeAction(la, { type: 'allin' });
      if (adv.action === 'fold' && toCall > 0) return safeAction(la, { type: 'fold' });
    }
    if (score >= p.premiumScore) {
      // 프리미엄: 레이즈/3벳, 막히면 콜.
      if (la.actions.includes('raise')) return { type: 'raise', amount: raiseTo(st.currentBet > bb ? st.currentBet * 3 : bb * 2.5) };
      return safeAction(la, { type: 'call' });
    }
    if (score >= p.openScore) {
      // 플레이 가능: 가끔 오픈, 적당한 가격이면 콜.
      if (st.currentBet <= bb && la.actions.includes('raise') && rand < p.openFreq) {
        return { type: 'raise', amount: raiseTo(bb * 2.5) };
      }
      if (toCall <= bb * p.callWideBB) return safeAction(la, { type: 'call' });
      if (score >= p.openScore + 2 && toCall <= bb * 9) return safeAction(la, { type: 'call' });
      return safeAction(la, { type: 'fold' });
    }
    // 약한 핸드: 공짜면 체크, 싼 콜은 가끔(난이도별), 나머지 폴드.
    if (la.actions.includes('check')) return { type: 'check' };
    if (toCall <= bb * (level === 'easy' ? 1.5 : 0.5) && rand < p.weakCallFreq) return safeAction(la, { type: 'call' });
    return safeAction(la, { type: 'fold' });
  }

  // 포스트플랍: 메이드 핸드 등급 기반.
  const cat = categoryOf(evaluate7([...seat.holeCards, ...st.board]));
  const boardPaired = new Set(st.board.map((c) => cardRank(c))).size < st.board.length;
  const strongPair = cat === 1 && seat.holeCards.some((h) => st.board.every((b) => cardRank(h) >= cardRank(b)));
  const price = toCall / Math.max(1, potNow + toCall);
  if (cat >= 2 && !(cat === 2 && boardPaired && rand < 0.3)) {
    // 투페어+: 밸류 벳/레이즈, 콜은 항상.
    if (la.actions.includes('raise') && rand < p.valueRaise) return { type: 'raise', amount: raiseTo(potNow * 0.7 + toCall) };
    if (la.actions.includes('bet') && rand < p.valueBet) return { type: 'bet', amount: raiseTo(potNow * 0.65) };
    return safeAction(la, { type: 'call' });
  }
  if (cat === 1) {
    // 원페어: 탑페어면 밸류/콜, 아니면 팟 컨트롤.
    if (strongPair && la.actions.includes('bet') && rand < p.pairBet) return { type: 'bet', amount: raiseTo(potNow * 0.5) };
    if (toCall === 0) return safeAction(la, { type: 'check' });
    if (price <= (strongPair ? p.onePairPrice : p.weakPairPrice)) return safeAction(la, { type: 'call' });
    return safeAction(la, { type: 'fold' });
  }
  // 하이카드: 체크, 가끔 블러프, 싼 콜만(난이도별).
  if (toCall === 0) {
    if (la.actions.includes('bet') && rand < p.bluff) return { type: 'bet', amount: raiseTo(potNow * 0.5) };
    return safeAction(la, { type: 'check' });
  }
  if (price <= p.floatPrice && rand < (level === 'easy' ? 0.5 : 0.35)) return safeAction(la, { type: 'call' });
  return safeAction(la, { type: 'fold' });
}

const BOT_DELAY_MS = 900;

/** Let AI seats act (one poll ≈ one bot action for natural pacing). */
function tickBots(room: Room): boolean {
  let st = room.gameState;
  if (!st || !st.handInProgress) return false;
  const botIds = new Set(room.players.filter((p) => p.isBot).map((p) => p.id));
  if (!botIds.size) return false;
  let changed = false;
  let guard = 0;
  while (st && st.handInProgress && st.toAct >= 0 && botIds.has(st.seats[st.toAct].id) && guard++ < 40) {
    const since = room.actingSince ? Date.now() - new Date(room.actingSince).getTime() : Infinity;
    if (since < BOT_DELAY_MS) break; // 아직 "생각 중" — 다음 폴에서 행동
    const seatId = st.seats[st.toAct].id;
    let act: Action;
    try {
      act = botAction(st, st.toAct, room.config.botLevel ?? 'normal');
    } catch {
      const la = legalActions(st);
      act = la.actions.includes('check') ? { type: 'check' } : { type: 'fold' };
    }
    try {
      st = applyAction(st, seatId, act);
    } catch {
      // 정책이 비합법 액션을 낸 극단 케이스: 안전 액션으로 재시도.
      const la = legalActions(st);
      st = applyAction(st, seatId, la.actions.includes('check') ? { type: 'check' } : { type: 'fold' });
    }
    room.gameState = st;
    room.actingSince = new Date().toISOString();
    changed = true;
  }
  if (changed && !room.gameState?.handInProgress) {
    room.actingSince = undefined;
    if (!room.handEndedAt) room.handEndedAt = new Date().toISOString();
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

/** Append a finished hand to the room's history (idempotent per hand). */
function recordHandIfEnded(room: Room): void {
  const st = room.gameState;
  if (!st || st.handInProgress || !st.winners.length) return;
  const hist: HandRecord[] = (room.history ??= []);
  if (hist.length && hist[hist.length - 1].handNumber === st.handNumber) return;
  const uncontested = st.winners.some((w) => w.hand === 'uncontested');
  const nameOf = (id: string) => st.seats.find((s) => s.id === id)?.name ?? '?';
  hist.push({
    handNumber: st.handNumber,
    board: cardsToString(st.board),
    pot: st.winners.reduce((a, w) => a + w.amount, 0),
    winners: st.winners.map((w) => ({ name: nameOf(w.seatId), amount: w.amount, hand: w.hand })),
    // Hole cards only from a real showdown — never leak an uncontested winner's.
    revealed: uncontested
      ? []
      : st.seats
          .filter((s) => (s.status === 'active' || s.status === 'allin') && s.holeCards.length === 2)
          .map((s) => ({ name: s.name, cards: cardsToString(s.holeCards) })),
    endedAt: new Date().toISOString(),
  });
  if (hist.length > 20) hist.splice(0, hist.length - 20);
  recordBusts(room);
  queuePersonalHands(room, hist[hist.length - 1]);
}

/**
 * Record the finished hand into each logged-in player's personal history
 * (their own hole cards + chip delta). Fire-and-forget: runs at most once per
 * hand (recordHandIfEnded is idempotent) and a history hiccup must never
 * break the game flow.
 */
function queuePersonalHands(room: Room, rec: HandRecord): void {
  const st = room.gameState;
  if (!st) return;
  const entries: PersonalHand[] = [];
  for (const p of room.players) {
    if (!p.account) continue;
    const seat = st.seats.find((s) => s.id === p.id);
    // Only seats actually dealt into the ended hand (busted/sitting-out skip).
    if (!seat || seat.status === 'empty' || seat.status === 'sittingOut') continue;
    if (seat.holeCards.length !== 2) continue;
    const winAmount = st.winners
      .filter((w) => w.seatId === p.id)
      .reduce((a, w) => a + w.amount, 0);
    const delta = winAmount - seat.committedTotal;
    entries.push({
      // Deterministic id so a concurrent instance recording the same hand
      // can't duplicate it (append is idempotent per id).
      id: `${room.id}-${new Date(room.createdAt).getTime().toString(36)}-${st.handNumber}-${p.account}`,
      username: p.account,
      at: rec.endedAt,
      roomCode: room.id,
      roomName: room.name,
      handNumber: rec.handNumber,
      heroName: seat.name,
      heroCards: cardsToString(seat.holeCards),
      board: rec.board,
      pot: rec.pot,
      delta,
      won: delta > 0,
      winners: rec.winners.map((w) => ({ ...w })),
      // Copied from the room record, which already respects showdown privacy.
      revealed: rec.revealed.map((r) => ({ ...r })),
    });
  }
  if (entries.length) void appendPersonalHands(entries).catch(() => {});
}

/**
 * Record players who ran out of chips this hand into the elimination order.
 * Runs once per ended hand (recordHandIfEnded is idempotent). A player who
 * later rebuys is removed again in rebuyPlayer, so the order stays accurate.
 */
function recordBusts(room: Room): void {
  const st = room.gameState;
  if (!st) return;
  const order = (room.finishOrder ??= []);
  const seen = new Set(order);
  for (const seat of st.seats) {
    if (seat.stack > 0 || seat.status === 'empty') continue;
    if (!room.players.some((p) => p.id === seat.id)) continue; // 방에 없는 좌석 무시
    if (seen.has(seat.id)) continue;
    order.push(seat.id);
    seen.add(seat.id);
  }
}

function playerName(room: Room, id: string): string {
  return (
    room.players.find((p) => p.id === id)?.name ??
    room.gameState?.seats.find((s) => s.id === id)?.name ??
    '?'
  );
}

/** Final standings (place 1 = winner) with an optional prize estimate. */
function computeStandings(room: Room, winnerId: string | undefined) {
  const order = room.finishOrder ?? [];
  const prizes = tournamentPrizes(room);

  // Deal: remaining players share the top prizes by the agreed amounts; the
  // already-eliminated keep their ladder finishes below them.
  if (room.dealResult) {
    const amounts = room.dealResult.amounts;
    const dealt = Object.keys(amounts).sort((a, b) => amounts[b] - amounts[a]);
    const ranked = [...dealt];
    for (let i = order.length - 1; i >= 0; i--) if (!ranked.includes(order[i])) ranked.push(order[i]);
    for (const p of room.players) if (!ranked.includes(p.id)) ranked.push(p.id);
    return ranked.map((id, i) => ({
      id,
      place: i + 1,
      name: playerName(room, id),
      prize: i < dealt.length ? amounts[id] : prizes[i],
    }));
  }

  const ranked: string[] = [];
  const push = (id: string | undefined) => {
    if (id && !ranked.includes(id)) ranked.push(id);
  };
  push(winnerId);
  for (let i = order.length - 1; i >= 0; i--) push(order[i]); // 최근 탈락 = 상위
  for (const p of room.players) push(p.id); // 혹시 누락된 현재 플레이어
  return ranked.map((id, i) => ({ id, place: i + 1, name: playerName(room, id), prize: prizes[i] }));
}

/** Whether the tournament is over, and the winner's id if so. */
function gameOverResult(room: Room): { over: boolean; winnerId?: string } {
  const st = room.gameState;
  if (!st) return { over: false };
  if (room.dealResult) {
    const amounts = room.dealResult.amounts;
    const top = Object.keys(amounts).sort((a, b) => amounts[b] - amounts[a])[0];
    return { over: true, winnerId: top };
  }
  if (!st.handInProgress && st.handNumber > 0) {
    const withChips = room.players.filter((p) => {
      const seat = st.seats.find((s) => s.id === p.id);
      return !seat || seat.stack > 0;
    });
    const overByLeave = room.players.length <= 1;
    const regClosed = !!computeClock(room)?.registrationClosed;
    const rebuysPossible = !!room.config.allowRebuy && !regClosed;
    const overByBust = !rebuysPossible && withChips.length <= 1;
    if (overByLeave || overByBust) return { over: true, winnerId: (withChips[0] ?? room.players[0])?.id };
  }
  return { over: false };
}

/**
 * Pay tournament prizes to linked member accounts, once. Mutates room.settled
 * and returns true if it credited anything (so the caller persists).
 */
async function settleRoom(room: Room): Promise<boolean> {
  if (room.settled) return false;
  const gor = gameOverResult(room);
  if (!gor.over) return false;
  room.settled = true; // set before awarding so a retry can't double-pay
  const standings = computeStandings(room, gor.winnerId);
  for (const s of standings) {
    const acct = room.players.find((p) => p.id === s.id)?.account;
    if (acct && s.prize && s.prize > 0) {
      await awardPrize(acct, s.prize, s.place === 1).catch(() => {});
    } else if (acct) {
      // Still record participation (no prize) for logged-in finishers.
      await awardPrize(acct, 0, s.place === 1).catch(() => {});
    }
  }
  return true;
}

/** Remaining players (chips > 0) and the monster prize pool, or null if N/A. */
function dealContext(
  room: Room,
): { ids: string[]; names: string[]; stacks: number[]; prizesMoney: number[]; pool: number } | null {
  if (room.config.presetId !== 'monster' || !room.gameState) return null;
  const alive = room.gameState.seats.filter(
    (s) => s.stack > 0 && s.status !== 'empty' && room.players.some((p) => p.id === s.id),
  );
  if (alive.length < 2 || alive.length > 6) return null; // 파이널 테이블 범위에서만
  const entrants = room.players.length + (room.left?.length ?? 0);
  const pool = monsterPrizePool(entrants, room.rebuyCount ?? 0);
  const prizesMoney = monsterPayouts(monsterPaidCount(entrants)).map((p) => p * pool);
  return {
    ids: alive.map((s) => s.id),
    names: alive.map((s) => s.name),
    stacks: alive.map((s) => s.stack),
    prizesMoney,
    pool,
  };
}

/** Chip-chop vs ICM split preview for the remaining players. */
function computeDealPreview(room: Room): RoomView['dealPreview'] | undefined {
  const ctx = dealContext(room);
  if (!ctx) return undefined;
  const d = dealCalc(ctx.stacks, ctx.prizesMoney);
  return { ids: ctx.ids, names: ctx.names, stacks: ctx.stacks, chip: d.chipChop, icm: d.icm, pool: ctx.pool };
}

/** Prize per finishing place. Only the 몬스터 프리셋에 대해 상금을 추정합니다. */
function tournamentPrizes(room: Room): (number | undefined)[] {
  if (room.config.presetId !== 'monster') return [];
  const entrants = room.players.length + (room.left?.length ?? 0);
  const pool = monsterPrizePool(entrants, room.rebuyCount ?? 0);
  const paid = monsterPaidCount(entrants);
  return monsterPayouts(paid).map((p) => p * pool);
}

/** Load a room and apply any due timeouts / auto-advance, persisting changes. */
export async function tickAndGet(id: string): Promise<Room | undefined> {
  const room = await getRoom(id);
  if (!room) return undefined;
  const expected = room.updatedAt;
  let changed = tickTimeouts(room);
  if (tickBots(room)) changed = true;
  // Mark a freshly-ended hand even if no timeout fired.
  const st = room.gameState;
  if (st && !st.handInProgress && !room.handEndedAt) {
    room.handEndedAt = new Date().toISOString();
    room.actingSince = undefined;
    changed = true;
  }
  if (tickAutoAdvance(room)) changed = true;
  const before = room.history?.length ?? 0;
  recordHandIfEnded(room);
  if ((room.history?.length ?? 0) !== before) changed = true;
  // Pay tournament prizes to member accounts once the game is over.
  if (await settleRoom(room)) changed = true;
  if (changed) {
    room.updatedAt = new Date().toISOString();
    // Best-effort: if another instance ticked first, its write wins and the
    // next poll re-reads fresh state.
    await persist(room, expected).catch(() => {});
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

    const gor = gameOverResult(room);
    if (gor.over) {
      view.gameOver = true;
      // Strip the internal player id from the public standings.
      view.standings = computeStandings(room, gor.winnerId).map(({ id: _id, ...rest }) => rest);
      view.overallWinner = view.standings[0]?.name;
    } else if (!room.gameState.handInProgress && room.gameState.handNumber > 0) {
      // Offer a final-table deal (monster, 2~6 left) between hands.
      const preview = computeDealPreview(room);
      if (preview) {
        view.canDeal = true;
        view.dealPreview = preview;
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
    pgReady = pg().sql`CREATE TABLE IF NOT EXISTS rooms (
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
  const { rows } = await pg().sql`SELECT data FROM rooms WHERE id = ${id}`;
  return rows[0]?.data as Room | undefined;
}

async function pgPut(room: Room, expected?: string): Promise<void> {
  await pgEnsure();
  if (expected) {
    // Optimistic concurrency: only write if nobody else wrote since we read.
    const res = await pg().sql`UPDATE rooms
      SET updated_at = ${room.updatedAt}, data = ${JSON.stringify(room)}::jsonb
      WHERE id = ${room.id} AND updated_at = ${expected}`;
    if (res.rowCount === 0) {
      throw new Error('다른 요청과 동시에 처리되어 반영되지 않았습니다. 잠시 후 다시 시도하세요.');
    }
    return;
  }
  await pg().sql`INSERT INTO rooms (id, created_at, updated_at, data)
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
    const { rows } = await pg().sql`SELECT data FROM rooms ORDER BY updated_at DESC LIMIT 100`;
    return rows.map((r) => r.data as Room);
  }
  const db = await fileRead();
  return Object.values(db).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createRoom(
  name: string,
  hostName: string,
  config: RoomConfig,
  account?: string,
  aiCount = 0,
): Promise<{ room: Room; playerId: string }> {
  // Monster tables cost a buy-in in game money (logged-in host only).
  const buyIn = buyInOf(config);
  if (buyIn > 0 && account) await spend(account, buyIn); // throws if insufficient
  const { room, playerId } = newRoom(name, hostName, config, account);
  // AI 플레이어 (계정 없음 — 바이인/상금 정산 대상 아님).
  const bots = Math.max(0, Math.min(5, Math.floor(aiCount)));
  for (let i = 0; i < bots; i++) addPlayer(room, BOT_NAMES[i], undefined, true);
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
  account?: string,
): Promise<{ room: Room; playerId: string } | null> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) return null;
  const buyIn = buyInOf(room.config);
  if (buyIn > 0 && account) await spend(account, buyIn); // throws if insufficient
  const expected = room.updatedAt;
  const playerId = addPlayer(room, name, account);
  if (!playerId) return null;
  await persist(room, expected);
  return { room, playerId };
}

export async function startNextHand(id: string, playerId: string): Promise<Room> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  if (room.hostId !== playerId) throw new Error('호스트만 딜할 수 있습니다.');
  if (room.players.length < 2) throw new Error('플레이어가 2명 이상이어야 합니다.');
  const expected = room.updatedAt;
  dealNext(room);
  await persist(room, expected);
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

  // Late-registration cutoff: once the clock passes the late-reg level, no rebuys.
  const lateRegLevel = room.config.lateRegLevel;
  if (lateRegLevel != null) {
    const lvls = room.config.levels ?? [];
    const curLevel = lvls[currentLevelIndex(room)]?.level ?? 1;
    if (curLevel > lateRegLevel) {
      throw new Error(`레지 마감: ${lateRegLevel}레벨 이후에는 리바이할 수 없습니다.`);
    }
  }

  // Rebuy costs game money on monster tables (logged-in players).
  const rebuyFee = buyInOf(room.config);
  const acct = room.players.find((p) => p.id === playerId)?.account;
  if (rebuyFee > 0 && acct) await spend(acct, rebuyFee); // throws if insufficient

  // Monster-style tables grant a distinct rebuy stack (리바이 400만 ≠ 스타트 300만).
  const rebuyChips = room.config.rebuyStack ?? room.config.startingStack;
  const expected = room.updatedAt;
  const live = room.gameState.handInProgress;
  room.gameState = {
    ...room.gameState,
    seats: room.gameState.seats.map((s) =>
      s.id === playerId
        ? { ...s, stack: rebuyChips, status: live ? ('folded' as const) : ('active' as const) }
        : s,
    ),
  };
  // They re-entered: drop from the elimination order and count the rebuy.
  if (room.finishOrder?.includes(playerId)) {
    room.finishOrder = room.finishOrder.filter((id) => id !== playerId);
  }
  room.rebuyCount = (room.rebuyCount ?? 0) + 1;
  room.updatedAt = new Date().toISOString();
  await persist(room, expected);
  return room;
}

/** Host ends the tournament with a final-table deal (chip-chop or ICM split). */
export async function makeDeal(
  id: string,
  playerId: string,
  method: 'icm' | 'chip',
): Promise<Room | undefined> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) return undefined;
  if (room.hostId !== playerId) throw new Error('방장만 딜을 확정할 수 있습니다.');
  if (room.dealResult) throw new Error('이미 딜로 종료된 게임입니다.');
  if (room.gameState?.handInProgress) throw new Error('핸드가 끝난 뒤에 딜할 수 있습니다.');
  const ctx = dealContext(room);
  if (!ctx) throw new Error('지금은 딜을 할 수 없습니다 (파이널 2~6인, 핸드 사이에만 가능).');
  const d = dealCalc(ctx.stacks, ctx.prizesMoney);
  const split = method === 'icm' ? d.icm : d.chipChop;
  const amounts: Record<string, number> = {};
  ctx.ids.forEach((pid, i) => (amounts[pid] = Math.round(split[i])));
  const expected = room.updatedAt;
  room.dealResult = { method, amounts, at: new Date().toISOString() };
  await settleRoom(room); // pay prizes to member accounts immediately
  room.updatedAt = new Date().toISOString();
  await persist(room, expected);
  return room;
}

export async function leaveRoom(id: string, playerId: string): Promise<Room | undefined> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) return undefined;
  const expected = room.updatedAt;
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
  recordHandIfEnded(room);
  room.updatedAt = new Date().toISOString();
  await persist(room, expected);
  return room;
}

export async function doAction(id: string, playerId: string, action: Action): Promise<Room> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  const expected = room.updatedAt;
  applyRoomAction(room, playerId, action);
  recordHandIfEnded(room);
  await persist(room, expected);
  return room;
}

async function persist(room: Room, expected?: string): Promise<void> {
  if (usePg) {
    await pgPut(room, expected);
  } else {
    // Single-instance file/memory backend: writes are already serialized.
    const db = await fileRead();
    db[room.id] = room;
    await fileWrite(db);
  }
}

async function deleteRoom(id: string): Promise<void> {
  if (usePg) {
    await pgEnsure();
    await pg().sql`DELETE FROM rooms WHERE id = ${id}`;
    return;
  }
  const db = await fileRead();
  delete db[id];
  await fileWrite(db);
}

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** Public lobby rows (sanitized), lazily deleting rooms idle for 24h+. */
export async function listPublicRooms(): Promise<PublicRoomSummary[]> {
  const all = await listRooms();
  const now = Date.now();
  const fresh: Room[] = [];
  for (const r of all) {
    if (now - new Date(r.updatedAt).getTime() > ROOM_TTL_MS) {
      await deleteRoom(r.id).catch(() => {});
    } else {
      fresh.push(r);
    }
  }
  return fresh
    .filter((r) => r.config.isPublic && r.players.length > 0)
    .slice(0, 30)
    .map((r) => ({
      id: r.id,
      name: r.name,
      presetName: r.config.presetName,
      smallBlind: r.gameState?.smallBlind ?? r.config.smallBlind,
      bigBlind: r.gameState?.bigBlind ?? r.config.bigBlind,
      players: r.players.length,
      handNumber: r.gameState?.handNumber ?? 0,
      updatedAt: r.updatedAt,
    }));
}

/** Append a table-chat message (members only, bounded to the last 60). */
export async function addChat(id: string, playerId: string, text: string): Promise<Room> {
  const code = id.toUpperCase();
  const room = await getRoom(code);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error('테이블에 없는 플레이어입니다.');
  const t = text.trim().slice(0, 200);
  if (!t) throw new Error('빈 메시지입니다.');
  const expected = room.updatedAt;
  const chat: ChatMsg[] = (room.chat ??= []);
  chat.push({ id: genId('m'), name: player.name, text: t, at: new Date().toISOString() });
  if (chat.length > 60) chat.splice(0, chat.length - 60);
  room.updatedAt = new Date().toISOString();
  await persist(room, expected);
  return room;
}
