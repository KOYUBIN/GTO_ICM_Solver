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
    href: '/pushfold',
    title: '푸시/폴드 솔버',
    desc: '숏스택 올인 차트 근사. 스택 깊이와 뒤 플레이어 수에 따른 셔브 판단.',
  },
  {
    href: '/icm',
    title: 'ICM 계산기',
    desc: '토너먼트 칩을 상금 기대값으로 환산하고 버블 리스크 프리미엄을 계산합니다.',
  },
  {
    href: '/community',
    title: '핸드 공유 & 리뷰',
    desc: '친구들과 핸드를 공유하고 코멘트와 GTO 리뷰를 남깁니다.',
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
