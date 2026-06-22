/**
 * Community store facade.
 *
 * Picks the backend at runtime: Postgres when POSTGRES_URL is configured
 * (e.g. Vercel Postgres / Neon / Supabase), otherwise the file/memory store.
 * Both backends expose the same five functions, so the API routes are agnostic.
 *
 * To enable permanent storage on Vercel: create a Postgres database in the
 * dashboard (it injects POSTGRES_URL automatically) and redeploy.
 */

import * as fileStore from './store-file';
import * as pgStore from './store-postgres';

const backend = process.env.POSTGRES_URL ? pgStore : fileStore;

export const listPosts = backend.listPosts;
export const getPost = backend.getPost;
export const createPost = backend.createPost;
export const addComment = backend.addComment;
export const votePost = backend.votePost;

/** Which backend is active (for diagnostics / a health endpoint). */
export const STORE_BACKEND = process.env.POSTGRES_URL ? 'postgres' : 'file';
