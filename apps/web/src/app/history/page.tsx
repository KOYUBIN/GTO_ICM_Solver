'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PersonalHand } from '@/lib/handhistory';

const SUIT_GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

/** "AhKd" → colored card spans (4-color deck, same classes as the tables). */
function Cards({ str, w = 26 }: { str: string; w?: number }) {
  const cs = str.match(/.{2}/g) ?? [];
  if (!cs.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle' }}>
      {cs.map((c, i) => (
        <span
          key={i}
          className={`playing-card suit-${c[1]}`}
          style={{ width: w, height: Math.round(w * 1.4), fontSize: Math.round(w * 0.5), marginRight: 0 }}
        >
          {c[0].toUpperCase()}
          {SUIT_GLYPH[c[1]] ?? ''}
        </span>
      ))}
    </span>
  );
}

/** Relative time ("5분 전"), falling back to a KST date for older hands. */
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(t).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

/** Full KST timestamp for tooltips. */
function fullTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function handLabel(hand: string): string {
  return hand === 'uncontested' ? '폴드 승' : hand;
}

/**
 * Open a showdown hand in the /replay street-equity analyzer.
 * Same sessionStorage handoff as the in-room 지난 핸드 panel (play/Table.tsx).
 */
function analyze(h: PersonalHand) {
  const cards: string[] = [];
  for (const r of h.revealed.slice(0, 2)) {
    const cs = r.cards.match(/.{2}/g) ?? [];
    cards.push(...cs.slice(0, 2));
  }
  for (const cs of h.board.match(/.{2}/g) ?? []) cards.push(cs);
  try {
    sessionStorage.setItem(
      'replayPrefill',
      JSON.stringify({ title: `${h.roomName} · 핸드 #${h.handNumber}`, pot: String(h.pot), cards }),
    );
  } catch {
    /* ignore */
  }
  window.open('/replay?from=history', '_blank');
}

function Row({ h }: { h: PersonalHand }) {
  const [open, setOpen] = useState(false);
  const deltaColor = h.delta > 0 ? 'var(--accent)' : h.delta < 0 ? 'var(--danger)' : 'var(--text-dim)';
  const deltaText =
    h.delta > 0 ? `+${h.delta.toLocaleString()}` : h.delta < 0 ? h.delta.toLocaleString() : '±0';
  // Same threshold as the in-room panel: board + 2 revealed hands → analyzable.
  const canReplay = !!h.board && h.revealed.length >= 2;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 13,
        background: 'var(--bg-card)',
      }}
    >
      <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span>
            <strong>#{h.handNumber}</strong> {h.roomName}
            <span className="muted" title={fullTime(h.at)} style={{ marginLeft: 8, fontSize: 12 }}>
              {relTime(h.at)}
            </span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {h.won && <span title="이긴 핸드">🏆</span>}
            <strong style={{ color: deltaColor }}>{deltaText}</strong>
            <span className="muted" style={{ fontSize: 11 }}>
              {open ? '▲' : '▼'}
            </span>
          </span>
        </div>
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '6px 14px',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              내 카드
            </span>
            {h.heroCards ? <Cards str={h.heroCards} /> : <span className="muted">?</span>}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              보드
            </span>
            {h.board ? (
              <Cards str={h.board} w={22} />
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>
                프리플랍 종료
              </span>
            )}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            팟 {h.pot.toLocaleString()}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            승자 {h.winners.map((w) => w.name).join(', ') || '—'}
          </span>
        </div>
      </div>

      {open && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            marginTop: 10,
            paddingTop: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div>
            <span className="muted" style={{ fontSize: 12, marginRight: 8 }}>
              승자
            </span>
            {h.winners.map((w, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {w.name} <strong style={{ color: 'var(--accent)' }}>+{w.amount.toLocaleString()}</strong>{' '}
                <span className="muted">({handLabel(w.hand)})</span>
              </span>
            ))}
          </div>
          {h.revealed.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 14px' }}>
              <span className="muted" style={{ fontSize: 12 }}>
                쇼다운
              </span>
              {h.revealed.map((r, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {r.name} <Cards str={r.cards} w={22} />
                </span>
              ))}
            </div>
          )}
          {canReplay && (
            <div>
              <button
                className="secondary"
                onClick={() => analyze(h)}
                style={{ padding: '4px 12px', fontSize: 12 }}
              >
                리플레이 분석 →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  // undefined = loading, null = not logged in, [] = loaded (maybe empty).
  const [hands, setHands] = useState<PersonalHand[] | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/history?limit=100')
      .then(async (r) => {
        if (r.status === 401) {
          setHands(null);
          return;
        }
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || '기록을 불러오지 못했습니다.');
        setHands(Array.isArray(d.hands) ? d.hands : []);
      })
      .catch((e) => setError((e as Error).message || '기록을 불러오지 못했습니다.'));
  }, []);

  if (error) {
    return (
      <div className="container" style={{ maxWidth: 720 }}>
        <h1>🕘 핸드 히스토리</h1>
        <div className="card">
          <p className="muted" style={{ margin: 0, color: 'var(--danger)' }}>
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (hands === undefined) {
    return (
      <div className="container" style={{ maxWidth: 720 }}>
        <h1>🕘 핸드 히스토리</h1>
        <p className="muted">불러오는 중…</p>
      </div>
    );
  }

  if (hands === null) {
    return (
      <div className="container" style={{ maxWidth: 720 }}>
        <h1>🕘 핸드 히스토리</h1>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            로그인하면 멀티플레이에서 친 핸드가 자동으로 저장됩니다.
          </p>
          <Link href="/login" className="btn-link">
            로그인하러 가기 →
          </Link>
        </div>
      </div>
    );
  }

  const wins = hands.filter((h) => h.won).length;
  const net = hands.reduce((s, h) => s + h.delta, 0);
  const netColor = net > 0 ? 'var(--accent)' : net < 0 ? 'var(--danger)' : 'var(--text-dim)';
  const netText = net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString();

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1>🕘 핸드 히스토리</h1>
      <p className="subtitle">
        멀티플레이 홀덤에서 로그인 상태로 친 핸드가 자동 저장됩니다 (최근 200핸드). 줄을 누르면
        승자·쇼다운 카드까지 펼쳐 볼 수 있어요.
      </p>

      {hands.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            아직 기록된 핸드가 없습니다. 방에 들어가 한 핸드만 쳐도 여기에 쌓입니다.
          </p>
          <Link href="/play" className="btn-link">
            멀티플레이 홀덤으로 →
          </Link>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="pill" style={{ background: 'var(--bg-elevated)' }}>
              최근 {hands.length}핸드
            </span>
            <span className="pill" style={{ background: 'var(--bg-elevated)' }}>
              승리 {wins} · 패배 {hands.length - wins}
            </span>
            <span className="pill" style={{ background: 'var(--bg-elevated)', color: netColor }}>
              칩 수지 {netText}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hands.map((h) => (
              <Row key={h.id} h={h} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
