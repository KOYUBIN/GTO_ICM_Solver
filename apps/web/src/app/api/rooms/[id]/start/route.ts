import { NextResponse } from 'next/server';
import { startNextHand, toView } from '@/lib/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/[id]/start -> {playerId} -> host deals the next hand
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { playerId?: string };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const playerId = (raw.playerId ?? '').toString();
  try {
    const room = await startNextHand(id, playerId);
    return NextResponse.json(toView(room, playerId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
