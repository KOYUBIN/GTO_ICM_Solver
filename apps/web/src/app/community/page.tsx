'use client';

import { useState } from 'react';
import { addComment, addPost, fetchFeed, vote, type HandPost } from '@/lib/community';
import { PlayingCards } from '@/components/Cards';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return '방금';
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function CommunityPage() {
  const [feed, setFeed] = useState<HandPost[]>(() => fetchFeed());
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    author: '나',
    title: '',
    hero: '',
    board: '',
    position: '',
    stakes: '',
    spot: 'cash' as HandPost['spot'],
    body: '',
    tags: '',
  });
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  function refresh() {
    setFeed(fetchFeed());
  }

  function submitPost() {
    if (!draft.title.trim()) return;
    addPost({
      author: draft.author || '익명',
      title: draft.title,
      hero: draft.hero,
      board: draft.board,
      position: draft.position,
      stakes: draft.stakes,
      spot: draft.spot,
      body: draft.body,
      tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setDraft({ ...draft, title: '', hero: '', board: '', body: '', tags: '' });
    setShowForm(false);
    refresh();
  }

  function submitComment(postId: string) {
    const body = (commentDrafts[postId] ?? '').trim();
    if (!body) return;
    addComment(postId, '나', body);
    setCommentDrafts({ ...commentDrafts, [postId]: '' });
    refresh();
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>핸드 공유 & 리뷰</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            친구들과 핸드를 공유하고 리뷰·코멘트를 남기세요.
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)}>{showForm ? '닫기' : '핸드 공유'}</button>
      </div>

      {showForm && (
        <div className="card" style={{ marginTop: 18 }}>
          <h2>새 핸드 공유</h2>
          <label>제목</label>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="예: 턴 리레이즈 당한 탑탑 어떻게 플레이?"
          />
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>히어로 핸드</label>
              <input
                type="text"
                value={draft.hero}
                onChange={(e) => setDraft({ ...draft, hero: e.target.value })}
                placeholder="AsKs"
              />
            </div>
            <div>
              <label>보드</label>
              <input
                type="text"
                value={draft.board}
                onChange={(e) => setDraft({ ...draft, board: e.target.value })}
                placeholder="Ah7d2c Ts"
              />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>포지션</label>
              <input
                type="text"
                value={draft.position}
                onChange={(e) => setDraft({ ...draft, position: e.target.value })}
                placeholder="BTN vs BB"
              />
            </div>
            <div>
              <label>스테이크</label>
              <input
                type="text"
                value={draft.stakes}
                onChange={(e) => setDraft({ ...draft, stakes: e.target.value })}
                placeholder="NL50"
              />
            </div>
            <div>
              <label>게임</label>
              <select
                value={draft.spot}
                onChange={(e) => setDraft({ ...draft, spot: e.target.value as HandPost['spot'] })}
              >
                <option value="cash">캐시</option>
                <option value="mtt">MTT</option>
                <option value="sng">SNG</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label>설명</label>
            <textarea
              rows={3}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label>태그 (쉼표 구분)</label>
            <input
              type="text"
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="cbet, turn-decision"
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={submitPost}>공유하기</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        {feed.map((post) => (
          <article key={post.id} className="hand-post">
            <div className="meta">
              <span className="avatar">{post.author[0]}</span>
              <strong style={{ color: 'var(--text)' }}>{post.author}</strong>
              <span>· {post.position}</span>
              <span>· {post.stakes}</span>
              <span>· {post.spot.toUpperCase()}</span>
              <span>· {timeAgo(post.createdAt)}</span>
            </div>
            <h3 style={{ margin: '4px 0 8px' }}>{post.title}</h3>
            {(post.hero || post.board) && (
              <div style={{ margin: '8px 0' }}>
                {post.hero && (
                  <span style={{ marginRight: 12 }}>
                    <span className="muted" style={{ marginRight: 6 }}>
                      핸드
                    </span>
                    <PlayingCards cards={post.hero} />
                  </span>
                )}
                {post.board && (
                  <span>
                    <span className="muted" style={{ marginRight: 6 }}>
                      보드
                    </span>
                    <PlayingCards cards={post.board} />
                  </span>
                )}
              </div>
            )}
            {post.body && <p style={{ margin: '8px 0', lineHeight: 1.55 }}>{post.body}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
              {post.tags.map((t) => (
                <span key={t} className="tag">
                  #{t}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <button
                className="secondary"
                onClick={() => {
                  vote(post.id, 1);
                  refresh();
                }}
              >
                ▲ {post.votes}
              </button>
              <span className="muted">{post.comments.length} 코멘트</span>
            </div>

            <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
              {post.comments.map((c) => (
                <div key={c.id} style={{ marginBottom: 8 }}>
                  <span className="muted">
                    <strong style={{ color: 'var(--text)' }}>{c.author}</strong> · {timeAgo(c.createdAt)}
                  </span>
                  <div style={{ fontSize: 14 }}>{c.body}</div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  type="text"
                  placeholder="리뷰/코멘트 남기기…"
                  value={commentDrafts[post.id] ?? ''}
                  onChange={(e) =>
                    setCommentDrafts({ ...commentDrafts, [post.id]: e.target.value })
                  }
                  onKeyDown={(e) => e.key === 'Enter' && submitComment(post.id)}
                />
                <button onClick={() => submitComment(post.id)}>등록</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
