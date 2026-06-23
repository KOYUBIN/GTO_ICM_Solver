import { NextResponse } from 'next/server';
import { doAction, toView } from '@/lib/roomStore';
import type { Action, ActionType } from '@gto/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: ActionType[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

// POST /api/rooms/[id]/action -> {playerId, action} -> applies a holdem action
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let raw: { playerId?: string; action?: Partial<Action> };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const playerId = (raw.playerId ?? '').toString();
  const type = raw.action?.type;
  if (!type || !TYPES.includes(type)) {
    return NextResponse.json({ error: '알 수 없는 액션 타입입니다.' }, { status: 400 });
  }
  const action: Action = { type };
  if (raw.action?.amount != null) {
    const amt = Number(raw.action.amount);
    if (Number.isFinite(amt)) action.amount = Math.floor(amt);
  }
  try {
    const room = await doAction(id, playerId, action);
    return NextResponse.json(toView(room, playerId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
