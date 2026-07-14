import { NextRequest, NextResponse } from 'next/server';
import { addChat } from '@/lib/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/[id]/chat {playerId, text} -> append a table-chat message.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { playerId?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.playerId || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'playerId와 text가 필요합니다.' }, { status: 400 });
  }
  try {
    await addChat(id, body.playerId, body.text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
