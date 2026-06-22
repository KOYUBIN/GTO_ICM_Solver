import { NextResponse } from 'next/server';
import { votePost } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/posts/[id]/vote -> {delta: 1|-1}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { delta?: number };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const delta = raw.delta === -1 ? -1 : 1;
  const post = await votePost(id, delta);
  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(post);
}
