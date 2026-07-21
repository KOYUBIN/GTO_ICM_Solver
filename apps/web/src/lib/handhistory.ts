/**
 * Per-account hand history store (server-only).
 *
 * Every finished multiplayer hand is recorded once per logged-in player, from
 * that player's perspective (their own hole cards, their chip delta). Pluggable
 * like the room/auth stores: Postgres when POSTGRES_URL is set (cross-instance,
 * works on Vercel serverless), otherwise a file fallback (.data/hands.json)
 * that is fine for local dev or a single long-lived server.
 *
 * Retention: at most MAX_HANDS_PER_USER hands per account (oldest pruned).
 * Hand ids are deterministic (room+hand+user), so replayed appends from
 * concurrent instances are idempotent on both backends.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { HAS_PG, pgPool } from './pg';

const usePg = HAS_PG;
const pg = pgPool;

/** Max hands retained per account (oldest pruned on append). */
export const MAX_HANDS_PER_USER = 200;

/** One finished hand, from a single logged-in player's perspective. */
export type PersonalHand = {
  id: string;
  /** Member account (username) this record belongs to. */
  username: string;
  /** ISO time the hand ended. */
  at: string;
  /** Room join code, e.g. "K3F9". */
  roomCode: string;
  roomName: string;
  handNumber: number;
  /** The player's table display name at the time. */
  heroName: string;
  /** The player's own hole cards, e.g. "AhKd" ('' if unknown). */
  heroCards: string;
  /** Board, e.g. "Ks7h2cQd3s" ('' on a preflop fold-around). */
  board: string;
  pot: number;
  /** Chips won minus chips committed this hand. */
  delta: number;
  won: boolean;
  winners: { name: string; amount: number; hand: string }[];
  /** Showdown reveals copied from the room record (already privacy-safe). */
  revealed: { name: string; cards: string }[];
};

// ---------- backend: file / memory (mirrors roomStore/auth) ----------

function resolveDataDir(): string {
  if (process.env.ROOM_DATA_DIR) return process.env.ROOM_DATA_DIR;
  if (process.env.VERCEL) return path.join(os.tmpdir(), 'gto-rooms');
  return path.join(process.cwd(), '.data');
}
const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, 'hands.json');

/** username -> that user's hands, oldest first (newest appended last). */
type FileDb = Record<string, PersonalHand[]>;

let cache: FileDb | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function fileRead(): Promise<FileDb> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch {
    cache = {};
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
      await pg().sql`CREATE TABLE IF NOT EXISTS personal_hands (
        id text PRIMARY KEY,
        username text NOT NULL,
        at timestamptz NOT NULL,
        data jsonb NOT NULL
      )`;
      await pg().sql`CREATE INDEX IF NOT EXISTS personal_hands_user_at
        ON personal_hands (username, at DESC)`;
    })();
  }
  return pgReady;
}

// ---------- public API (backend-agnostic) ----------

/**
 * Append finished hands to their owners' histories, pruning each affected
 * user down to MAX_HANDS_PER_USER. Idempotent per hand id.
 */
export async function appendPersonalHands(entries: PersonalHand[]): Promise<void> {
  if (!entries.length) return;
  if (usePg) {
    await pgEnsure();
    for (const h of entries) {
      await pg().sql`INSERT INTO personal_hands (id, username, at, data)
        VALUES (${h.id}, ${h.username}, ${h.at}, ${JSON.stringify(h)}::jsonb)
        ON CONFLICT (id) DO NOTHING`;
    }
    for (const username of new Set(entries.map((e) => e.username))) {
      await pg().sql`DELETE FROM personal_hands
        WHERE username = ${username} AND id NOT IN (
          SELECT id FROM personal_hands WHERE username = ${username}
          ORDER BY at DESC, id DESC LIMIT ${MAX_HANDS_PER_USER}
        )`;
    }
    return;
  }
  const db = await fileRead();
  for (const h of entries) {
    const list = (db[h.username] ??= []);
    if (list.some((x) => x.id === h.id)) continue; // already recorded
    list.push(h);
    if (list.length > MAX_HANDS_PER_USER) list.splice(0, list.length - MAX_HANDS_PER_USER);
  }
  await fileWrite(db);
}

/** A user's recorded hands, newest first (bounded by the retention cap). */
export async function listPersonalHands(username: string, limit = 50): Promise<PersonalHand[]> {
  const n = Math.max(
    1,
    Math.min(MAX_HANDS_PER_USER, Number.isFinite(limit) ? Math.floor(limit) : 50),
  );
  if (usePg) {
    await pgEnsure();
    const { rows } = await pg().sql`SELECT data FROM personal_hands
      WHERE username = ${username} ORDER BY at DESC, id DESC LIMIT ${n}`;
    return rows.map((r) => r.data as PersonalHand);
  }
  const db = await fileRead();
  return (db[username] ?? []).slice(-n).reverse();
}
