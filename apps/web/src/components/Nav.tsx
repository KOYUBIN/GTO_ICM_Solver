'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Grouped menu for the left drawer. */
const GROUPS: { title: string; links: { href: string; label: string; icon: string }[] }[] = [
  {
    title: '플레이',
    links: [
      { href: '/play', label: '멀티플레이 홀덤', icon: '🃏' },
      { href: '/monster', label: '몬스터 게임', icon: '🎰' },
      { href: '/community', label: '커뮤니티', icon: '💬' },
    ],
  },
  {
    title: '솔버 · 전략',
    links: [
      { href: '/solver', label: '포스트플랍 솔버', icon: '🧠' },
      { href: '/matchup', label: '매치업 · 에쿼티', icon: '⚔️' },
      { href: '/charts', label: '프리플랍 차트 · 레인지', icon: '📊' },
      { href: '/pushfold', label: '푸시/폴드', icon: '📈' },
      { href: '/icm', label: 'ICM 계산기', icon: '🏆' },
    ],
  },
  {
    title: '분석 · 기록',
    links: [
      { href: '/trainer', label: '학습하기', icon: '🎓' },
      { href: '/ranking', label: '랭킹', icon: '🏅' },
      { href: '/replay', label: '리플레이 · 분석', icon: '🎬' },
      { href: '/notes', label: '핸드 기록장', icon: '📓' },
      { href: '/glossary', label: '용어 사전', icon: '📖' },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<{ username: string; nick: string; balance?: number } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setMe(d.user ?? null))
      .catch(() => {});
  }, []);

  // Close on route change and on Escape; lock body scroll while open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  const authHref = me ? '/profile' : '/login';

  return (
    <>
      <button
        className="menu-btn"
        aria-label="메뉴 열기"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="menu-bar" />
        <span className="menu-bar" />
        <span className="menu-bar" />
      </button>

      <Link href={authHref} className="auth-chip" title={me?.username}>
        {me ? (
          <>
            {me.nick}
            {me.balance != null && (
              <span style={{ marginLeft: 6, color: 'var(--warn)', fontWeight: 700 }}>
                💰{me.balance.toLocaleString('ko-KR')}
              </span>
            )}
          </>
        ) : (
          '로그인'
        )}
      </Link>

      {open && <div className="drawer-backdrop" onClick={() => setOpen(false)} />}

      <aside className={`drawer${open ? ' drawer-open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <Link href="/" className="brand" onClick={() => setOpen(false)}>
            GTO<span className="chip">♠</span>Solver
          </Link>
          <button className="drawer-close" aria-label="메뉴 닫기" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        <Link href="/" className={`drawer-link${pathname === '/' ? ' on' : ''}`}>
          <span className="drawer-ico">🏠</span> 대시보드
        </Link>

        {GROUPS.map((g) => (
          <div key={g.title} className="drawer-group">
            <div className="drawer-group-title">{g.title}</div>
            {g.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`drawer-link${pathname.startsWith(l.href) ? ' on' : ''}`}
              >
                <span className="drawer-ico">{l.icon}</span> {l.label}
              </Link>
            ))}
          </div>
        ))}

        <div className="drawer-foot">
          <Link href={authHref} className={`drawer-link${pathname.startsWith(authHref) ? ' on' : ''}`}>
            <span className="drawer-ico">👤</span> {me ? `${me.nick} (프로필)` : '로그인 / 회원가입'}
          </Link>
          <Link href="/setup" className={`drawer-link${pathname.startsWith('/setup') ? ' on' : ''}`}>
            <span className="drawer-ico">⚙️</span> DB 연결 설정
          </Link>
        </div>
      </aside>
    </>
  );
}
