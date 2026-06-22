/**
 * Community shared types + client-side fetch helpers.
 *
 * Types are shared by the server store (lib/store.ts) and the client UI.
 * The fetch helpers call the REST API under /api/posts and are the only thing
 * the client should import (the file store is server-only).
 */

export type PostType = 'hand' | 'article';
export type Spot = 'cash' | 'mtt' | 'sng';
export type ArticleCategory = 'chipEV' | 'ICM' | 'bubble' | 'general';

export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

interface BasePost {
  id: string;
  author: string;
  title: string;
  body: string;
  tags: string[];
  votes: number;
  createdAt: string;
  comments: Comment[];
}

export interface HandPost extends BasePost {
  type: 'hand';
  hero: string;
  board: string;
  position: string;
  stakes: string;
  spot: Spot;
}

export interface ArticlePost extends BasePost {
  type: 'article';
  category: ArticleCategory;
}

export type Post = HandPost | ArticlePost;

/** Payload shapes for creating posts (server assigns id/votes/createdAt/comments). */
export type NewHandPost = Omit<HandPost, 'id' | 'votes' | 'createdAt' | 'comments'>;
export type NewArticlePost = Omit<ArticlePost, 'id' | 'votes' | 'createdAt' | 'comments'>;
export type NewPost = NewHandPost | NewArticlePost;

// ----- client fetch helpers -----

export async function fetchPosts(filter?: {
  type?: PostType;
  category?: ArticleCategory;
}): Promise<Post[]> {
  const qs = new URLSearchParams();
  if (filter?.type) qs.set('type', filter.type);
  if (filter?.category) qs.set('category', filter.category);
  const res = await fetch(`/api/posts${qs.toString() ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('failed to fetch posts');
  return res.json();
}

export async function createPost(post: NewPost): Promise<Post> {
  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(post),
  });
  if (!res.ok) throw new Error('failed to create post');
  return res.json();
}

export async function addComment(postId: string, author: string, body: string): Promise<Comment> {
  const res = await fetch(`/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author, body }),
  });
  if (!res.ok) throw new Error('failed to add comment');
  return res.json();
}

export async function vote(postId: string, delta: 1 | -1): Promise<Post> {
  const res = await fetch(`/api/posts/${postId}/vote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delta }),
  });
  if (!res.ok) throw new Error('failed to vote');
  return res.json();
}
