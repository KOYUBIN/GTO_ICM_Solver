import Link from 'next/link';
import { InstallButton } from '@/components/InstallButton';

const FEATURES = [
  {
    href: '/trainer',
    title: '🎓 학습하기 (GTO 트레이너)',
    desc: 'GTO Wizard 트레이너식 랜덤 스팟 드릴 — RFI·vs RFI·vs 3벳 문제를 풀고 정답률·연속 정답·오답 노트로 복습합니다.',
  },
  {
    href: '/notes',
    title: '핸드 기록장 · 개인 노트',
    desc: '오프라인 라이브 세션 핸드를 기록하고(포지션·카드·결과·메모) 개인 노트를 남깁니다. 저장은 내 기기에.',
  },
  {
    href: '/play',
    title: '🃏 멀티플레이 홀덤',
    desc: '공개 로비 또는 방 코드로 친구들과 실시간 노리밋 홀덤. 채팅·핸드 히스토리·에쿼티 분석까지.',
  },
  {
    href: '/monster',
    title: '🎰 몬스터 게임 (파이널 나인)',
    desc: '파이널 나인 홀덤펍 몬스터 게임 전용 허브 — 블라인드 구조·라이브 레벨·상금 계산, ICM 딜과 셔브 차트로 바로 연결.',
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
    desc: '몬테카를로 CFR로 플랍·턴·리버를 풀어 체크/베팅 전략과 EV를 계산합니다. (멀티 스트리트 챈스 샘플링)',
  },
  {
    href: '/matchup',
    title: '레인지 매치업 · 에쿼티 계산기',
    desc: 'GTO Wizard식 레인지 어드밴티지(에쿼티 분포 곡선·넛 우위·ICM 버블 팩터)에 에쿼티 계산기 탭을 통합 — 핸드 vs 핸드/레인지 승률도 몬테카를로로 계산합니다.',
  },
  {
    href: '/icm',
    title: 'ICM 계산기',
    desc: '토너먼트 칩을 상금 기대값으로 환산하고 버블 리스크 프리미엄을 계산합니다.',
  },
  {
    href: '/replay',
    title: '핸드 리플레이 · 히스토리 분석',
    desc: '올인 핸드를 스트리트별 에쿼티(예: 88 vs KK 19.5%)로 리플레이하고, 히스토리 텍스트·스크린샷(OCR) 분석 탭까지 한 페이지에서 제공합니다.',
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
      <div style={{ marginBottom: 18 }}>
        <InstallButton />
      </div>
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
