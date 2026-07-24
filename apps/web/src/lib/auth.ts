/**
 * Account + session store (server-only).
 *
 * Minimal 아이디/비밀번호/닉네임 accounts. Pluggable like the room store:
 * Postgres when POSTGRES_URL is set (cross-instance, works on Vercel
 * serverless), otherwise a file fallback (.data/users.json) that is fine for
 * local dev or a single long-lived server.
 *
 * Passwords are hashed with node:crypto scrypt (random 16-byte salt) and
 * compared with timingSafeEqual. Session tokens are 24 random bytes (hex).
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { HAS_PG, pgPool } from './pg';

const usePg = HAS_PG;
const pg = pgPool;

export const SESSION_COOKIE = 'gto_session';
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

export type PublicUser = {
  username: string;
  nick: string;
  /** Spendable game money (게임머니). */
  balance: number;
  /** Cumulative tournament prize won (for ranking). */
  points: number;
  /** Tournaments won (1st place). */
  wins: number;
  /** Tournaments finished. */
  games: number;
  /** Experience points, granted alongside earned game money (레벨 계산용). */
  xp: number;
  /** Consecutive-day attendance streak. */
  dailyStreak: number;
  /** YYYY-MM-DD of the last claimed attendance bonus. */
  lastDaily: string;
  /** Comma-joined ids of claimed achievements. */
  achievements: string;
  /** Equipped avatar emoji ('' = default initial). */
  avatar: string;
  /** Comma-joined ids of owned shop items. */
  owned: string;
};

/** New accounts start with this much game money. */
export const SIGNUP_BONUS = 1_000_000;

type UserRec = {
  id: string;
  username: string;
  nick: string;
  passHash: string; // hex
  salt: string; // hex (16 bytes)
  createdAt: string;
  balance: number;
  points: number;
  wins: number;
  games: number;
  /** Experience points (레벨 계산용). */
  xp: number;
  /** Game money earned from activities today (daily-cap guard). */
  earnedToday: number;
  /** YYYY-MM-DD the earnedToday counter belongs to. */
  earnDay: string;
  /** Consecutive-day attendance streak. */
  dailyStreak: number;
  /** YYYY-MM-DD of the last claimed attendance bonus. */
  lastDaily: string;
  /** Comma-joined ids of claimed achievements. */
  achievements: string;
  /** Equipped avatar emoji ('' = default initial). */
  avatar: string;
  /** Comma-joined ids of owned shop items. */
  owned: string;
};

type SessionRec = { token: string; userId: string; createdAt: string };

function toPublic(u: UserRec): PublicUser {
  return {
    username: u.username,
    nick: u.nick,
    balance: u.balance ?? 0,
    points: u.points ?? 0,
    wins: u.wins ?? 0,
    games: u.games ?? 0,
    xp: u.xp ?? 0,
    dailyStreak: u.dailyStreak ?? 0,
    lastDaily: u.lastDaily ?? '',
    achievements: u.achievements ?? '',
    avatar: u.avatar ?? '',
    owned: u.owned ?? '',
  };
}

/** Fill in economy fields that predate the reward system. */
function normalizeUser(u: UserRec): UserRec {
  return {
    ...u,
    balance: u.balance ?? 0,
    points: u.points ?? 0,
    wins: u.wins ?? 0,
    games: u.games ?? 0,
    xp: u.xp ?? 0,
    earnedToday: u.earnedToday ?? 0,
    earnDay: u.earnDay ?? '',
    dailyStreak: u.dailyStreak ?? 0,
    lastDaily: u.lastDaily ?? '',
    achievements: u.achievements ?? '',
    avatar: u.avatar ?? '',
    owned: u.owned ?? '',
  };
}

/**
 * Level derived from xp: level = floor(sqrt(xp/100)) + 1.
 * Tiers: 1-4 브론즈, 5-9 실버, 10-14 골드, 15-19 플래티넘, 20+ 다이아.
 * Pure helper; the client pages keep a local mirror because this module is
 * server-only.
 */
export function levelOf(xp: number): { level: number; nameKo: string } {
  const safe = Math.max(0, Math.floor(Number(xp) || 0));
  const level = Math.floor(Math.sqrt(safe / 100)) + 1;
  const tier =
    level >= 20 ? '다이아' : level >= 15 ? '플래티넘' : level >= 10 ? '골드' : level >= 5 ? '실버' : '브론즈';
  return { level, nameKo: `${tier} Lv.${level}` };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------- validation (Korean error messages) ----------

function validateUsername(username: string): void {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    throw new Error('아이디는 3~20자의 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.');
  }
}

function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('비밀번호는 6자 이상이어야 합니다.');
  }
}

function validateNick(nick: string): void {
  if (typeof nick !== 'string' || nick.length < 1 || nick.length > 16) {
    throw new Error('닉네임은 1~16자여야 합니다.');
  }
}

// ---------- password hashing (scrypt + timingSafeEqual) ----------

const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------- backend: file / memory (mirrors roomStore) ----------

function resolveDataDir(): string {
  if (process.env.ROOM_DATA_DIR) return process.env.ROOM_DATA_DIR;
  if (process.env.VERCEL) return path.join(os.tmpdir(), 'gto-rooms');
  return path.join(process.cwd(), '.data');
}
const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, 'users.json');

type FileDb = { users: UserRec[]; sessions: SessionRec[] };

let cache: FileDb | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function fileRead(): Promise<FileDb> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')) as Partial<FileDb>;
    cache = { users: raw.users ?? [], sessions: raw.sessions ?? [] };
  } catch {
    cache = { users: [], sessions: [] };
  }
  return cache!;
}

function fileWrite(db: FileDb): Promise<void> {
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
    pgReady = (async () => {
      await pg().sql`CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        username text UNIQUE NOT NULL,
        nick text NOT NULL,
        pass_hash text NOT NULL,
        salt text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      // Reward-system columns (added later; safe on existing tables).
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance bigint NOT NULL DEFAULT 0`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS points bigint NOT NULL DEFAULT 0`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wins integer NOT NULL DEFAULT 0`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS games integer NOT NULL DEFAULT 0`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS earned_today bigint NOT NULL DEFAULT 0`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS earn_day text NOT NULL DEFAULT ''`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS xp bigint NOT NULL DEFAULT 0`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_streak integer NOT NULL DEFAULT 0`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_daily text NOT NULL DEFAULT ''`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS achievements text NOT NULL DEFAULT ''`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT ''`;
      await pg().sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS owned text NOT NULL DEFAULT ''`;
      await pg().sql`CREATE TABLE IF NOT EXISTS sessions (
        token text PRIMARY KEY,
        user_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    })();
  }
  return pgReady;
}

function rowToUser(r: Record<string, unknown>): UserRec {
  return {
    id: String(r.id),
    username: String(r.username),
    nick: String(r.nick),
    passHash: String(r.pass_hash),
    salt: String(r.salt),
    createdAt: new Date(r.created_at as string | Date).toISOString(),
    balance: Number(r.balance ?? 0),
    points: Number(r.points ?? 0),
    wins: Number(r.wins ?? 0),
    games: Number(r.games ?? 0),
    xp: Number(r.xp ?? 0),
    earnedToday: Number(r.earned_today ?? 0),
    earnDay: String(r.earn_day ?? ''),
    dailyStreak: Number(r.daily_streak ?? 0),
    lastDaily: String(r.last_daily ?? ''),
    achievements: String(r.achievements ?? ''),
    avatar: String(r.avatar ?? ''),
    owned: String(r.owned ?? ''),
  };
}

// ---------- store primitives (backend-agnostic) ----------

async function findUserByUsername(username: string): Promise<UserRec | undefined> {
  if (usePg) {
    await pgEnsure();
    const { rows } = await pg().sql`SELECT * FROM users WHERE lower(username) = lower(${username})`;
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  const db = await fileRead();
  const lower = username.toLowerCase();
  const u = db.users.find((x) => x.username.toLowerCase() === lower);
  return u ? normalizeUser(u) : undefined;
}

async function getUserById(id: string): Promise<UserRec | undefined> {
  if (usePg) {
    await pgEnsure();
    const { rows } = await pg().sql`SELECT * FROM users WHERE id = ${id}`;
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  const db = await fileRead();
  const u = db.users.find((x) => x.id === id);
  return u ? normalizeUser(u) : undefined;
}

async function insertUser(user: UserRec): Promise<void> {
  if (usePg) {
    await pgEnsure();
    const res = await pg().sql`INSERT INTO users (id, username, nick, pass_hash, salt, created_at, balance, points, wins, games, xp, earned_today, earn_day, daily_streak, last_daily, achievements, avatar, owned)
      VALUES (${user.id}, ${user.username}, ${user.nick}, ${user.passHash}, ${user.salt}, ${user.createdAt},
              ${user.balance}, ${user.points}, ${user.wins}, ${user.games}, ${user.xp}, ${user.earnedToday}, ${user.earnDay}, ${user.dailyStreak}, ${user.lastDaily}, ${user.achievements}, ${user.avatar}, ${user.owned})
      ON CONFLICT (username) DO NOTHING`;
    if (res.rowCount === 0) throw new Error('이미 사용 중인 아이디입니다.');
    return;
  }
  const db = await fileRead();
  const lower = user.username.toLowerCase();
  if (db.users.some((u) => u.username.toLowerCase() === lower)) {
    throw new Error('이미 사용 중인 아이디입니다.');
  }
  db.users.push(user);
  await fileWrite(db);
}

async function setNick(userId: string, nick: string): Promise<void> {
  if (usePg) {
    await pgEnsure();
    await pg().sql`UPDATE users SET nick = ${nick} WHERE id = ${userId}`;
    return;
  }
  const db = await fileRead();
  const u = db.users.find((x) => x.id === userId);
  if (u) {
    u.nick = nick;
    await fileWrite(db);
  }
}

async function insertSession(sess: SessionRec): Promise<void> {
  if (usePg) {
    await pgEnsure();
    await pg().sql`INSERT INTO sessions (token, user_id, created_at)
      VALUES (${sess.token}, ${sess.userId}, ${sess.createdAt})`;
    return;
  }
  const db = await fileRead();
  db.sessions.push(sess);
  await fileWrite(db);
}

async function getSession(token: string): Promise<SessionRec | undefined> {
  if (usePg) {
    await pgEnsure();
    const { rows } = await pg().sql`SELECT token, user_id, created_at FROM sessions WHERE token = ${token}`;
    const r = rows[0];
    if (!r) return undefined;
    return {
      token: String(r.token),
      userId: String(r.user_id),
      createdAt: new Date(r.created_at as string | Date).toISOString(),
    };
  }
  const db = await fileRead();
  return db.sessions.find((s) => s.token === token);
}

async function deleteSession(token: string): Promise<void> {
  if (usePg) {
    await pgEnsure();
    await pg().sql`DELETE FROM sessions WHERE token = ${token}`;
    return;
  }
  const db = await fileRead();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.token !== token);
  if (db.sessions.length !== before) await fileWrite(db);
}

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await insertSession({ token, userId, createdAt: new Date().toISOString() });
  return token;
}

// ---------- public API ----------

export async function register(
  username: string,
  password: string,
  nick: string,
): Promise<{ token: string; user: PublicUser }> {
  const uname = (username ?? '').toString().trim();
  const nname = (nick ?? '').toString().trim();
  validateUsername(uname);
  validatePassword(password);
  validateNick(nname);
  if (await findUserByUsername(uname)) throw new Error('이미 사용 중인 아이디입니다.');

  const salt = randomBytes(16);
  const passHash = await scryptAsync(password, salt, KEYLEN);
  const user: UserRec = {
    id: `a${Date.now().toString(36)}${randomBytes(4).toString('hex')}`,
    username: uname,
    nick: nname,
    passHash: passHash.toString('hex'),
    salt: salt.toString('hex'),
    createdAt: new Date().toISOString(),
    balance: SIGNUP_BONUS, // 가입 보너스 게임머니
    points: 0,
    wins: 0,
    games: 0,
    xp: 0,
    earnedToday: 0,
    earnDay: '',
    dailyStreak: 0,
    lastDaily: '',
    achievements: '',
    avatar: '',
    owned: '',
  };
  await insertUser(user);
  const token = await createSession(user.id);
  return { token, user: toPublic(user) };
}

export async function login(
  username: string,
  password: string,
): Promise<{ token: string; user: PublicUser }> {
  const user = await findUserByUsername((username ?? '').toString().trim());
  if (!user || !(await verifyPassword((password ?? '').toString(), user.salt, user.passHash))) {
    throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  const token = await createSession(user.id);
  return { token, user: toPublic(user) };
}

export async function userByToken(token: string | null | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  const sess = await getSession(token);
  if (!sess) return null;
  // Lazy session expiry, matching the cookie's 30-day lifetime.
  if (Date.now() - new Date(sess.createdAt).getTime() > SESSION_MAX_AGE_SEC * 1000) {
    await deleteSession(token).catch(() => {});
    return null;
  }
  const user = await getUserById(sess.userId);
  return user ? toPublic(user) : null;
}

export async function updateNick(token: string | null | undefined, nick: string): Promise<PublicUser> {
  const nname = (nick ?? '').toString().trim();
  validateNick(nname);
  const sess = token ? await getSession(token) : undefined;
  if (!sess) throw new Error('로그인이 필요합니다.');
  const user = await getUserById(sess.userId);
  if (!user) throw new Error('로그인이 필요합니다.');
  await setNick(user.id, nname);
  return toPublic({ ...user, nick: nname });
}

export async function logout(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await deleteSession(token);
}

// ---------- economy (게임머니) ----------

/** Max game money earnable from activities per day (excludes prizes). */
export const DAILY_EARN_CAP = 200_000;

/** Persist just the economy fields of a user (file backend). */
async function saveEconomyFile(u: UserRec): Promise<void> {
  const db = await fileRead();
  const idx = db.users.findIndex((x) => x.id === u.id);
  if (idx >= 0) {
    db.users[idx] = u;
    await fileWrite(db);
  }
}

/** Grant game money for an activity (quiz/study/feature), capped per day. */
export async function earn(
  username: string,
  amount: number,
): Promise<{ balance: number; earned: number; capped: boolean }> {
  const rec = await findUserByUsername(username);
  if (!rec) throw new Error('로그인이 필요합니다.');
  const u = normalizeUser(rec);
  const day = today();
  if (u.earnDay !== day) {
    u.earnDay = day;
    u.earnedToday = 0;
  }
  const room = Math.max(0, DAILY_EARN_CAP - u.earnedToday);
  const grant = Math.max(0, Math.min(Math.floor(amount), room));
  // XP tracks earned money: at least 1 xp per rewarded activity (none if capped out).
  const xpGain = grant > 0 ? Math.max(1, Math.round(grant / 100)) : 0;
  u.earnedToday += grant;
  u.balance += grant;
  u.xp += xpGain;
  if (usePg) {
    await pgEnsure();
    await pg().sql`UPDATE users SET balance = balance + ${grant}, xp = xp + ${xpGain},
      earned_today = ${u.earnedToday}, earn_day = ${u.earnDay}
      WHERE id = ${u.id}`;
  } else {
    await saveEconomyFile(u);
  }
  return { balance: u.balance, earned: grant, capped: grant < Math.floor(amount) };
}

// ---------- daily attendance bonus ----------

/** 7-day attendance reward cycle (game money). Day 7 is the big payout. */
export const DAILY_REWARDS = [50_000, 60_000, 80_000, 100_000, 120_000, 150_000, 300_000];

/** YYYY-MM-DD one day before today (UTC, matching today()). */
function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type DailyStatus = {
  canClaim: boolean;
  streak: number;
  /** 1-based day within the 7-day cycle the NEXT claim would land on. */
  dayInCycle: number;
  /** Reward the next claim would grant. */
  nextReward: number;
  rewards: number[];
};

/** Current attendance status without mutating (for the claim UI). */
export async function dailyStatus(username: string): Promise<DailyStatus> {
  const rec = await findUserByUsername(username);
  if (!rec) throw new Error('로그인이 필요합니다.');
  const u = normalizeUser(rec);
  const claimedToday = u.lastDaily === today();
  // If the streak is unbroken (claimed yesterday) the next claim continues it;
  // otherwise the next claim restarts at day 1.
  const continues = u.lastDaily === yesterday() || claimedToday;
  const nextStreak = claimedToday ? u.dailyStreak : continues ? u.dailyStreak + 1 : 1;
  const dayInCycle = ((Math.max(1, nextStreak) - 1) % 7) + 1;
  return {
    canClaim: !claimedToday,
    streak: u.dailyStreak,
    dayInCycle,
    nextReward: DAILY_REWARDS[dayInCycle - 1],
    rewards: DAILY_REWARDS,
  };
}

/**
 * Claim today's attendance bonus. Idempotent per UTC day. Grants game money
 * (bypasses the activity earn cap — it is a distinct daily reward) plus XP,
 * and advances or resets the streak.
 */
export async function claimDaily(
  username: string,
): Promise<{ claimed: boolean; reward: number; streak: number; dayInCycle: number; balance: number; already?: boolean }> {
  const rec = await findUserByUsername(username);
  if (!rec) throw new Error('로그인이 필요합니다.');
  const u = normalizeUser(rec);
  const day = today();
  if (u.lastDaily === day) {
    return { claimed: false, already: true, reward: 0, streak: u.dailyStreak, dayInCycle: ((Math.max(1, u.dailyStreak) - 1) % 7) + 1, balance: u.balance };
  }
  const newStreak = u.lastDaily === yesterday() ? u.dailyStreak + 1 : 1;
  const dayInCycle = ((newStreak - 1) % 7) + 1;
  const reward = DAILY_REWARDS[dayInCycle - 1];
  const xpGain = Math.max(1, Math.round(reward / 100));
  u.balance += reward;
  u.xp += xpGain;
  u.dailyStreak = newStreak;
  u.lastDaily = day;
  if (usePg) {
    await pgEnsure();
    await pg().sql`UPDATE users SET balance = balance + ${reward}, xp = xp + ${xpGain},
      daily_streak = ${newStreak}, last_daily = ${day} WHERE id = ${u.id} AND last_daily <> ${day}`;
  } else {
    await saveEconomyFile(u);
  }
  return { claimed: true, reward, streak: newStreak, dayInCycle, balance: u.balance };
}

// ---------- achievements (업적) ----------

type AchievementDef = { id: string; nameKo: string; descKo: string; icon: string; reward: number; test: (u: UserRec) => boolean };

/** Milestones derived from existing account stats. Order = display order. */
const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_game', nameKo: '첫 발걸음', descKo: '토너먼트 1게임 참가', icon: '🎯', reward: 20_000, test: (u) => u.games >= 1 },
  { id: 'first_win', nameKo: '첫 승리', descKo: '토너먼트 우승', icon: '🏆', reward: 50_000, test: (u) => u.wins >= 1 },
  { id: 'ten_games', nameKo: '단골 손님', descKo: '토너먼트 10게임 참가', icon: '🎫', reward: 50_000, test: (u) => u.games >= 10 },
  { id: 'five_wins', nameKo: '승부사', descKo: '토너먼트 5회 우승', icon: '👑', reward: 100_000, test: (u) => u.wins >= 5 },
  { id: 'level5', nameKo: '실버 등극', descKo: '레벨 5(실버) 달성', icon: '🥈', reward: 50_000, test: (u) => levelOf(u.xp).level >= 5 },
  { id: 'level10', nameKo: '골드 등극', descKo: '레벨 10(골드) 달성', icon: '🥇', reward: 150_000, test: (u) => levelOf(u.xp).level >= 10 },
  { id: 'rich', nameKo: '백만장자', descKo: '게임머니 500만 보유', icon: '💰', reward: 100_000, test: (u) => u.balance >= 5_000_000 },
  { id: 'streak7', nameKo: '개근상', descKo: '7일 연속 출석', icon: '📅', reward: 100_000, test: (u) => u.dailyStreak >= 7 },
];

export type AchievementView = {
  id: string; nameKo: string; descKo: string; icon: string; reward: number; met: boolean; claimed: boolean;
};

function claimedSet(u: UserRec): Set<string> {
  return new Set((u.achievements ?? '').split(',').filter(Boolean));
}

/** Full achievement list with met/claimed flags for the UI. */
export async function achievementStatus(username: string): Promise<AchievementView[]> {
  const rec = await findUserByUsername(username);
  if (!rec) throw new Error('로그인이 필요합니다.');
  const u = normalizeUser(rec);
  const claimed = claimedSet(u);
  return ACHIEVEMENTS.map((a) => ({
    id: a.id, nameKo: a.nameKo, descKo: a.descKo, icon: a.icon, reward: a.reward,
    met: a.test(u), claimed: claimed.has(a.id),
  }));
}

/** Grant rewards for every met-but-unclaimed achievement. Returns what was claimed. */
export async function claimAchievements(
  username: string,
): Promise<{ claimed: AchievementView[]; reward: number; balance: number }> {
  const rec = await findUserByUsername(username);
  if (!rec) throw new Error('로그인이 필요합니다.');
  const u = normalizeUser(rec);
  const have = claimedSet(u);
  const fresh = ACHIEVEMENTS.filter((a) => a.test(u) && !have.has(a.id));
  if (!fresh.length) return { claimed: [], reward: 0, balance: u.balance };
  const reward = fresh.reduce((a, x) => a + x.reward, 0);
  for (const a of fresh) have.add(a.id);
  const joined = [...have].join(',');
  u.balance += reward;
  u.achievements = joined;
  if (usePg) {
    await pgEnsure();
    await pg().sql`UPDATE users SET balance = balance + ${reward}, achievements = ${joined} WHERE id = ${u.id}`;
  } else {
    await saveEconomyFile(u);
  }
  return {
    claimed: fresh.map((a) => ({ id: a.id, nameKo: a.nameKo, descKo: a.descKo, icon: a.icon, reward: a.reward, met: true, claimed: true })),
    reward,
    balance: u.balance,
  };
}

// ---------- avatar shop (게임머니 소비처) ----------

type ShopItem = { id: string; emoji: string; nameKo: string; cost: number };

/** Buyable avatar emojis. One-time purchase; re-equip is free. */
const SHOP_ITEMS: ShopItem[] = [
  { id: 'cat', emoji: '🐱', nameKo: '냥이', cost: 100_000 },
  { id: 'robot', emoji: '🤖', nameKo: '로봇', cost: 100_000 },
  { id: 'joker', emoji: '🃏', nameKo: '조커', cost: 150_000 },
  { id: 'fire', emoji: '🔥', nameKo: '불꽃', cost: 150_000 },
  { id: 'shark', emoji: '🦈', nameKo: '샤크', cost: 200_000 },
  { id: 'dragon', emoji: '🐉', nameKo: '드래곤', cost: 250_000 },
  { id: 'rocket', emoji: '🚀', nameKo: '로켓', cost: 250_000 },
  { id: 'crown', emoji: '👑', nameKo: '왕관', cost: 400_000 },
  { id: 'diamond', emoji: '💎', nameKo: '다이아', cost: 600_000 },
  { id: 'goat', emoji: '🐐', nameKo: 'GOAT', cost: 1_000_000 },
];

export type ShopView = {
  balance: number;
  avatar: string;
  items: { id: string; emoji: string; nameKo: string; cost: number; owned: boolean; equipped: boolean }[];
};

export async function shopStatus(username: string): Promise<ShopView> {
  const rec = await findUserByUsername(username);
  if (!rec) throw new Error('로그인이 필요합니다.');
  const u = normalizeUser(rec);
  const owned = new Set((u.owned ?? '').split(',').filter(Boolean));
  return {
    balance: u.balance,
    avatar: u.avatar ?? '',
    items: SHOP_ITEMS.map((i) => ({ ...i, owned: owned.has(i.id), equipped: u.avatar === i.emoji })),
  };
}

/**
 * Buy (if needed) and equip an avatar, or reset to the default with id ''.
 * Re-equipping an already-owned avatar is free.
 */
export async function buyAvatar(
  username: string,
  id: string,
): Promise<{ balance: number; avatar: string; owned: string; bought: boolean }> {
  const rec = await findUserByUsername(username);
  if (!rec) throw new Error('로그인이 필요합니다.');
  const u = normalizeUser(rec);
  if (id === '') {
    u.avatar = '';
  } else {
    const item = SHOP_ITEMS.find((i) => i.id === id);
    if (!item) throw new Error('존재하지 않는 아이템입니다.');
    const owned = new Set((u.owned ?? '').split(',').filter(Boolean));
    if (!owned.has(id)) {
      if (u.balance < item.cost) throw new Error('게임머니가 부족합니다.');
      u.balance -= item.cost;
      owned.add(id);
      u.owned = [...owned].join(',');
    }
    u.avatar = item.emoji;
  }
  if (usePg) {
    await pgEnsure();
    await pg().sql`UPDATE users SET balance = ${u.balance}, owned = ${u.owned}, avatar = ${u.avatar} WHERE id = ${u.id}`;
  } else {
    await saveEconomyFile(u);
  }
  const item = SHOP_ITEMS.find((i) => i.id === id);
  return { balance: u.balance, avatar: u.avatar, owned: u.owned, bought: !!item };
}

/** Spend game money (buy-in / rebuy). Throws if the balance is too low. */
export async function spend(username: string, amount: number): Promise<number> {
  const amt = Math.max(0, Math.floor(amount));
  if (usePg) {
    await pgEnsure();
    const res = await pg().sql`UPDATE users SET balance = balance - ${amt}
      WHERE lower(username) = lower(${username}) AND balance >= ${amt} RETURNING balance`;
    if (res.rowCount === 0) throw new Error('게임머니가 부족합니다.');
    return Number(res.rows[0].balance);
  }
  const rec = await findUserByUsername(username);
  if (!rec) throw new Error('로그인이 필요합니다.');
  const u = normalizeUser(rec);
  if (u.balance < amt) throw new Error('게임머니가 부족합니다.');
  u.balance -= amt;
  await saveEconomyFile(u);
  return u.balance;
}

/** Credit a tournament prize and record the game/win. No-op for unknown users. */
export async function awardPrize(username: string, prize: number, isWin: boolean): Promise<void> {
  const amt = Math.max(0, Math.floor(prize));
  const winInc = isWin ? 1 : 0;
  if (usePg) {
    await pgEnsure();
    await pg().sql`UPDATE users SET balance = balance + ${amt}, points = points + ${amt},
      games = games + 1, wins = wins + ${winInc} WHERE lower(username) = lower(${username})`;
    return;
  }
  const rec = await findUserByUsername(username);
  if (!rec) return;
  const u = normalizeUser(rec);
  u.balance += amt;
  u.points += amt;
  u.games += 1;
  u.wins += winInc;
  await saveEconomyFile(u);
}

/** Top members by cumulative winnings (points), then balance. */
export type LeaderboardSort = 'points' | 'balance' | 'xp' | 'wins';

/** Top members, sortable by cumulative winnings / game money / level(xp) / wins. */
export async function leaderboard(limit = 50, sort: LeaderboardSort = 'points'): Promise<PublicUser[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  const key: LeaderboardSort = ['points', 'balance', 'xp', 'wins'].includes(sort) ? sort : 'points';
  if (usePg) {
    await pgEnsure();
    // Column name is from a fixed whitelist above, safe to interpolate.
    const col = key;
    const { rows } = await pg().query(
      `SELECT * FROM users ORDER BY ${col} DESC, points DESC LIMIT $1`,
      [n],
    );
    return rows.map((r: Record<string, unknown>) => toPublic(rowToUser(r)));
  }
  const db = await fileRead();
  return db.users
    .map(normalizeUser)
    .sort((a, b) => (b[key] as number) - (a[key] as number) || b.points - a.points)
    .slice(0, n)
    .map(toPublic);
}
