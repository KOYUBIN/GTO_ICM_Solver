import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'GTO/ICM Solver',
  description:
    'No-Limit Hold’em GTO & ICM solver with equity, ranges, push/fold and a hand-sharing community. Reference: GTO Wizard.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'GTO Solver', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e1116',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Nav />
            <Link href="/" className="brand" aria-label="홈으로">
              GTO<span className="chip">♠</span>Solver
            </Link>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
