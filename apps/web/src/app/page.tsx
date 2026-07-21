import Link from 'next/link';
import { InstallButton } from '@/components/InstallButton';

interface Feature {
  href: string;
  title: string;
  desc: string;
}

/** Two headline entry points, shown large at the top. */
const FEATURED: Feature[] = [
  {
    href: '/monster',
    title: '🎰 몬스터 게임 (파이널 나인)',
    desc: '파이널 나인 홀덤펍 몬스터 게임 전용 허브 — 라이브 클럭·블라인드 구조·M존 진단·상금·ICM 딜·셔브 차트를 한 곳에서.',
  },
  {
    href: '/play',
    title: '🃏 멀티플레이 홀덤',
    desc: '공개 로비 또는 방 코드로 친구들과 실시간 노리밋 홀덤. 채팅·핸드 히스토리·에쿼티 분석까지.',
  },
];

const GROUPS: { title: string; items: Feature[] }[] = [
  {
    title: '솔버 · 전략',
    items: [
      {
        href: '/strategy',
        title: '📚 전략 라이브러리',
        desc: '주제별 포커 전략 가이드(포지션·3벳·ICM·멘탈) + 영상·외부 학습 자료를 한곳에 정리했습니다.',
      },
      {
        href: '/solver',
        title: '포스트플랍 솔버 (MCCFR)',
        desc: '몬테카를로 CFR로 플랍·턴·리버를 풀어 체크/베팅 전략과 EV를 계산합니다.',
      },
      {
        href: '/matchup',
        title: '레인지 매치업 · 에쿼티',
        desc: 'GTO Wizard식 레인지 어드밴티지(에쿼티 분포·넛 우위)에 에쿼티 계산기 탭을 통합.',
      },
      {
        href: '/charts',
        title: '프리플랍 차트 · 레인지 뷰어',
        desc: '상황을 골라 RFI·3벳 레인지와 믹스를 보고, 레인지 뷰어 탭으로 직접 입력한 범위도 시각화합니다.',
      },
      {
        href: '/pushfold',
        title: '푸시/폴드 솔버',
        desc: '숏스택 올인 차트 근사. 몬스터 실전 모드로 칩·레벨 → 유효 BB·M 진단.',
      },
      {
        href: '/icm',
        title: 'ICM 계산기 · 딜 · 셔브',
        desc: '칩을 상금 기대값으로 환산, 파이널 테이블 딜(칩찹/ICM)·버블 팩터·ICM 셔브 판단.',
      },
    ],
  },
  {
    title: '분석 · 기록',
    items: [
      {
        href: '/trainer',
        title: '🎓 학습하기 (GTO 트레이너)',
        desc: 'GTO Wizard 트레이너식 랜덤 스팟 드릴 — 미션·타임어택·약점 분석과 오답 노트로 복습까지.',
      },
      {
        href: '/history',
        title: '🕘 핸드 히스토리',
        desc: '내가 친 핸드가 자동 저장 — 카드·보드·수익까지 다시 보기.',
      },
      {
        href: '/replay',
        title: '핸드 리플레이 · 히스토리 분석',
        desc: '올인 핸드를 스트리트별 에쿼티로 리플레이하고, 히스토리·스크린샷(OCR) 분석까지.',
      },
      {
        href: '/notes',
        title: '핸드 기록장 · 개인 노트',
        desc: '오프라인 라이브 세션 핸드를 기록하고 개인 노트를 남깁니다. 저장은 내 기기에.',
      },
      {
        href: '/community',
        title: '커뮤니티 · 전략 컨텐츠',
        desc: '핸드를 공유하고 칩EV·ICM·버블 전략 글을 작성·리뷰합니다.',
      },
      {
        href: '/glossary',
        title: '📖 용어 사전',
        desc: 'ICM·에쿼티·셔브·버블 등 어려운 포커 용어를 쉬운 말로 풀어 정리했습니다.',
      },
    ],
  },
];

export default function Home() {
  return (
    <div className="container">
      <h1>No-Limit Hold’em GTO / ICM 솔버</h1>
      <p className="subtitle">
        GTO Wizard를 레퍼런스로 한 솔버 + 커뮤니티. 모든 계산은 웹·모바일 공용 엔진(@gto/engine)으로
        동작합니다.
      </p>
      <div style={{ marginBottom: 18 }}>
        <InstallButton />
      </div>

      <div className="grid-cards" style={{ marginBottom: 26 }}>
        {FEATURED.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="feature"
            style={{ borderColor: 'var(--accent-dim)' }}
          >
            <h3 style={{ fontSize: 18 }}>{f.title}</h3>
            <p>{f.desc}</p>
          </Link>
        ))}
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-dim)', margin: '0 0 12px', letterSpacing: 0.3 }}>
            {g.title}
          </h2>
          <div className="grid-cards">
            {g.items.map((f) => (
              <Link key={f.href} href={f.href} className="feature">
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
