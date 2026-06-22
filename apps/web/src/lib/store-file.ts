/**
 * File/memory store backend (default when no database is configured).
 *
 * Reads are served from an in-memory cache so the API never fails even when the
 * filesystem is read-only (e.g. serverless), and writes are best-effort
 * persisted to disk so a single long-lived server (Render/Railway, local dev)
 * keeps data.
 *
 * Storage location (first match wins):
 *   1. COMMUNITY_DATA_DIR env var
 *   2. os.tmpdir()/gto-community  on serverless (Vercel) — writable but ephemeral
 *   3. <cwd>/.data                locally — persistent
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { Comment, NewPost, Post, PostType, ArticleCategory } from './community';
import { SEED } from './seed';

function resolveDataDir(): string {
  if (process.env.COMMUNITY_DATA_DIR) return process.env.COMMUNITY_DATA_DIR;
  if (process.env.VERCEL) return path.join(os.tmpdir(), 'gto-community');
  return path.join(process.cwd(), '.data');
}

const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, 'community.json');

interface DB {
  posts: Post[];
}

let writeChain: Promise<void> = Promise.resolve();
// In-memory source of truth for the lifetime of the process; survives a
// read-only filesystem so the API keeps working even when persistence fails.
let cache: DB | null = null;

async function read(): Promise<DB> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    cache = JSON.parse(raw) as DB;
  } catch {
    // First access (or corrupt/read-only): seed and best-effort persist.
    cache = { posts: structuredClone(SEED) };
    await write(cache);
  }
  return cache;
}

// Update the cache, then best-effort persist (serialized, atomic-ish). A
// failed disk write (e.g. serverless read-only FS) is non-fatal: the cache
// still serves reads for this instance's lifetime.
function write(db: DB): Promise<void> {
  cache = db;
  writeChain = writeChain.then(async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${DATA_FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
      await fs.rename(tmp, DATA_FILE);
    } catch {
      // ignore — persistence is optional; cache remains authoritative.
    }
  });
  return writeChain;
}

export async function listPosts(filter?: {
  type?: PostType;
  category?: ArticleCategory;
}): Promise<Post[]> {
  const db = await read();
  let posts = db.posts;
  if (filter?.type) posts = posts.filter((p) => p.type === filter.type);
  if (filter?.category)
    posts = posts.filter((p) => p.type === 'article' && p.category === filter.category);
  return [...posts].sort((a, b) => b.votes - a.votes);
}

export async function getPost(id: string): Promise<Post | undefined> {
  const db = await read();
  return db.posts.find((p) => p.id === id);
}

export async function createPost(post: NewPost): Promise<Post> {
  const db = await read();
  const created = {
    ...post,
    id: `p${Date.now()}`,
    votes: 1,
    createdAt: new Date().toISOString(),
    comments: [],
  } as Post;
  db.posts.unshift(created);
  await write(db);
  return created;
}

export async function addComment(
  postId: string,
  author: string,
  body: string,
): Promise<Comment | undefined> {
  const db = await read();
  const post = db.posts.find((p) => p.id === postId);
  if (!post) return undefined;
  const comment: Comment = {
    id: `c${Date.now()}`,
    author,
    body,
    createdAt: new Date().toISOString(),
  };
  post.comments.push(comment);
  await write(db);
  return comment;
}

export async function votePost(postId: string, delta: number): Promise<Post | undefined> {
  const db = await read();
  const post = db.posts.find((p) => p.id === postId);
  if (!post) return undefined;
  post.votes += delta;
  await write(db);
  return post;
}
