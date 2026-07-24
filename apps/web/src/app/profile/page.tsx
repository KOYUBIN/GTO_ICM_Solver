'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type User = {
  username: string;
  nick: string;
  balance?: number;
  points?: number;
  wins?: number;
  games?: number;
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

type Achievement = { id: string; nameKo: string; descKo: string; icon: string; reward: number; met: boolean; claimed: boolean };

export default function ProfilePage() {
  // undefined = loading, null = not logged in
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [nick, setNick] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [achs, setAchs] = useState<Achievement[]>([]);
  const [achMsg, setAchMsg] = useState('');

  function loadAchievements() {
    fetch('/api/economy/achievements')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAchs(d.items ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user ?? null);
        if (d.user) {
          setNick(d.user.nick);
          loadAchievements();
        }
      })
      .catch(() => setUser(null));
  }, []);

  async function claimAchievements() {
    try {
      const r = await fetch('/api/economy/achievements', { method: 'POST' });
      const d = await r.json();
      if (r.ok && d.reward > 0) {
        setAchMsg(`💰 +${won(d.reward)} 게임머니 획득! (${d.claimed.length}개 업적)`);
        setUser((u) => (u ? { ...u, balance: (u.balance ?? 0) + d.reward } : u));
        loadAchievements();
      } else {
        setAchMsg('받을 수 있는 업적이 없습니다.');
      }
    } catch {
      /* ignore */
    }
  }

  async function saveNick(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? '닉네임을 변경하지 못했습니다.');
      setUser(data.user);
      setMsg('닉네임이 변경되었습니다.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  }

  if (user === undefined) {
    return (
      <div className="container" style={{ maxWidth: 440 }}>
        <p className="muted">불러오는 중…</p>
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="container" style={{ maxWidth: 440 }}>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>로그인이 필요합니다.</p>
          <Link href="/login" className="btn-link">로그인하러 가기 →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 440 }}>
      <h1>내 프로필</h1>
      <div className="card" style={{ border: '2px solid var(--warn)' }}>
        <div className="stat">
          <span>💰 게임머니</span>
          <span className="val" style={{ color: 'var(--warn)' }}>{won(user.balance ?? 0)} GM</span>
        </div>
        <div className="stat">
          <span>레벨</span>
          <span className="val" style={{ color: 'var(--accent)' }}>{levelOf(user.xp ?? 0).nameKo}</span>
        </div>
        <div className="stat">
          <span>XP</span>
          <span className="val">{won(user.xp ?? 0)} XP</span>
        </div>
        <div className="stat">
          <span>누적 상금(랭킹 점수)</span>
          <span className="val">{won(user.points ?? 0)}</span>
        </div>
        <div className="stat">
          <span>우승 / 참가</span>
          <span className="val">{user.wins ?? 0}승 / {user.games ?? 0}게임</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <Link href="/ranking" className="btn-link">🏅 랭킹 보기 →</Link>
        </div>
      </div>

      {/* 업적 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            🏅 업적 <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({achs.filter((a) => a.claimed).length}/{achs.length})</span>
          </h2>
          {achs.some((a) => a.met && !a.claimed) && (
            <button onClick={claimAchievements} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 800 }}>
              보상 받기 (+{won(achs.filter((a) => a.met && !a.claimed).reduce((s, a) => s + a.reward, 0))})
            </button>
          )}
        </div>
        {achMsg && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>{achMsg}</p>}
        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          {achs.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: a.claimed ? 'rgba(63,185,80,0.06)' : a.met ? 'rgba(240,180,0,0.08)' : 'var(--bg-elevated)',
                opacity: a.met ? 1 : 0.55,
              }}
            >
              <span style={{ fontSize: 22, filter: a.met ? 'none' : 'grayscale(1)' }}>{a.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {a.nameKo}
                  {a.claimed ? <span className="pill" style={{ marginLeft: 6, background: 'rgba(63,185,80,0.18)', color: 'var(--accent)', fontSize: 11 }}>완료</span>
                    : a.met ? <span className="pill" style={{ marginLeft: 6, background: 'rgba(240,180,0,0.18)', color: 'var(--warn)', fontSize: 11 }}>받기 가능</span>
                    : null}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{a.descKo}</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--warn)', whiteSpace: 'nowrap' }}>+{won(a.reward)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <label>아이디</label>
        <p style={{ margin: '4px 0 14px' }}>
          <strong>{user.username}</strong>
        </p>
        <form onSubmit={saveNick}>
          <label>닉네임</label>
          <input
            type="text"
            value={nick}
            maxLength={16}
            onChange={(e) => setNick(e.target.value)}
          />
          {error && <p style={{ color: 'var(--danger)', margin: '10px 0 0' }}>{error}</p>}
          {msg && <p style={{ color: 'var(--accent)', margin: '10px 0 0' }}>{msg}</p>}
          <button type="submit" disabled={busy} style={{ marginTop: 12 }}>
            닉네임 변경
          </button>
        </form>
      </div>
      <div className="card">
        <button className="secondary" onClick={onLogout}>
          로그아웃
        </button>
      </div>
    </div>
  );
}
