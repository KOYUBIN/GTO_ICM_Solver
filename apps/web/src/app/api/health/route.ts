import { NextResponse } from 'next/server';
import { STORE_BACKEND, listPosts } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/health -> { backend, posts } so you can confirm whether the
// permanent Postgres store is active (vs the ephemeral file/memory fallback).
export async function GET() {
  try {
    const posts = await listPosts();
    return NextResponse.json({ ok: true, backend: STORE_BACKEND, posts: posts.length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, backend: STORE_BACKEND, error: (e as Error).message },
      { status: 500 },
    );
  }
}
