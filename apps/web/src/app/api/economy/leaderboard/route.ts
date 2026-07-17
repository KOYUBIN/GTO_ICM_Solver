import { NextResponse } from 'next/server';
import { leaderboard } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/economy/leaderboard -> top members by cumulative winnings.
export async function GET() {
  try {
    const rows = await leaderboard(50);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ rows: [], error: (e as Error).message }, { status: 200 });
  }
}
