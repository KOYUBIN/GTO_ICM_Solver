'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
  { href: '/community', label: '커뮤니티' },
];

export function Nav() {
  const pathname = usePathname();
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
    </nav>
  );
}
