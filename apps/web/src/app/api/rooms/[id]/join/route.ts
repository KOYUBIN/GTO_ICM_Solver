import { NextRequest, NextResponse } from 'next/server';
import { joinRoom, toView } from '@/lib/roomStore';
import { userByToken, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/[id]/join -> {name} -> adds player, returns {room, playerId}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { name?: string };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const me = token ? await userByToken(token).catch(() => null) : null;
  try {
    const result = await joinRoom(id, (raw.name ?? '').toString(), me?.username);
    if (!result) return NextResponse.json({ error: '방이 없거나 가득 찼습니다.' }, { status: 404 });
    return NextResponse.json(
      { room: toView(result.room, result.playerId), playerId: result.playerId },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
