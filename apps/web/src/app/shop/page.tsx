'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Item = { id: string; emoji: string; nameKo: string; cost: number; owned: boolean; equipped: boolean };
type Shop = { balance: number; avatar: string; items: Item[] };

const won = (x: number) => (Math.round(x) || 0).toLocaleString('ko-KR');

export default function ShopPage() {
  const [shop, setShop] = useState<Shop | null | undefined>(undefined); // undefined=loading, null=logged out
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  function load() {
    fetch('/api/economy/shop')
      .then((r) => (r.status === 401 ? null : r.json()))
      .then((d) => setShop(d && !d.error ? d : d === null ? null : null))
      .catch(() => setShop(null));
  }

  useEffect(() => {
    load();
  }, []);

  async function act(id: string) {
    setBusy(id || 'reset');
    setMsg('');
    try {
      const r = await fetch('/api/economy/shop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error ?? '실패했습니다.');
      } else {
        setMsg(id === '' ? '기본 아바타로 변경했습니다.' : '적용되었습니다!');
        load();
      }
    } catch {
      setMsg('네트워크 오류');
    } finally {
      setBusy(null);
    }
  }

  if (shop === undefined) {
    return (
      <div className="container" style={{ maxWidth: 560 }}>
        <p className="muted">불러오는 중…</p>
      </div>
    );
  }

  if (shop === null) {
    return (
      <div className="container" style={{ maxWidth: 560 }}>
        <h1>🛍️ 아바타 상점</h1>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>로그인이 필요합니다.</p>
          <Link href="/login" className="btn-link">로그인하러 가기 →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 620 }}>
      <h1>🛍️ 아바타 상점</h1>
      <p className="subtitle">
        게임머니로 아바타를 구입하세요. 랭킹·프로필·홈에서 닉네임 옆에 표시됩니다. 한 번 사면 언제든 무료로
        다시 장착할 수 있어요.
      </p>

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontWeight: 700 }}>
          현재 아바타: <span style={{ fontSize: 22 }}>{shop.avatar || '🙂(기본)'}</span>
        </span>
        <span style={{ fontWeight: 800, color: 'var(--warn)' }}>💰 {won(shop.balance)}</span>
      </div>
      {msg && <p style={{ color: 'var(--accent)', fontWeight: 700, margin: '4px 2px' }}>{msg}</p>}

      <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {shop.avatar && (
          <button
            onClick={() => act('')}
            disabled={busy != null}
            className="card"
            style={{ textAlign: 'center', cursor: 'pointer', border: '1px solid var(--border)' }}
          >
            <div style={{ fontSize: 30 }}>🙂</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>기본으로</div>
            <div className="muted" style={{ fontSize: 12 }}>해제</div>
          </button>
        )}
        {shop.items.map((it) => {
          const canBuy = !it.owned && shop.balance >= it.cost;
          return (
            <button
              key={it.id}
              onClick={() => (it.owned || canBuy) && act(it.id)}
              disabled={busy != null || (!it.owned && !canBuy)}
              className="card"
              style={{
                textAlign: 'center',
                cursor: it.owned || canBuy ? 'pointer' : 'default',
                border: it.equipped ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: it.equipped ? 'rgba(63,185,80,0.08)' : undefined,
                opacity: !it.owned && !canBuy ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 34 }}>{it.emoji}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{it.nameKo}</div>
              <div style={{ fontSize: 12, marginTop: 2, color: it.owned ? 'var(--accent)' : 'var(--warn)', fontWeight: 700 }}>
                {it.equipped ? '장착 중 ✓' : it.owned ? '보유 · 장착' : `💰 ${won(it.cost)}`}
              </div>
            </button>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        게임머니는 <Link href="/trainer">학습</Link>·<Link href="/">출석</Link>·토너먼트 상금으로 모을 수 있습니다.
      </p>
    </div>
  );
}
