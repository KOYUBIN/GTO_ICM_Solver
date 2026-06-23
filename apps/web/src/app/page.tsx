import Link from 'next/link';

const FEATURES = [
  {
    href: '/equity',
    title: '에쿼티 계산기',
    desc: '핸드 vs 핸드 / 핸드 vs 레인지 승률을 몬테카를로로 계산합니다.',
  },
  {
    href: '/ranges',
    title: '레인지 뷰어',
    desc: '13x13 그리드로 레인지를 시각화하고 콤보 수와 비중을 확인합니다.',
  },
  {
    href: '/charts',
    title: '프리플랍 차트 · 상황 선택기',
    desc: 'GTO Wizard 스타일로 스팟을 골라 RFI·3벳 레인지와 믹스를 봅니다.',
  },
  {
    href: '/pushfold',
    title: '푸시/폴드 솔버',
    desc: '숏스택 올인 차트 근사. 스택 깊이와 뒤 플레이어 수에 따른 셔브 판단.',
  },
  {
    href: '/solver',
    title: '포스트플랍 솔버 (MCCFR)',
    desc: '몬테카를로 CFR로 리버 스팟을 풀어 체크/베팅 전략과 EV를 계산합니다.',
  },
  {
    href: '/icm',
    title: 'ICM 계산기',
    desc: '토너먼트 칩을 상금 기대값으로 환산하고 버블 리스크 프리미엄을 계산합니다.',
  },
  {
    href: '/analyze',
    title: '핸드 히스토리 분석',
    desc: '온라인 핸드 히스토리를 붙여넣거나 스크린샷을 올려 파싱·에쿼티 분석합니다.',
  },
  {
    href: '/play',
    title: '멀티플레이 홀덤',
    desc: '방을 만들어 코드를 공유하고 친구들과 실시간 노리밋 홀덤을 칩·블라인드 프리셋으로 플레이합니다.',
  },
  {
    href: '/community',
    title: '커뮤니티 · 전략 컨텐츠',
    desc: '핸드를 공유하고 칩EV·ICM·버블 전략 글을 작성·리뷰합니다.',
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
      <div className="grid-cards">
        {FEATURES.map((f) => (
          <Link key={f.href} href={f.href} className="feature">
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
