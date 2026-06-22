import { NextResponse } from 'next/server';
import { getPost } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/posts/[id] -> single post
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(post);
}
