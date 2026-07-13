import { NextRequest, NextResponse } from 'next/server';
import { tickAndGet, toView } from '@/lib/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/rooms/[id]?playerId= -> current room view (hole cards redacted per
// viewer; clients POLL this ~1.5s). Polling also drives lazy enforcement of the
// action timer and auto-advance to the next hand.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = req.nextUrl.searchParams.get('playerId') ?? undefined;
  const room = await tickAndGet(id);
  if (!room) return NextResponse.json({ error: '방을 찾을 수 없습니다' }, { status: 404 });
  return NextResponse.json(toView(room, playerId));
}
