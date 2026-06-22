/**
 * Community data model + seed data.
 *
 * For the first build this is in-memory mock data. It is intentionally shaped
 * like a real API response so swapping in a backend (REST/Supabase/etc.) later
 * is a drop-in change behind `fetchFeed` / `addPost`.
 */

export interface HandComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface HandPost {
  id: string;
  author: string;
  title: string;
  /** Hero hole cards, e.g. "AsKs". */
  hero: string;
  /** Final board, e.g. "Ah7d2c Ts 9h". */
  board: string;
  position: string;
  stakes: string;
  spot: 'cash' | 'mtt' | 'sng';
  body: string;
  tags: string[];
  votes: number;
  createdAt: string;
  comments: HandComment[];
}

let SEED: HandPost[] = [
  {
    id: 'p1',
    author: '민혁',
    title: 'BTN 3벳 팟에서 AK 셋오버셋 의심',
    hero: 'AsKs',
    board: 'Ah7d2c Ts 9h',
    position: 'BTN vs BB',
    stakes: 'NL50',
    spot: 'cash',
    body: '플랍 c-bet 후 턴에서 리레이즈 당했는데 GTO상 콜/폴드가 궁금합니다. 보드가 드라이해서 밸류 위주라고 봤는데.',
    tags: ['3bet', 'cbet', 'turn-decision'],
    votes: 12,
    createdAt: '2026-06-20T09:30:00Z',
    comments: [
      {
        id: 'c1',
        author: '지원',
        body: '이 보드면 탑탑+넛플드로라 턴 콜은 충분. 솔버상 콜 빈도 높음.',
        createdAt: '2026-06-20T10:05:00Z',
      },
    ],
  },
  {
    id: 'p2',
    author: '수진',
    title: '버블에서 AQ 콜 vs 숏스택 셔브 (ICM)',
    hero: 'AhQd',
    board: '',
    position: 'BB vs BTN',
    stakes: '$22 MTT',
    spot: 'mtt',
    body: '4명 남고 3명 인더머니. 숏스택 12bb 셔브에 AQo 콜이 맞을까요? ICM 압박이 큰 스팟.',
    tags: ['icm', 'bubble', 'preflop'],
    votes: 8,
    createdAt: '2026-06-21T14:10:00Z',
    comments: [],
  },
];

export function fetchFeed(): HandPost[] {
  return [...SEED].sort((a, b) => b.votes - a.votes);
}

export function addPost(post: Omit<HandPost, 'id' | 'votes' | 'createdAt' | 'comments'>): HandPost {
  const created: HandPost = {
    ...post,
    id: `p${Date.now()}`,
    votes: 1,
    createdAt: new Date().toISOString(),
    comments: [],
  };
  SEED = [created, ...SEED];
  return created;
}

export function addComment(postId: string, author: string, body: string): void {
  const post = SEED.find((p) => p.id === postId);
  if (!post) return;
  post.comments.push({
    id: `c${Date.now()}`,
    author,
    body,
    createdAt: new Date().toISOString(),
  });
}

export function vote(postId: string, delta: number): void {
  const post = SEED.find((p) => p.id === postId);
  if (post) post.votes += delta;
}
