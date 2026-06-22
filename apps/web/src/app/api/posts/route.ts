import { NextRequest, NextResponse } from 'next/server';
import { createPost, listPosts } from '@/lib/store';
import type { ArticleCategory, NewPost, PostType } from '@/lib/community';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SPOTS = ['cash', 'mtt', 'sng'];
const CATEGORIES = ['chipEV', 'ICM', 'bubble', 'general'];

// GET /api/posts?type=&category= -> list (votes desc), optional filters
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') as PostType | null;
  const category = sp.get('category') as ArticleCategory | null;
  const posts = await listPosts({
    type: type ?? undefined,
    category: category ?? undefined,
  });
  return NextResponse.json(posts);
}

// POST /api/posts -> create
export async function POST(req: NextRequest) {
  let raw: Partial<NewPost>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const author = (raw.author || '익명').toString();
  const title = (raw.title ?? '').toString().trim();
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const body = (raw.body ?? '').toString();
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];

  if (raw.type === 'article') {
    const category = String((raw as { category?: string }).category ?? '');
    if (!CATEGORIES.includes(category))
      return NextResponse.json({ error: 'invalid category' }, { status: 400 });
    const created = await createPost({
      type: 'article',
      author,
      title,
      body,
      tags,
      category: category as ArticleCategory,
    });
    return NextResponse.json(created, { status: 201 });
  }

  if (raw.type === 'hand') {
    const h = raw as Record<string, unknown>;
    const spot = String(h.spot ?? 'cash');
    if (!SPOTS.includes(spot))
      return NextResponse.json({ error: 'invalid spot' }, { status: 400 });
    const created = await createPost({
      type: 'hand',
      author,
      title,
      body,
      tags,
      hero: String(h.hero ?? ''),
      board: String(h.board ?? ''),
      position: String(h.position ?? ''),
      stakes: String(h.stakes ?? ''),
      spot: spot as 'cash' | 'mtt' | 'sng',
    });
    return NextResponse.json(created, { status: 201 });
  }

  return NextResponse.json({ error: 'invalid type' }, { status: 400 });
}
