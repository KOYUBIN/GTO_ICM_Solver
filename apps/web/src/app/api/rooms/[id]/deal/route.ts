import { NextResponse } from 'next/server';
import { makeDeal, toView } from '@/lib/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms/[id]/deal -> {playerId, method:'icm'|'chip'} host ends by deal.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { playerId?: string; method?: string };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!raw.playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  const method = raw.method === 'chip' ? 'chip' : raw.method === 'icm' ? 'icm' : null;
  if (!method) return NextResponse.json({ error: 'method must be icm or chip' }, { status: 400 });
  try {
    const room = await makeDeal(id, raw.playerId, method);
    if (!room) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(toView(room, raw.playerId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
