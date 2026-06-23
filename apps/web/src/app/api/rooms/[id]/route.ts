import { NextRequest, NextResponse } from 'next/server';
import { getRoom, toView } from '@/lib/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/rooms/[id]?playerId= -> current room view (hole cards redacted per
// viewer; clients POLL this ~1.5s).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = req.nextUrl.searchParams.get('playerId') ?? undefined;
  const room = await getRoom(id);
  if (!room) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(toView(room, playerId));
}
