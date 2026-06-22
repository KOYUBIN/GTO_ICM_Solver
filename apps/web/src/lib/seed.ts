/**
 * Seed data shared by both store backends (file/memory and Postgres).
 * 2 hand-review posts + 3 strategy articles (chipEV / ICM / bubble).
 */

import type { Post } from './community';

export const SEED: Post[] = [
  {
    id: 'p1',
    type: 'hand',
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
    type: 'hand',
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
  {
    id: 'a1',
    type: 'article',
    category: 'chipEV',
    author: '코치K',
    title: '칩EV 기초: 왜 캐시게임은 칩EV가 곧 실력인가',
    body: '캐시게임에서는 스택을 언제든 리바이할 수 있으므로 한 칩의 가치가 선형입니다. 따라서 모든 결정은 순수 칩EV를 최대화하면 됩니다. +EV 스팟을 분산 걱정 없이 반복적으로 취하는 것이 장기 수익의 핵심. 콜링 레인지, 3벳 폴라라이즈, c-bet 빈도 모두 칩EV 기준으로 솔버 출력을 따르면 됩니다.',
    tags: ['chipev', 'cash', 'fundamentals'],
    votes: 15,
    createdAt: '2026-06-19T08:00:00Z',
    comments: [],
  },
  {
    id: 'a2',
    type: 'article',
    category: 'ICM',
    author: '토너프로',
    title: 'ICM 전략: 토너먼트에서 칩 ≠ 상금',
    body: 'ICM(Independent Chip Model)은 스택을 기대 상금으로 환산합니다. 칩의 한계 가치가 체감하므로, 칩EV상 +인 콜도 ICM상 폴드가 정답인 경우가 많습니다. 특히 페이점프 직전과 파이널 테이블에서 빅스택은 압박을 가하고 미들스택은 타이트하게 플레이해야 합니다. 리스크 프리미엄을 항상 고려하세요.',
    tags: ['icm', 'mtt', 'finaltable'],
    votes: 11,
    createdAt: '2026-06-20T12:00:00Z',
    comments: [],
  },
  {
    id: 'a3',
    type: 'article',
    category: 'bubble',
    author: '수진',
    title: '버블 플레이: 인더머니 직전 압박 활용법',
    body: '버블은 ICM 압박이 극대화되는 구간입니다. 숏스택은 생존을, 미들스택은 페이점프를 의식하므로 빅스택의 셔브/리셔브 폴드에쿼티가 폭발적으로 올라갑니다. 빅스택이라면 미들스택을 타겟으로 폭넓게 압박하고, 숏스택이라면 더블업 가능 스팟만 골라 셔브하세요. 콜링 레인지는 칩EV보다 훨씬 타이트하게.',
    tags: ['bubble', 'icm', 'mtt'],
    votes: 9,
    createdAt: '2026-06-21T09:00:00Z',
    comments: [],
  },
];
