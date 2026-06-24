import { NextResponse } from 'next/server';
import { leaveRoom, toView } from '@/lib/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/[id]/leave -> {playerId} removes a player (folds them out of
// the current hand) and hands off the host role if needed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { playerId?: string };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!raw.playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  const room = await leaveRoom(id, raw.playerId);
  if (!room) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(toView(room, raw.playerId));
}
