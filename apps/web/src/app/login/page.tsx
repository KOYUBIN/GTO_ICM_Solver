'use client';

import { useState } from 'react';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nick, setNick] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'register' ? { username, password, nick } : { username, password },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? '요청을 처리하지 못했습니다.');
      location.href = '/';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 440 }}>
      <h1>{mode === 'login' ? '로그인' : '회원가입'}</h1>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className={mode === 'login' ? '' : 'secondary'}
            onClick={() => switchMode('login')}
          >
            로그인
          </button>
          <button
            type="button"
            className={mode === 'register' ? '' : 'secondary'}
            onClick={() => switchMode('register')}
          >
            회원가입
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <label>아이디</label>
          <input
            type="text"
            value={username}
            maxLength={20}
            autoComplete="username"
            placeholder="영문/숫자/밑줄 3~20자"
            onChange={(e) => setUsername(e.target.value)}
          />
          <label>비밀번호</label>
          <input
            type="password"
            value={password}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder="6자 이상"
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && (
            <>
              <label>닉네임</label>
              <input
                type="text"
                value={nick}
                maxLength={16}
                placeholder="예: 철수 (1~16자)"
                onChange={(e) => setNick(e.target.value)}
              />
            </>
          )}
          {error && <p style={{ color: 'var(--danger)', margin: '10px 0 0' }}>{error}</p>}
          <button type="submit" disabled={busy} style={{ marginTop: 14, width: '100%' }}>
            {busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}
          </button>
        </form>
      </div>
    </div>
  );
}
