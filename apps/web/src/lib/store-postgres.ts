/**
 * Postgres store backend (used when POSTGRES_URL is set, e.g. Vercel Postgres).
 *
 * Posts are stored one row each with the full object in a JSONB column, which
 * keeps the discriminated-union shape (hand vs article) intact without a wide
 * schema. The schema is created and seeded once per process on first access.
 */

import { sql } from '@vercel/postgres';
import type { Comment, NewPost, Post, PostType, ArticleCategory } from './community';
import { SEED } from './seed';

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) ready = init();
  return ready;
}

async function init(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS posts (
    id text PRIMARY KEY,
    type text NOT NULL,
    category text,
    votes integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    data jsonb NOT NULL
  )`;
  const { rows } = await sql`SELECT count(*)::int AS n FROM posts`;
  if (rows[0].n === 0) {
    for (const p of SEED) {
      const category = p.type === 'article' ? p.category : null;
      await sql`INSERT INTO posts (id, type, category, votes, created_at, data)
        VALUES (${p.id}, ${p.type}, ${category}, ${p.votes}, ${p.createdAt}, ${JSON.stringify(p)}::jsonb)
        ON CONFLICT (id) DO NOTHING`;
    }
  }
}

export async function listPosts(filter?: {
  type?: PostType;
  category?: ArticleCategory;
}): Promise<Post[]> {
  await ensure();
  const res =
    filter?.type && filter?.category
      ? await sql`SELECT data FROM posts
          WHERE type = ${filter.type} AND category = ${filter.category}
          ORDER BY votes DESC`
      : filter?.type
        ? await sql`SELECT data FROM posts WHERE type = ${filter.type} ORDER BY votes DESC`
        : await sql`SELECT data FROM posts ORDER BY votes DESC`;
  return res.rows.map((r) => r.data as Post);
}

export async function getPost(id: string): Promise<Post | undefined> {
  await ensure();
  const { rows } = await sql`SELECT data FROM posts WHERE id = ${id}`;
  return rows[0]?.data as Post | undefined;
}

export async function createPost(post: NewPost): Promise<Post> {
  await ensure();
  const created = {
    ...post,
    id: `p${Date.now()}`,
    votes: 1,
    createdAt: new Date().toISOString(),
    comments: [],
  } as Post;
  const category = created.type === 'article' ? created.category : null;
  await sql`INSERT INTO posts (id, type, category, votes, created_at, data)
    VALUES (${created.id}, ${created.type}, ${category}, ${created.votes}, ${created.createdAt}, ${JSON.stringify(
      created,
    )}::jsonb)`;
  return created;
}

export async function addComment(
  postId: string,
  author: string,
  body: string,
): Promise<Comment | undefined> {
  await ensure();
  const { rows } = await sql`SELECT data FROM posts WHERE id = ${postId}`;
  if (!rows[0]) return undefined;
  const post = rows[0].data as Post;
  const comment: Comment = {
    id: `c${Date.now()}`,
    author,
    body,
    createdAt: new Date().toISOString(),
  };
  post.comments.push(comment);
  await sql`UPDATE posts SET data = ${JSON.stringify(post)}::jsonb WHERE id = ${postId}`;
  return comment;
}

export async function votePost(postId: string, delta: number): Promise<Post | undefined> {
  await ensure();
  const { rows } = await sql`SELECT data FROM posts WHERE id = ${postId}`;
  if (!rows[0]) return undefined;
  const post = rows[0].data as Post;
  post.votes += delta;
  await sql`UPDATE posts SET votes = ${post.votes}, data = ${JSON.stringify(post)}::jsonb WHERE id = ${postId}`;
  return post;
}
