import { NextResponse } from 'next/server';
import { rebuyPlayer, toView } from '@/lib/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/[id]/rebuy -> {playerId} a busted player buys back in.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { playerId?: string };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!raw.playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  try {
    const room = await rebuyPlayer(id, raw.playerId);
    if (!room) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(toView(room, raw.playerId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
