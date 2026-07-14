'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type User = { username: string; nick: string };

export default function ProfilePage() {
  // undefined = loading, null = not logged in
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [nick, setNick] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user ?? null);
        if (d.user) setNick(d.user.nick);
      })
      .catch(() => setUser(null));
  }, []);

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
