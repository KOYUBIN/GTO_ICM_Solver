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

export type PublicUser = { username: string; nick: string };

type UserRec = {
  id: string;
  username: string;
  nick: string;
  passHash: string; // hex
  salt: string; // hex (16 bytes)
  createdAt: string;
};

type SessionRec = { token: string; userId: string; createdAt: string };

function toPublic(u: UserRec): PublicUser {
  return { username: u.username, nick: u.nick };
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
  };
}

// ---------- store primitives (backend-agnostic) ----------

async function findUserByUsername(username: string): Promise<UserRec | undefined> {
  if (usePg) {
    await pgEnsure();
    const { rows } = await pg().sql`SELECT id, username, nick, pass_hash, salt, created_at
      FROM users WHERE lower(username) = lower(${username})`;
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  const db = await fileRead();
  const lower = username.toLowerCase();
  return db.users.find((u) => u.username.toLowerCase() === lower);
}

async function getUserById(id: string): Promise<UserRec | undefined> {
  if (usePg) {
    await pgEnsure();
    const { rows } = await pg().sql`SELECT id, username, nick, pass_hash, salt, created_at
      FROM users WHERE id = ${id}`;
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
  const db = await fileRead();
  return db.users.find((u) => u.id === id);
}

async function insertUser(user: UserRec): Promise<void> {
  if (usePg) {
    await pgEnsure();
    const res = await pg().sql`INSERT INTO users (id, username, nick, pass_hash, salt, created_at)
      VALUES (${user.id}, ${user.username}, ${user.nick}, ${user.passHash}, ${user.salt}, ${user.createdAt})
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
  return { username: user.username, nick: nname };
}

export async function logout(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await deleteSession(token);
}
