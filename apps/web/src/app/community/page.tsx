'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addComment,
  createPost,
  fetchPosts,
  vote,
  type ArticleCategory,
  type Post,
  type PostType,
  type Spot,
} from '@/lib/community';
import { PlayingCards } from '@/components/Cards';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return '방금';
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

const CATEGORY_LABEL: Record<ArticleCategory, string> = {
  chipEV: '칩EV',
  ICM: 'ICM',
  bubble: '버블',
  general: '일반',
};
const CATEGORIES: ArticleCategory[] = ['chipEV', 'ICM', 'bubble', 'general'];

export default function CommunityPage() {
  const [tab, setTab] = useState<PostType>('hand');
  const [category, setCategory] = useState<ArticleCategory | 'all'>('all');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const [handDraft, setHandDraft] = useState({
    author: '나',
    title: '',
    hero: '',
    board: '',
    position: '',
    stakes: '',
    spot: 'cash' as Spot,
    body: '',
    tags: '',
  });
  const [articleDraft, setArticleDraft] = useState({
    author: '나',
    title: '',
    category: 'chipEV' as ArticleCategory,
    body: '',
    tags: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPosts({
        type: tab,
        category: tab === 'article' && category !== 'all' ? category : undefined,
      });
      setPosts(data);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [tab, category]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submitHand() {
    if (!handDraft.title.trim()) return;
    await createPost({
      type: 'hand',
      author: handDraft.author || '익명',
      title: handDraft.title,
      hero: handDraft.hero,
      board: handDraft.board,
      position: handDraft.position,
      stakes: handDraft.stakes,
      spot: handDraft.spot,
      body: handDraft.body,
      tags: handDraft.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setHandDraft({ ...handDraft, title: '', hero: '', board: '', body: '', tags: '' });
    setShowForm(false);
    refresh();
  }

  async function submitArticle() {
    if (!articleDraft.title.trim()) return;
    await createPost({
      type: 'article',
      author: articleDraft.author || '익명',
      title: articleDraft.title,
      category: articleDraft.category,
      body: articleDraft.body,
      tags: articleDraft.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setArticleDraft({ ...articleDraft, title: '', body: '', tags: '' });
    setShowForm(false);
    refresh();
  }

  async function submitComment(postId: string) {
    const body = (commentDrafts[postId] ?? '').trim();
    if (!body) return;
    await addComment(postId, '나', body);
    setCommentDrafts({ ...commentDrafts, [postId]: '' });
    refresh();
  }

  async function upvote(postId: string) {
    await vote(postId, 1);
    refresh();
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>커뮤니티</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            핸드를 리뷰하고 칩EV·ICM·버블 전략을 공유하세요.
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)}>
          {showForm ? '닫기' : tab === 'hand' ? '핸드 공유' : '글 작성'}
        </button>
      </div>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          className={tab === 'hand' ? '' : 'secondary'}
          onClick={() => {
            setTab('hand');
            setShowForm(false);
          }}
        >
          핸드 리뷰
        </button>
        <button
          className={tab === 'article' ? '' : 'secondary'}
          onClick={() => {
            setTab('article');
            setShowForm(false);
          }}
        >
          전략 컨텐츠
        </button>
      </div>

      {/* article category chips */}
      {tab === 'article' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button
            className={`pill ${category === 'all' ? 'push' : ''}`}
            onClick={() => setCategory('all')}
          >
            전체
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`pill ${category === c ? 'push' : ''}`}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      )}

      {/* create forms */}
      {showForm && tab === 'hand' && (
        <div className="card" style={{ marginTop: 18 }}>
          <h2>새 핸드 공유</h2>
          <label>제목</label>
          <input
            type="text"
            value={handDraft.title}
            onChange={(e) => setHandDraft({ ...handDraft, title: e.target.value })}
            placeholder="예: 턴 리레이즈 당한 탑탑 어떻게 플레이?"
          />
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>히어로 핸드</label>
              <input
                type="text"
                value={handDraft.hero}
                onChange={(e) => setHandDraft({ ...handDraft, hero: e.target.value })}
                placeholder="AsKs"
              />
            </div>
            <div>
              <label>보드</label>
              <input
                type="text"
                value={handDraft.board}
                onChange={(e) => setHandDraft({ ...handDraft, board: e.target.value })}
                placeholder="Ah7d2c Ts"
              />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>포지션</label>
              <input
                type="text"
                value={handDraft.position}
                onChange={(e) => setHandDraft({ ...handDraft, position: e.target.value })}
                placeholder="BTN vs BB"
              />
            </div>
            <div>
              <label>스테이크</label>
              <input
                type="text"
                value={handDraft.stakes}
                onChange={(e) => setHandDraft({ ...handDraft, stakes: e.target.value })}
                placeholder="NL50"
              />
            </div>
            <div>
              <label>게임</label>
              <select
                value={handDraft.spot}
                onChange={(e) => setHandDraft({ ...handDraft, spot: e.target.value as Spot })}
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
              value={handDraft.body}
              onChange={(e) => setHandDraft({ ...handDraft, body: e.target.value })}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label>태그 (쉼표 구분)</label>
            <input
              type="text"
              value={handDraft.tags}
              onChange={(e) => setHandDraft({ ...handDraft, tags: e.target.value })}
              placeholder="cbet, turn-decision"
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={submitHand}>공유하기</button>
          </div>
        </div>
      )}

      {showForm && tab === 'article' && (
        <div className="card" style={{ marginTop: 18 }}>
          <h2>새 전략 글</h2>
          <label>제목</label>
          <input
            type="text"
            value={articleDraft.title}
            onChange={(e) => setArticleDraft({ ...articleDraft, title: e.target.value })}
            placeholder="예: ICM 압박 하에서의 콜링 레인지"
          />
          <div style={{ marginTop: 12 }}>
            <label>카테고리</label>
            <select
              value={articleDraft.category}
              onChange={(e) =>
                setArticleDraft({ ...articleDraft, category: e.target.value as ArticleCategory })
              }
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 12 }}>
            <label>본문</label>
            <textarea
              rows={6}
              value={articleDraft.body}
              onChange={(e) => setArticleDraft({ ...articleDraft, body: e.target.value })}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label>태그 (쉼표 구분)</label>
            <input
              type="text"
              value={articleDraft.tags}
              onChange={(e) => setArticleDraft({ ...articleDraft, tags: e.target.value })}
              placeholder="icm, mtt"
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={submitArticle}>작성하기</button>
          </div>
        </div>
      )}

      {/* feed */}
      <div className="card" style={{ marginTop: 18 }}>
        {loading ? (
          <p className="muted">불러오는 중…</p>
        ) : posts.length === 0 ? (
          <p className="muted">아직 글이 없습니다. 첫 글을 작성해보세요.</p>
        ) : (
          posts.map((post) => (
            <article key={post.id} className="hand-post">
              <div className="meta">
                <span className="avatar">{post.author[0]}</span>
                <strong style={{ color: 'var(--text)' }}>{post.author}</strong>
                {post.type === 'hand' ? (
                  <>
                    <span>· {post.position}</span>
                    <span>· {post.stakes}</span>
                    <span>· {post.spot.toUpperCase()}</span>
                  </>
                ) : (
                  <span className="pill push">{CATEGORY_LABEL[post.category]}</span>
                )}
                <span>· {timeAgo(post.createdAt)}</span>
              </div>
              <h3 style={{ margin: '4px 0 8px' }}>{post.title}</h3>
              {post.type === 'hand' && (post.hero || post.board) && (
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
                <button className="secondary" onClick={() => upvote(post.id)}>
                  ▲ {post.votes}
                </button>
                <span className="muted">{post.comments.length} 코멘트</span>
              </div>

              <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
                {post.comments.map((c) => (
                  <div key={c.id} style={{ marginBottom: 8 }}>
                    <span className="muted">
                      <strong style={{ color: 'var(--text)' }}>{c.author}</strong> ·{' '}
                      {timeAgo(c.createdAt)}
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
          ))
        )}
      </div>
    </div>
  );
}
