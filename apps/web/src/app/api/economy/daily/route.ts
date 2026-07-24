import { NextRequest, NextResponse } from 'next/server';
import { claimDaily, dailyStatus, userByToken, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function meFrom(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? userByToken(token).catch(() => null) : null;
}

// GET /api/economy/daily -> attendance status for the claim UI.
export async function GET(req: NextRequest) {
  const me = await meFrom(req);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    return NextResponse.json(await dailyStatus(me.username));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// POST /api/economy/daily -> claim today's bonus (idempotent per day).
export async function POST(req: NextRequest) {
  const me = await meFrom(req);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    return NextResponse.json(await claimDaily(me.username));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
