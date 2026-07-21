'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

/**
 * 전략 라이브러리 — 주제별로 정리한 포커 전략 가이드 + 영상/외부 자료 모음.
 * 각 글은 실용 요약과 이 앱에서 바로 연습할 수 있는 도구 링크를 함께 담는다.
 */

interface Article {
  title: string;
  tags: string[];
  /** 핵심 요약 (문단). */
  body: string[];
  /** 실전 포인트 (불릿). */
  points?: string[];
  /** 이 주제를 연습할 수 있는 앱 내 도구. */
  tools?: { href: string; label: string }[];
}

interface Section {
  id: string;
  title: string;
  emoji: string;
  articles: Article[];
}

const SECTIONS: Section[] = [
  {
    id: 'basics',
    title: '기초',
    emoji: '🧱',
    articles: [
      {
        title: '포지션이 절반이다',
        tags: ['포지션', '기초'],
        body: [
          '홀덤에서 같은 패라도 어디에 앉아 있느냐에 따라 가치가 완전히 달라집니다. 늦게 행동할수록(버튼에 가까울수록) 상대의 액션을 보고 결정할 수 있어 정보 우위를 갖습니다.',
        ],
        points: [
          '버튼(BTN)에서는 가장 넓은 범위(약 40~50%)로 오픈해도 됩니다 — 이후 모든 스트리트에서 마지막에 행동하기 때문입니다.',
          'UTG(첫 자리)에서는 상위 ~15% 정도로 좁게: 뒤에 5명이 남아 있어 강한 패와 부딪힐 확률이 높습니다.',
          '포지션이 나쁘면 같은 패도 한 단계 약하게 취급하세요. "얼리에서 콜이 애매하면 폴드"가 기본입니다.',
        ],
        tools: [
          { href: '/charts', label: '포지션별 오픈 차트 보기' },
          { href: '/trainer', label: '포지션 드릴 연습' },
        ],
      },
      {
        title: '팟 오즈 30초 계산법',
        tags: ['팟오즈', '수학', '기초'],
        body: [
          '콜할지 말지는 "가격"의 문제입니다. 팟 오즈 = 콜 금액 ÷ (팟 + 콜 금액). 이 비율보다 내 승률이 높으면 콜이 이득입니다.',
        ],
        points: [
          '예: 팟 10만, 상대 벳 5만 → 콜 5만 ÷ (15만+5만) = 25%. 승률 25% 이상이면 콜.',
          '드로우 승률 빠른 계산(러프): 아웃 수 × 2 = 다음 카드 한 장에서 맞을 확률(%), × 4 = 두 장(턴+리버) 확률.',
          '플러시 드로우 = 아웃 9장 → 턴+리버 약 36%. 상대가 팟의 절반을 벳하면(25% 필요) 콜이 됩니다.',
        ],
        tools: [{ href: '/matchup', label: '에쿼티(승률) 계산기로 확인' }],
      },
      {
        title: '스타팅 핸드, 외우지 말고 이해하기',
        tags: ['프리플랍', '기초', '레인지'],
        body: [
          '차트를 통째로 외우기보다 패의 "성질"을 이해하면 응용이 됩니다. 큰 페어(QQ+)는 지금 이기고 있는 패, 수딧 커넥터(78s 등)는 맞으면 크게 이기는 패, 오프수트 브로드웨이(KJo 등)는 도미네이트 당하기 쉬운 함정 패입니다.',
        ],
        points: [
          '작은 페어(22~66)는 셋(트리플)을 노리는 패 — 콜 비용이 상대 스택의 ~10% 이하일 때만 셋 마이닝하세요.',
          'Aximo(A2o~A9o)는 얼리·미들에선 폴드가 기본. 에이스가 맞아도 킥커에서 집니다.',
          '수딧이 오프수트보다 승률로는 3~4%p밖에 안 높지만, 플레이하기 쉬운 정도(넛 가능성)는 훨씬 큽니다.',
        ],
        tools: [
          { href: '/charts?tab=ranges', label: '레인지 뷰어로 직접 그려보기' },
          { href: '/trainer', label: '스타팅 핸드 퀴즈' },
        ],
      },
    ],
  },
  {
    id: 'preflop',
    title: '프리플랍',
    emoji: '🂠',
    articles: [
      {
        title: '오픈 레이즈: 사이즈는 고정, 범위만 조절',
        tags: ['프리플랍', '오픈', '사이즈'],
        body: [
          '패에 따라 사이즈를 바꾸면(강하면 크게, 약하면 작게) 상대에게 정보를 공짜로 줍니다. 사이즈는 포지션당 하나로 고정하고, 어떤 패를 오픈할지(범위)만 조절하는 것이 현대 표준입니다.',
        ],
        points: [
          '일반적 기준: 온라인 2.2~2.5bb, 라이브·홀덤펍은 3bb 안팎(콜러가 많아 조금 크게).',
          '림프(콜로 입장)는 기본적으로 하지 않습니다 — 팟은 키우지 못하고 정보만 줍니다. 예외는 SB 완료 정도.',
          '앞에 림퍼가 있으면 오픈 사이즈에 림퍼당 +1bb.',
        ],
        tools: [{ href: '/charts', label: '포지션·스택별 오픈 범위' }],
      },
      {
        title: '3벳: 밸류와 블러프의 양극화',
        tags: ['프리플랍', '3벳'],
        body: [
          '3벳(리레이즈)은 최강 패(QQ+, AK)로 가치를 뽑는 동시에, 그냥 폴드하기 아까운 경계 패(A5s 같은 수딧 에이스)를 블러프로 섞는 양극화 구조가 표준입니다. 중간 강도 패(AJ, KQ, 99)는 콜이 더 편합니다.',
        ],
        points: [
          '사이즈: 인포지션 3벳은 오픈의 3배, 아웃오브포지션(블라인드에서)은 4배 안팎.',
          'A5s~A2s가 블러프 3벳 단골인 이유: 에이스를 한 장 막아 상대 AA/AK 확률을 줄이고, 맞으면 넛 플러시·휠 스트레이트가 됩니다.',
          '상대가 3벳에 폴드를 잘 안 하는 타입이면 블러프를 빼고 밸류만 3벳하세요 — 조정이 GTO보다 돈이 됩니다.',
        ],
        tools: [
          { href: '/charts', label: 'vs RFI · 3벳 차트' },
          { href: '/trainer', label: '3벳 스팟 드릴' },
        ],
      },
      {
        title: '빅블라인드 디펜스: 이미 낸 돈이 할인권',
        tags: ['프리플랍', '블라인드', 'BB'],
        body: [
          'BB는 이미 1bb를 냈기 때문에 콜 가격이 싸고, 마지막에 행동합니다. 그래서 버튼 오픈(2.5bb)에는 놀랄 만큼 넓게(40% 이상) 디펜드하는 것이 맞습니다. 다만 콜한 뒤 플랍을 아웃오브포지션으로 쳐야 하니 "싸게 보고, 맞으면 크게"가 기본 마인드입니다.',
        ],
        points: [
          '버튼 오픈 vs BB: K2s, Q5s, 75s 같은 패도 수학적으로 콜이 됩니다.',
          '얼리 오픈에는 훨씬 타이트하게 — 오프너 범위가 강하기 때문입니다.',
          '리레이즈(3벳)로 싸울 패와 콜로 볼 패를 미리 구분해 두세요.',
        ],
        tools: [{ href: '/charts', label: 'BB 디펜스 범위 확인' }],
      },
    ],
  },
  {
    id: 'postflop',
    title: '포스트플랍',
    emoji: '🃏',
    articles: [
      {
        title: 'C벳 기초: 보드가 누구 편인가',
        tags: ['포스트플랍', 'C벳', '보드텍스처'],
        body: [
          '프리플랍 레이저가 플랍에서 이어 베팅하는 것이 컨티뉴에이션 벳(C벳)입니다. 핵심 질문은 "이 보드가 내 범위와 상대 범위 중 누구에게 유리한가"입니다.',
        ],
        points: [
          'A72 레인보우처럼 높은 카드 위주의 마른 보드는 오프너 편 — 작게(팟의 25~33%) 자주 C벳하세요.',
          '876 투톤처럼 낮고 연결된 보드는 콜러(BB) 편 — C벳 빈도를 확 줄이고 체크를 섞으세요.',
          '멀티웨이(3명 이상)에서는 C벳 블러프를 대폭 줄이고 밸류 위주로.',
        ],
        tools: [{ href: '/solver', label: '포스트플랍 솔버로 보드별 전략 확인' }],
      },
      {
        title: '밸류벳이 돈을 번다',
        tags: ['포스트플랍', '밸류벳'],
        body: [
          '아마추어와 고수의 수익 차이는 화려한 블러프가 아니라 밸류벳에서 납니다. "상대가 더 약한 패로 콜해줄 수 있는가?"에 예라고 답할 수 있으면 베팅하세요.',
        ],
        points: [
          '리버에서 톱페어 좋은 킥커면 대부분 얇은 밸류벳이 가능합니다 — 체크로 공짜 쇼다운을 주는 것이 가장 흔한 누수.',
          '사이즈는 상대가 콜할 수 있는 최대치로: 드로우가 많은 보드에선 크게(팟의 66~100%), 마른 보드 얇은 밸류는 작게(33~50%).',
          '"내가 베팅하면 나보다 강한 패만 콜한다" 싶으면 그게 바로 체크할 자리입니다.',
        ],
        tools: [{ href: '/replay', label: '내 핸드 리플레이로 밸류 놓친 곳 찾기' }],
      },
      {
        title: '블러프는 스토리가 있어야 한다',
        tags: ['포스트플랍', '블러프'],
        body: [
          '좋은 블러프는 "내가 이 라인으로 왔으면 가질 법한 강한 패"가 존재하는 블러프입니다. 그리고 가능하면 블로커(상대의 넛 조합을 막는 카드)를 들고 있을 때 하세요.',
        ],
        points: [
          '세미블러프(드로우로 베팅)가 순수 블러프보다 훨씬 낫습니다 — 폴드시켜도 이기고, 콜당해도 역전 아웃이 있습니다.',
          '리버 블러프는 미주 드로우(맞지 않은 플러시·스트레이트 드로우)로 하는 것이 자연스럽습니다 — 쇼다운 가치가 없기 때문입니다.',
          '콜링 스테이션(폴드 안 하는 상대)에게는 블러프 자체를 끄세요.',
        ],
        tools: [{ href: '/solver', label: '솔버로 블러프 빈도 확인' }],
      },
    ],
  },
  {
    id: 'tournament',
    title: '토너먼트 · ICM',
    emoji: '🏆',
    articles: [
      {
        title: '스택 깊이가 전략을 정한다 (M존)',
        tags: ['토너먼트', '스택', 'M존'],
        body: [
          '토너먼트에서는 블라인드가 계속 오르므로 "내 스택으로 몇 바퀴를 버틸 수 있나(M)"가 모든 결정의 출발점입니다.',
        ],
        points: [
          'M 20+ (그린): 풀 포커 — 셋 마이닝, 수딧 커넥터 콜 전부 가능.',
          'M 10~20 (옐로): 투기적 콜 축소, 오픈 사이즈 축소(2~2.2bb).',
          'M 6~10 (오렌지): 첫 액션으로 올인 또는 폴드가 주무기. 콜드콜 거의 금지.',
          'M 6 미만 (레드): 순수 푸시/폴드. 차트대로 밀어붙이는 사람이 이깁니다.',
        ],
        tools: [
          { href: '/monster', label: '몬스터 게임 M존 진단' },
          { href: '/pushfold', label: '푸시/폴드 차트' },
        ],
      },
      {
        title: 'ICM: 칩과 돈은 다르다',
        tags: ['토너먼트', 'ICM', '버블'],
        body: [
          '토너먼트 칩의 가치는 선형이 아닙니다. 칩을 2배로 따도 상금 기대값은 2배가 안 되고, 탈락하면 0이 됩니다. 그래서 상금권 경계(버블)와 파이널에서는 칩EV로는 콜인 스팟도 폴드가 정답이 됩니다.',
        ],
        points: [
          '버블에서 빅스택은 압박(자주 올인), 숏스택 커버당하는 미들스택이 가장 타이트해야 합니다.',
          '리스크 프리미엄: 버블에선 평소 50% 승률이면 되는 콜이 55~60%를 요구하게 됩니다.',
          '반대로 내가 초숏스택이면 ICM 부담이 작아 — 남들이 못 싸우는 동안 — 오히려 공격적으로 올인할 수 있습니다.',
        ],
        tools: [
          { href: '/icm', label: 'ICM 계산기 · 셔브 판단' },
          { href: '/trainer', label: 'ICM 푸시/폴드 문제' },
        ],
      },
      {
        title: '파이널 테이블과 딜',
        tags: ['토너먼트', '파이널', '딜'],
        body: [
          '파이널에서는 한 명이 탈락할 때마다 모두의 상금이 오릅니다(래더링). 숏스택이 여러 명이면 어중간한 올인 콜을 참는 것만으로 상금이 오릅니다. 남은 인원끼리 상금을 나누는 딜(칩찹/ICM)도 흔한 선택지입니다.',
        ],
        points: [
          '딜에서 숏스택은 ICM 분배가, 빅스택은 칩 비율(칩찹) 분배가 유리합니다 — 반대편 제안이 오면 그 사이에서 협상하세요.',
          '헤즈업 직전(3→2명)이 상금 점프가 가장 큰 구간 — 여기서의 콜 기준이 가장 타이트합니다.',
          '헤즈업은 범위 싸움: 버튼에서 70~80% 오픈이 정상입니다.',
        ],
        tools: [{ href: '/icm', label: '딜 계산기 (칩찹 vs ICM)' }],
      },
    ],
  },
  {
    id: 'mental',
    title: '멘탈 · 뱅크롤',
    emoji: '🧠',
    articles: [
      {
        title: '틸트: 실력의 최종 보스',
        tags: ['멘탈', '틸트'],
        body: [
          '배드빗 후 30분이 세션 수익을 결정합니다. 틸트 상태의 A급 플레이어는 평정심의 C급 플레이어보다 돈을 잃습니다.',
        ],
        points: [
          '결과가 아니라 결정을 평가하세요 — 80% 승률로 올인해서 진 것은 좋은 플레이입니다. 리플레이로 결정만 복기하세요.',
          '연속 배드빗 후에는 정해둔 규칙대로 휴식(산책 10분, 물 한 잔). 감정은 논리로 안 꺼집니다, 시간이 끕니다.',
          '"저 사람에게 되갚아주겠다"는 생각이 들면 이미 틸트입니다 — 상대가 아니라 스팟을 상대하세요.',
        ],
        tools: [{ href: '/notes', label: '핸드 기록장에 감정 상태도 메모' }],
      },
      {
        title: '뱅크롤: 살아남아야 실력이 나온다',
        tags: ['뱅크롤', '관리'],
        body: [
          '아무리 잘 쳐도 분산(운의 출렁임)은 피할 수 없습니다. 뱅크롤 관리는 실력이 발휘될 때까지 버티게 해주는 안전벨트입니다.',
        ],
        points: [
          '토너먼트는 최소 바이인 50~100개 분량의 전용 자금을 권장합니다 (분산이 매우 큼).',
          '한 게임에 전체 자금의 2~5% 이상 넣지 않기.',
          '이번 달 성적이 아니라 1,000게임 단위로 평가하세요 — 그 전까지는 표본 부족입니다.',
        ],
        tools: [{ href: '/history', label: '핸드 히스토리로 수익 추적' }],
      },
    ],
  },
];

/** 외부 학습 자료 — 실제 존재가 확실한 사이트/채널 + 유튜브 검색 링크. */
const RESOURCES: { group: string; items: { label: string; href: string; desc: string }[] }[] = [
  {
    group: '영상 (해외 — 자막 활용)',
    items: [
      {
        label: 'GTO Wizard (YouTube)',
        href: 'https://www.youtube.com/@GTOWizard',
        desc: '솔버 기반 전략 해설의 표준. 프리플랍·ICM·MTT 이론 영상 다수.',
      },
      {
        label: 'Jonathan Little (YouTube)',
        href: 'https://www.youtube.com/@JonathanLittlePoker',
        desc: '핸드 리뷰 위주 — 아마추어 실수 교정에 최고. WPT 챔피언.',
      },
      {
        label: 'Doug Polk Poker (YouTube)',
        href: 'https://www.youtube.com/@DougPolkPoker',
        desc: '하이스테이크 헤즈업 전 세계 1위 출신. 핸드 분석·포커 콘텐츠.',
      },
    ],
  },
  {
    group: '영상 (한국어 — 검색 모음)',
    items: [
      {
        label: 'YouTube: 홀덤 강의',
        href: 'https://www.youtube.com/results?search_query=%ED%99%80%EB%8D%A4+%EA%B0%95%EC%9D%98',
        desc: '한국어 홀덤 강의 최신 영상 모음 검색.',
      },
      {
        label: 'YouTube: 홀덤 토너먼트 전략',
        href: 'https://www.youtube.com/results?search_query=%ED%99%80%EB%8D%A4+%ED%86%A0%EB%84%88%EB%A8%BC%ED%8A%B8+%EC%A0%84%EB%9E%B5',
        desc: '토너먼트·ICM 관련 한국어 영상 검색.',
      },
      {
        label: 'YouTube: WSOP 하이라이트',
        href: 'https://www.youtube.com/results?search_query=WSOP+%ED%95%98%EC%9D%B4%EB%9D%BC%EC%9D%B4%ED%8A%B8',
        desc: '세계 최고 무대의 실전 핸드 — 보는 것만으로 공부가 됩니다.',
      },
    ],
  },
  {
    group: '읽을거리',
    items: [
      {
        label: 'GTO Wizard 블로그',
        href: 'https://blog.gtowizard.com/',
        desc: '솔버 개념(레인지, 블로커, ICM)을 깊게 파는 영문 아티클.',
      },
      {
        label: 'Upswing Poker 전략 글',
        href: 'https://upswingpoker.com/blog/',
        desc: '주제별 전략 아티클이 방대한 영문 학습 사이트.',
      },
      {
        label: 'Two Plus Two 포럼',
        href: 'https://forumserver.twoplustwo.com/',
        desc: '세계 최대 포커 커뮤니티 — 핸드 토론 문화의 원조.',
      },
    ],
  },
];

export default function StrategyPage() {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const query = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      articles: s.articles.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.tags.some((t) => t.toLowerCase().includes(query)) ||
          a.body.some((b) => b.toLowerCase().includes(query)) ||
          (a.points ?? []).some((p) => p.toLowerCase().includes(query)),
      ),
    })).filter((s) => s.articles.length > 0);
  }, [query]);

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <h1>📚 전략 라이브러리</h1>
      <p className="subtitle">
        주제별로 정리한 포커 전략 가이드입니다. 각 글 끝의 연습 도구로 바로 훈련할 수 있어요. 용어가
        어려우면 <Link href="/glossary">용어 사전</Link>을 함께 보세요.
      </p>

      <div className="card">
        <label>검색</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 3벳, ICM, 블러프, 틸트…" />
      </div>

      {/* 빠른 이동 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' }}>
            {s.emoji} {s.title}
          </a>
        ))}
        <a href="#resources" className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' }}>
          🎬 영상·자료
        </a>
      </div>

      {filtered.map((s) => (
        <section key={s.id} id={s.id} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>
            {s.emoji} {s.title}
          </h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {s.articles.map((a) => {
              const id = `${s.id}:${a.title}`;
              const open = openId === id || !!query;
              return (
                <div key={a.title} className="card" style={{ margin: 0 }}>
                  <button
                    onClick={() => setOpenId(open && !query ? null : id)}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      gap: 8,
                    }}
                  >
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{a.title}</span>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      {a.tags.slice(0, 2).map((t) => (
                        <span key={t} className="pill" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: 11 }}>
                          {t}
                        </span>
                      ))}
                      <span className="muted">{open ? '▲' : '▼'}</span>
                    </span>
                  </button>
                  {open && (
                    <div style={{ marginTop: 10 }}>
                      {a.body.map((p, i) => (
                        <p key={i} style={{ margin: '0 0 8px', lineHeight: 1.65, fontSize: 14 }}>
                          {p}
                        </p>
                      ))}
                      {a.points && (
                        <ul style={{ margin: '0 0 8px', paddingLeft: 18, display: 'grid', gap: 6 }}>
                          {a.points.map((p, i) => (
                            <li key={i} style={{ fontSize: 14, lineHeight: 1.55 }}>
                              {p}
                            </li>
                          ))}
                        </ul>
                      )}
                      {a.tools && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                          {a.tools.map((t) => (
                            <Link key={t.href} href={t.href} className="pill" style={{ background: 'rgba(63,185,80,0.12)', border: '1px solid var(--accent)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 700 }}>
                              ▶ {t.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>&ldquo;{q}&rdquo; 검색 결과가 없습니다.</p>
        </div>
      )}

      {/* 외부 자료 */}
      <section id="resources" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>🎬 영상 · 외부 자료</h2>
        {RESOURCES.map((g) => (
          <div key={g.group} className="card" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text-dim)' }}>{g.group}</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {g.items.map((r) => (
                <a
                  key={r.label}
                  href={r.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-elevated)',
                    textDecoration: 'none',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{r.label} ↗</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.desc}</div>
                </a>
              ))}
            </div>
          </div>
        ))}
        <p className="muted" style={{ fontSize: 12 }}>
          * 외부 링크는 참고용이며 각 사이트의 콘텐츠는 해당 저작자에게 있습니다. 한국어 영상은 검색
          링크로 제공합니다 (채널 개편이 잦아 직접 링크 대신 검색이 안전합니다).
        </p>
      </section>
    </div>
  );
}
