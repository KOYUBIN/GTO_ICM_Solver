/**
 * Shared Postgres connection for the web app.
 *
 * Vercel's Postgres integration injects POSTGRES_URL; some Neon-native
 * integrations inject DATABASE_URL instead. Accept either so a freshly
 * provisioned database works without renaming env vars. When neither is set the
 * app falls back to the per-instance file/memory store (fine for local dev, but
 * NOT for multiplayer across Vercel serverless instances).
 */

import { createPool, type VercelPool } from '@vercel/postgres';

export const PG_CONN = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
export const HAS_PG = !!PG_CONN;

let _pool: VercelPool | null = null;
export function pgPool(): VercelPool {
  if (!_pool) _pool = createPool({ connectionString: PG_CONN });
  return _pool;
}
