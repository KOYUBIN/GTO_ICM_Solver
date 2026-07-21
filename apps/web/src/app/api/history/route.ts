import { NextRequest, NextResponse } from 'next/server';
import { userByToken, SESSION_COOKIE } from '@/lib/auth';
import { listPersonalHands } from '@/lib/handhistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/history?limit=50 -> {hands: PersonalHand[]} newest first. Login only.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const me = token ? await userByToken(token).catch(() => null) : null;
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const raw = Number(req.nextUrl.searchParams.get('limit') ?? '50');
  try {
    const hands = await listPersonalHands(me.username, Number.isFinite(raw) ? raw : 50);
    return NextResponse.json({ hands });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
