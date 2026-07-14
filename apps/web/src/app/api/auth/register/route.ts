import { NextRequest, NextResponse } from 'next/server';
import { register, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/register {username, password, nick} -> {user} + session cookie
export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string; nick?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  try {
    const { token, user } = await register(
      (body.username ?? '').toString(),
      (body.password ?? '').toString(),
      (body.nick ?? '').toString(),
    );
    const res = NextResponse.json({ user }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
      secure: process.env.NODE_ENV === 'production',
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
