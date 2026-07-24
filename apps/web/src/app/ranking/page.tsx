'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Row = {
  username: string;
  nick: string;
  balance: number;
  points: number;
  wins: number;
  games: number;
  xp?: number;
};

const won = (x: number) => (Math.round(x) || 0).toLocaleString('ko-KR');

// Client-side mirror of levelOf() in @/lib/auth (server-only module).
function levelOf(xp: number): { level: number; nameKo: string } {
  const safe = Math.max(0, Math.floor(xp) || 0);
  const level = Math.floor(Math.sqrt(safe / 100)) + 1;
  const tier =
    level >= 20 ? '다이아' : level >= 15 ? '플래티넘' : level >= 10 ? '골드' : level >= 5 ? '실버' : '브론즈';
  return { level, nameKo: `${tier} Lv.${level}` };
}

const SORTS = [
  { key: 'points', label: '누적 상금' },
  { key: 'xp', label: '레벨' },
  { key: 'balance', label: '게임머니' },
  { key: 'wins', label: '우승' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

export default function RankingPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('points');

  useEffect(() => {
    setRows(null);
    fetch(`/api/economy/leaderboard?sort=${sort}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .catch(() => setRows([]));
  }, [sort]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setMe(d.user?.username ?? null))
      .catch(() => {});
  }, []);

  return (
    <div className="container">
      <h1>🏅 랭킹</h1>
      <p className="subtitle">
        기준을 바꿔 순위를 볼 수 있습니다. 게임머니는 퀴즈·학습으로 벌고, 토너먼트 바이인에 쓰고,
        우승하면 상금으로 받습니다.
      </p>

      {/* Sort tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            className="secondary"
            onClick={() => setSort(s.key)}
            style={{
              padding: '8px 14px',
              fontWeight: 700,
              borderColor: sort === s.key ? 'var(--accent)' : 'var(--border)',
              color: sort === s.key ? 'var(--accent)' : 'var(--text-dim)',
              background: sort === s.key ? 'rgba(63,185,80,0.12)' : 'var(--bg-elevated)',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>불러오는 중…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            아직 랭킹이 없습니다. <Link href="/trainer">학습하기</Link>로 게임머니를 벌고{' '}
            <Link href="/monster">몬스터 게임</Link>에 참가해 보세요.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px 6px 0' }}>순위</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>닉네임</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>레벨</th>
                  <th style={{ padding: '6px 8px' }}>누적 상금</th>
                  <th style={{ padding: '6px 8px' }}>게임머니</th>
                  <th style={{ padding: '6px 0 6px 8px' }}>우승/게임</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isMe = me != null && r.username === me;
                  return (
                    <tr
                      key={r.username}
                      style={{
                        borderTop: '1px solid var(--border)',
                        textAlign: 'right',
                        background: isMe ? 'rgba(240,180,0,0.12)' : undefined,
                      }}
                    >
                      <td style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontWeight: 700 }}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                      </td>
                      <td style={{ textAlign: 'left', padding: '8px', fontWeight: 600 }}>
                        {r.nick}
                        {isMe ? ' (나)' : ''}
                      </td>
                      <td style={{ textAlign: 'left', padding: '8px', whiteSpace: 'nowrap' }}>
                        {levelOf(r.xp ?? 0).nameKo}
                      </td>
                      <td style={{ padding: '8px', fontWeight: 700 }}>{won(r.points)}</td>
                      <td style={{ padding: '8px' }}>{won(r.balance)}</td>
                      <td style={{ padding: '8px 0 8px 8px' }}>
                        {r.wins}/{r.games}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
