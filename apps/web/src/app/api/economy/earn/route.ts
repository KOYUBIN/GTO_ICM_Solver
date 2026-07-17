import { NextRequest, NextResponse } from 'next/server';
import { earn, userByToken, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-defined reward per activity (client can't set the amount).
const REWARDS: Record<string, number> = {
  quiz: 1000, // 퀴즈 정답
  study: 1000, // 학습 완료
  feature: 500, // 기능 사용
};

// POST /api/economy/earn {reason} -> grants game money (daily-capped). Login only.
export async function POST(req: NextRequest) {
  let raw: { reason?: string };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const amount = REWARDS[(raw.reason ?? '').toString()];
  if (!amount) return NextResponse.json({ error: 'unknown reason' }, { status: 400 });

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const me = token ? await userByToken(token).catch(() => null) : null;
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const res = await earn(me.username, amount);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
