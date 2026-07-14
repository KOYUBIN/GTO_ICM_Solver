import { NextRequest, NextResponse } from 'next/server';
import { createRoom, listPublicRooms } from '@/lib/roomStore';
import type { RoomConfig } from '@/lib/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/rooms -> create a room {name, hostName, config} -> {room, playerId}
export async function POST(req: NextRequest) {
  let raw: { name?: string; hostName?: string; config?: Partial<RoomConfig> };
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const c = raw.config ?? {};
  const sb = num(c.smallBlind, 10);
  const bb = num(c.bigBlind, Math.max(sb * 2, 20));
  const config: RoomConfig = {
    presetId: (c.presetId ?? 'custom').toString(),
    presetName: (c.presetName ?? '커스텀').toString(),
    startingStack: num(c.startingStack, 1500),
    smallBlind: sb,
    bigBlind: bb,
    ante: num(c.ante, 0),
    levelMinutes: num(c.levelMinutes, 0),
    actionTimeoutSec: Math.min(120, num(c.actionTimeoutSec, 30)),
    autoNextHand: c.autoNextHand !== false,
    allowRebuy: c.allowRebuy !== false,
    isPublic: c.isPublic === true,
    levels: sanitizeLevels(c.levels),
  };
  if (config.bigBlind <= 0 || config.startingStack < config.bigBlind) {
    return NextResponse.json({ error: '블라인드/스택 설정이 올바르지 않습니다.' }, { status: 400 });
  }

  const { room, playerId } = await createRoom(
    (raw.name ?? '').toString(),
    (raw.hostName ?? '').toString(),
    config,
  );
  return NextResponse.json({ room, playerId }, { status: 201 });
}

// GET /api/rooms -> public lobby list (sanitized summaries only).
export async function GET() {
  try {
    const rooms = await listPublicRooms();
    return NextResponse.json({ rooms });
  } catch (e) {
    return NextResponse.json({ rooms: [], error: (e as Error).message }, { status: 200 });
  }
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Validate a client-supplied blind ladder; drop it unless every level is sane.
function sanitizeLevels(v: unknown): RoomConfig['levels'] {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out = v.map((lv, i) => {
    const o = (lv ?? {}) as Record<string, unknown>;
    const bb = num(o.bigBlind, 0);
    return { level: i + 1, smallBlind: num(o.smallBlind, 0), bigBlind: bb, ante: num(o.ante, 0) };
  });
  if (out.some((l) => l.bigBlind <= 0)) return undefined;
  return out;
}
