import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Card, styles } from '../components/ui';
import { theme } from '../theme';

interface Post {
  author: string;
  title: string;
  hero: string;
  board: string;
  meta: string;
  body: string;
  tags: string[];
  votes: number;
  comments: { author: string; body: string }[];
}

const SEED: Post[] = [
  {
    author: '민혁',
    title: 'BTN 3벳 팟에서 AK 셋오버셋 의심',
    hero: 'AsKs',
    board: 'Ah7d2c Ts 9h',
    meta: 'BTN vs BB · NL50 · CASH',
    body: '플랍 c-bet 후 턴 리레이즈. GTO상 콜/폴드가 궁금합니다.',
    tags: ['3bet', 'cbet', 'turn'],
    votes: 12,
    comments: [{ author: '지원', body: '탑탑+넛플드로면 턴 콜 충분.' }],
  },
  {
    author: '수진',
    title: '버블에서 AQ 콜 vs 숏스택 셔브 (ICM)',
    hero: 'AhQd',
    board: '',
    meta: 'BB vs BTN · $22 MTT',
    body: '4명 남고 3명 ITM. 12bb 셔브에 AQo 콜이 맞을까요?',
    tags: ['icm', 'bubble'],
    votes: 8,
    comments: [],
  },
];

export default function CommunityScreen() {
  const [posts] = useState<Post[]>(SEED);

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.h1}>핸드 공유 & 리뷰</Text>
      <Text style={styles.sub}>친구들과 핸드를 공유하고 리뷰를 남기세요.</Text>

      {posts.map((post, idx) => (
        <Card key={idx}>
          <Text style={{ color: theme.dim, fontSize: 12, marginBottom: 4 }}>
            {post.author} · {post.meta}
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
