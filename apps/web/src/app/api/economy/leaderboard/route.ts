import { NextRequest, NextResponse } from 'next/server';
import { leaderboard, type LeaderboardSort } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/economy/leaderboard?sort=points|balance|xp|wins -> top members.
export async function GET(req: NextRequest) {
  const sort = (req.nextUrl.searchParams.get('sort') ?? 'points') as LeaderboardSort;
  try {
    const rows = await leaderboard(50, sort);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ rows: [], error: (e as Error).message }, { status: 200 });
  }
}
