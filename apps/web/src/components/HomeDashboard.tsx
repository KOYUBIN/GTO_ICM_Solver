'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/** Client-side mirror of levelOf() in @/lib/auth (server-only module). */
function levelOf(xp: number): { level: number; nameKo: string } {
  const safe = Math.max(0, Math.floor(xp) || 0);
  const level = Math.floor(Math.sqrt(safe / 100)) + 1;
  const tier =
    level >= 20 ? '다이아' : level >= 15 ? '플래티넘' : level >= 10 ? '골드' : level >= 5 ? '실버' : '브론즈';
  return { level, nameKo: `${tier} Lv.${level}` };
}

/** XP thresholds so we can draw progress to the next level. */
function levelProgress(xp: number): { pct: number; toNext: number } {
  const safe = Math.max(0, Math.floor(xp) || 0);
  const level = Math.floor(Math.sqrt(safe / 100)) + 1;
  const base = 100 * (level - 1) * (level - 1); // xp at start of this level
  const next = 100 * level * level; // xp needed for the next level
  const span = next - base || 1;
  return { pct: Math.max(0, Math.min(100, ((safe - base) / span) * 100)), toNext: Math.max(0, next - safe) };
}

const won = (x: number) => (Math.round(x) || 0).toLocaleString('ko-KR');

type Me = { username: string; nick: string; balance?: number; points?: number; wins?: number; games?: number; xp?: number; avatar?: string };
type Hand = { id: string; roomName: string; delta: number; won: boolean; at: string };

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

type Daily = { canClaim: boolean; streak: number; dayInCycle: number; nextReward: number; rewards: number[] };

export function HomeDashboard() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = loading
  const [hands, setHands] = useState<Hand[]>([]);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setMe(d.user ?? null);
        if (d.user) {
          fetch('/api/history?limit=3')
            .then((r) => (r.ok ? r.json() : { hands: [] }))
            .then((h) => alive && setHands(h.hands ?? []))
            .catch(() => {});
          fetch('/api/economy/daily')
            .then((r) => (r.ok ? r.json() : null))
            .then((s) => alive && s && !s.error && setDaily(s))
            .catch(() => {});
        }
      })
      .catch(() => alive && setMe(null));
    return () => {
      alive = false;
    };
  }, []);

  async function claimDaily() {
    if (claiming) return;
    setClaiming(true);
    try {
      const r = await fetch('/api/economy/daily', { method: 'POST' });
      const d = await r.json();
      if (r.ok && d.claimed) {
        setClaimMsg(`💰 +${won(d.reward)} 게임머니 (${d.streak}일 연속!)`);
        setMe((m) => (m ? { ...m, balance: (m.balance ?? 0) + d.reward } : m));
        setDaily((s) => (s ? { ...s, canClaim: false, streak: d.streak } : s));
      } else if (d.already) {
        setClaimMsg('오늘은 이미 받았습니다.');
        setDaily((s) => (s ? { ...s, canClaim: false } : s));
      }
    } catch {
      /* ignore */
    } finally {
      setClaiming(false);
    }
  }

  if (me === undefined) return null; // avoid layout flash while loading

  // Logged out — compact CTA.
  if (me === null) {
    return (
      <div
        className="card"
        style={{ marginBottom: 22, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}
      >
        <div>
          <strong style={{ fontSize: 15 }}>로그인하면 게임머니·레벨·핸드 기록이 시작됩니다</strong>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            가입하면 100만 게임머니 지급 · 학습으로 벌고 · 토너먼트에서 겨루고 · 랭킹에 도전하세요.
          </p>
        </div>
        <Link href="/login" className="pill" style={{ background: 'rgba(63,185,80,0.14)', border: '1px solid var(--accent)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 800, padding: '8px 16px' }}>
          로그인 / 회원가입 →
        </Link>
      </div>
    );
  }

  const lv = levelOf(me.xp ?? 0);
  const prog = levelProgress(me.xp ?? 0);

  return (
    <div className="card" style={{ marginBottom: 22, border: '1px solid var(--accent-dim)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          {me.avatar && <span style={{ fontSize: 18, marginRight: 4 }}>{me.avatar}</span>}
          <span style={{ fontSize: 16, fontWeight: 800 }}>{me.nick}</span>{' '}
          <span className="pill" style={{ background: 'rgba(240,180,0,0.14)', color: 'var(--warn)', fontWeight: 800, marginLeft: 4 }}>
            {lv.nameKo}
          </span>
        </div>
        <Link href="/profile" className="muted" style={{ fontSize: 13, textDecoration: 'none' }}>
          내 프로필 →
        </Link>
      </div>

      {/* Level progress */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
          <span>XP {won(me.xp ?? 0)}</span>
          <span>다음 레벨까지 {won(prog.toNext)} XP</span>
        </div>
        <div style={{ height: 8, borderRadius: 5, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
          <div style={{ width: `${prog.pct}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {[
          ['💰 게임머니', `${won(me.balance ?? 0)}`],
          ['🏆 누적 상금', `${won(me.points ?? 0)}`],
          ['우승/게임', `${me.wins ?? 0}/${me.games ?? 0}`],
        ].map(([k, v]) => (
          <div key={k} style={{ flex: '1 1 100px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 11 }}>{k}</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Daily attendance bonus */}
      {daily && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-elevated)', border: `1px solid ${daily.canClaim ? 'var(--warn)' : 'var(--border)'}`, borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              📅 출석 보너스 {daily.streak > 0 && <span className="muted" style={{ fontWeight: 400 }}>· {daily.streak}일 연속</span>}
            </span>
            <button
              onClick={claimDaily}
              disabled={!daily.canClaim || claiming}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 800,
                borderRadius: 8,
                border: 'none',
                cursor: daily.canClaim ? 'pointer' : 'default',
                background: daily.canClaim ? 'var(--warn)' : 'var(--bg)',
                color: daily.canClaim ? '#0a0e13' : 'var(--text-dim)',
              }}
            >
              {daily.canClaim ? `받기 (+${won(daily.nextReward)})` : '오늘 완료 ✓'}
            </button>
          </div>
          {/* 7-day strip */}
          <div style={{ display: 'flex', gap: 4 }}>
            {daily.rewards.map((r, i) => {
              const dayNo = i + 1;
              const isNext = daily.canClaim && dayNo === daily.dayInCycle;
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '4px 2px',
                    borderRadius: 6,
                    fontSize: 10,
                    border: isNext ? '1px solid var(--warn)' : '1px solid var(--border)',
                    background: isNext ? 'rgba(240,180,0,0.14)' : 'var(--bg)',
                    color: isNext ? 'var(--warn)' : 'var(--text-dim)',
                    fontWeight: isNext ? 800 : 400,
                  }}
                >
                  <div>{dayNo}일</div>
                  <div>{r >= 10000 ? `${Math.round(r / 10000)}만` : r}</div>
                </div>
              );
            })}
          </div>
          {claimMsg && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{claimMsg}</p>}
        </div>
      )}

      {/* Recent hands */}
      {hands.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>최근 핸드</span>
            <Link href="/history" className="muted" style={{ fontSize: 12, textDecoration: 'none' }}>전체 보기 →</Link>
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            {hands.map((h) => (
              <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
                <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                  {h.roomName} · {relTime(h.at)}
                </span>
                <span style={{ fontWeight: 800, color: h.delta > 0 ? 'var(--accent)' : h.delta < 0 ? 'var(--danger)' : 'var(--text-dim)' }}>
                  {h.delta > 0 ? '+' : ''}{won(h.delta)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <Link href="/play" className="pill" style={{ background: 'rgba(63,185,80,0.12)', border: '1px solid var(--accent)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 700 }}>
          🤖 AI와 바로 연습
        </Link>
        <Link href="/trainer" className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none', fontWeight: 700 }}>
          🎓 학습하고 게임머니 벌기
        </Link>
        <Link href="/monster" className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none', fontWeight: 700 }}>
          🎰 몬스터 게임
        </Link>
        <Link href="/ranking" className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none', fontWeight: 700 }}>
          🏅 랭킹
        </Link>
      </div>
    </div>
  );
}
