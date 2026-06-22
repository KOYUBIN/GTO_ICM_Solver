import { NextResponse } from 'next/server';
import { addComment } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/posts/[id]/comments -> add comment {author, body}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { author?: string; body?: string };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const body = (raw.body ?? '').toString().trim();
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const comment = await addComment(id, (raw.author || '익명').toString(), body);
  if (!comment) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(comment, { status: 201 });
}
