import { NextResponse } from 'next/server';
import { joinRoom, toView } from '@/lib/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/[id]/join -> {name} -> adds player, returns {room, playerId}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { name?: string };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const result = await joinRoom(id, (raw.name ?? '').toString());
  if (!result) return NextResponse.json({ error: '방이 없거나 가득 찼습니다.' }, { status: 404 });
  return NextResponse.json({ room: toView(result.room, result.playerId), playerId: result.playerId }, {
    status: 201,
  });
}
