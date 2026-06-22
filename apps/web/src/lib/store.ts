/**
 * Server-only JSON-file store for the community backend.
 *
 * Hand-rolled persistence via node `fs` (no native deps). Reads are served from
 * an in-memory cache so the API never fails even when the filesystem is
 * read-only (e.g. serverless), and writes are best-effort persisted to disk so
 * a single long-lived server (Render/Railway, local dev) keeps data.
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

// Seed: the 2 existing hand posts + 3 article posts (chipEV / ICM / bubble).
const SEED: Post[] = [
  {
    id: 'p1',
    type: 'hand',
    author: '민혁',
    title: 'BTN 3벳 팟에서 AK 셋오버셋 의심',
    hero: 'AsKs',
    board: 'Ah7d2c Ts 9h',
    position: 'BTN vs BB',
    stakes: 'NL50',
    spot: 'cash',
    body: '플랍 c-bet 후 턴에서 리레이즈 당했는데 GTO상 콜/폴드가 궁금합니다. 보드가 드라이해서 밸류 위주라고 봤는데.',
    tags: ['3bet', 'cbet', 'turn-decision'],
    votes: 12,
    createdAt: '2026-06-20T09:30:00Z',
    comments: [
      {
        id: 'c1',
        author: '지원',
        body: '이 보드면 탑탑+넛플드로라 턴 콜은 충분. 솔버상 콜 빈도 높음.',
        createdAt: '2026-06-20T10:05:00Z',
      },
    ],
  },
  {
    id: 'p2',
    type: 'hand',
    author: '수진',
    title: '버블에서 AQ 콜 vs 숏스택 셔브 (ICM)',
    hero: 'AhQd',
    board: '',
    position: 'BB vs BTN',
    stakes: '$22 MTT',
    spot: 'mtt',
    body: '4명 남고 3명 인더머니. 숏스택 12bb 셔브에 AQo 콜이 맞을까요? ICM 압박이 큰 스팟.',
    tags: ['icm', 'bubble', 'preflop'],
    votes: 8,
    createdAt: '2026-06-21T14:10:00Z',
    comments: [],
  },
  {
    id: 'a1',
    type: 'article',
    category: 'chipEV',
    author: '코치K',
    title: '칩EV 기초: 왜 캐시게임은 칩EV가 곧 실력인가',
    body: '캐시게임에서는 스택을 언제든 리바이할 수 있으므로 한 칩의 가치가 선형입니다. 따라서 모든 결정은 순수 칩EV를 최대화하면 됩니다. +EV 스팟을 분산 걱정 없이 반복적으로 취하는 것이 장기 수익의 핵심. 콜링 레인지, 3벳 폴라라이즈, c-bet 빈도 모두 칩EV 기준으로 솔버 출력을 따르면 됩니다.',
    tags: ['chipev', 'cash', 'fundamentals'],
    votes: 15,
    createdAt: '2026-06-19T08:00:00Z',
    comments: [],
  },
  {
    id: 'a2',
    type: 'article',
    category: 'ICM',
    author: '토너프로',
    title: 'ICM 전략: 토너먼트에서 칩 ≠ 상금',
    body: 'ICM(Independent Chip Model)은 스택을 기대 상금으로 환산합니다. 칩의 한계 가치가 체감하므로, 칩EV상 +인 콜도 ICM상 폴드가 정답인 경우가 많습니다. 특히 페이점프 직전과 파이널 테이블에서 빅스택은 압박을 가하고 미들스택은 타이트하게 플레이해야 합니다. 리스크 프리미엄을 항상 고려하세요.',
    tags: ['icm', 'mtt', 'finaltable'],
    votes: 11,
    createdAt: '2026-06-20T12:00:00Z',
    comments: [],
  },
  {
    id: 'a3',
    type: 'article',
    category: 'bubble',
    author: '수진',
    title: '버블 플레이: 인더머니 직전 압박 활용법',
    body: '버블은 ICM 압박이 극대화되는 구간입니다. 숏스택은 생존을, 미들스택은 페이점프를 의식하므로 빅스택의 셔브/리셔브 폴드에쿼티가 폭발적으로 올라갑니다. 빅스택이라면 미들스택을 타겟으로 폭넓게 압박하고, 숏스택이라면 더블업 가능 스팟만 골라 셔브하세요. 콜링 레인지는 칩EV보다 훨씬 타이트하게.',
    tags: ['bubble', 'icm', 'mtt'],
    votes: 9,
    createdAt: '2026-06-21T09:00:00Z',
    comments: [],
  },
];

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
