import { NextRequest, NextResponse } from 'next/server';
import { userByToken, updateNick, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/me -> {user: {username, nick}} or {user: null}
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await userByToken(token).catch(() => null) : null;
  return NextResponse.json({ user });
}

// POST /api/auth/me {nick} -> change nickname -> {user}
export async function POST(req: NextRequest) {
  let body: { nick?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  try {
    const user = await updateNick(token, (body.nick ?? '').toString());
    return NextResponse.json({ user });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === '로그인이 필요합니다.' ? 401 : 400 });
  }
}
