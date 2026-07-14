'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/', label: '대시보드' },
  { href: '/play', label: '🃏 홀덤', hot: true },
  { href: '/solver', label: '솔버' },
  { href: '/charts', label: '차트' },
  { href: '/equity', label: '에쿼티' },
  { href: '/ranges', label: '레인지' },
  { href: '/pushfold', label: '푸시/폴드' },
  { href: '/icm', label: 'ICM' },
  { href: '/replay', label: '리플레이' },
  { href: '/analyze', label: '핸드분석' },
  { href: '/notes', label: '기록장' },
  { href: '/community', label: '커뮤니티' },
];

export function Nav() {
  const pathname = usePathname();
  const [me, setMe] = useState<{ username: string; nick: string } | null>(null);
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setMe(d.user ?? null))
      .catch(() => {});
  }, []);
  const authHref = me ? '/profile' : '/login';
  return (
    <nav className="nav">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={`${active ? 'active' : ''}${'hot' in l && l.hot ? ' nav-hot' : ''}`}>
            {l.label}
          </Link>
        );
      })}
      <Link
        href={authHref}
        className={pathname.startsWith(authHref) ? 'active' : ''}
        style={{ marginLeft: 'auto' }}
        title={me?.username}
      >
        {me ? me.nick : '로그인'}
      </Link>
    </nav>
  );
}
