import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Card, styles } from '../components/ui';
import { theme } from '../theme';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

interface Comment {
  author: string;
  body: string;
}

interface Post {
  type: 'hand' | 'article';
  author: string;
  title: string;
  hero?: string;
  board?: string;
  position?: string;
  stakes?: string;
  spot?: string;
  category?: string;
  body: string;
  tags: string[];
  votes: number;
  comments: Comment[];
}

const CATEGORY_LABEL: Record<string, string> = {
  chipEV: '칩EV',
  ICM: 'ICM',
  bubble: '버블',
  general: '일반',
};

// Offline fallback (matches the web seed shape).
const SEED: Post[] = [
  {
    type: 'hand',
    author: '민혁',
    title: 'BTN 3벳 팟에서 AK 셋오버셋 의심',
    hero: 'AsKs',
    board: 'Ah7d2c Ts 9h',
    position: 'BTN vs BB',
    stakes: 'NL50',
    spot: 'cash',
    body: '플랍 c-bet 후 턴 리레이즈. GTO상 콜/폴드가 궁금합니다.',
    tags: ['3bet', 'cbet', 'turn'],
    votes: 12,
    comments: [{ author: '지원', body: '탑탑+넛플드로면 턴 콜 충분.' }],
  },
  {
    type: 'hand',
    author: '수진',
    title: '버블에서 AQ 콜 vs 숏스택 셔브 (ICM)',
    hero: 'AhQd',
    board: '',
    position: 'BB vs BTN',
    stakes: '$22 MTT',
    spot: 'mtt',
    body: '4명 남고 3명 ITM. 12bb 셔브에 AQo 콜이 맞을까요?',
    tags: ['icm', 'bubble'],
    votes: 8,
    comments: [],
  },
  {
    type: 'article',
    author: '토너프로',
    title: 'ICM 전략: 토너먼트에서 칩 ≠ 상금',
    category: 'ICM',
    body: 'ICM은 스택을 기대 상금으로 환산합니다. 칩EV상 +인 콜도 ICM상 폴드가 정답인 경우가 많습니다.',
    tags: ['icm', 'mtt'],
    votes: 11,
    comments: [],
  },
];

function metaLine(post: Post): string {
  if (post.type === 'hand') {
    return [post.position, post.stakes, post.spot?.toUpperCase()].filter(Boolean).join(' · ');
  }
  return CATEGORY_LABEL[post.category ?? 'general'] ?? '전략';
}

export default function CommunityScreen() {
  const [posts, setPosts] = useState<Post[]>(SEED);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/posts`);
        if (!res.ok) throw new Error('bad status');
        const data = (await res.json()) as Post[];
        if (alive) setPosts(data);
      } catch {
        // offline: keep the hardcoded SEED so the screen still renders.
        if (alive) setPosts(SEED);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.h1}>커뮤니티</Text>
      <Text style={styles.sub}>핸드 리뷰와 칩EV·ICM·버블 전략을 확인하세요.</Text>

      {posts.map((post, idx) => (
        <Card key={idx}>
          <Text style={{ color: theme.dim, fontSize: 12, marginBottom: 4 }}>
            {post.author} · {metaLine(post)}
          </Text>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 6 }}>
            {post.title}
          </Text>
          {post.hero ? (
            <Text style={{ color: theme.text, marginBottom: 2 }}>
              <Text style={{ color: theme.dim }}>핸드 </Text>
              {post.hero}
              {post.board ? `   보드 ${post.board}` : ''}
            </Text>
          ) : null}
          <Text style={{ color: theme.text, marginVertical: 6, lineHeight: 20 }}>{post.body}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {post.tags.map((t) => (
              <Text key={t} style={{ color: theme.blue, fontSize: 12 }}>
                #{t}
              </Text>
            ))}
          </View>
          <Text style={{ color: theme.dim, fontSize: 13, marginTop: 8 }}>
            ▲ {post.votes} · {post.comments.length} 코멘트
          </Text>
          {post.comments.map((c, i) => (
            <View
              key={i}
              style={{ marginTop: 8, paddingLeft: 10, borderLeftColor: theme.border, borderLeftWidth: 2 }}
            >
              <Text style={{ color: theme.text, fontSize: 13 }}>
                <Text style={{ fontWeight: '700' }}>{c.author}</Text> {c.body}
              </Text>
            </View>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}
