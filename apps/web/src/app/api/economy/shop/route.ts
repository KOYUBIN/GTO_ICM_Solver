import { NextRequest, NextResponse } from 'next/server';
import { shopStatus, buyAvatar, userByToken, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function meFrom(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? userByToken(token).catch(() => null) : null;
}

// GET /api/economy/shop -> items with owned/equipped flags + balance.
export async function GET(req: NextRequest) {
  const me = await meFrom(req);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    return NextResponse.json(await shopStatus(me.username));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// POST /api/economy/shop {id} -> buy (if needed) + equip; id '' resets to default.
export async function POST(req: NextRequest) {
  const me = await meFrom(req);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await buyAvatar(me.username, (body.id ?? '').toString()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
