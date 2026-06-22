import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'GTO/ICM Solver',
  description:
    'No-Limit Hold’em GTO & ICM solver with equity, ranges, push/fold and a hand-sharing community. Reference: GTO Wizard.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">
              GTO<span className="chip">♠</span>Solver
            </div>
            <Nav />
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
