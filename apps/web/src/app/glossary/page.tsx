'use client';

import { useMemo, useState } from 'react';

interface Term {
  term: string;
  short: string; // 한 줄 쉬운 설명
  detail?: string; // 조금 더
}

interface Section {
  title: string;
  terms: Term[];
}

const SECTIONS: Section[] = [
  {
    title: '기본 용어',
    terms: [
      { term: '레인지 (Range)', short: '그 상황에서 가질 수 있는 손패들의 묶음.', detail: '예: "버튼 오픈 레인지" = 버튼에서 처음 레이즈로 들어갈 만한 패 전체.' },
      { term: '에쿼티 (Equity)', short: '쉽게 말해 승률.', detail: '내 패가 상대(들)를 상대로 끝까지 갔을 때 이길 확률(%)입니다.' },
      { term: '프리플랍 / 플랍 / 턴 / 리버', short: '카드가 깔리는 단계.', detail: '프리플랍(공용카드 0장) → 플랍(3장) → 턴(4장) → 리버(5장).' },
      { term: 'SB / BB (스몰·빅 블라인드)', short: '매 핸드 강제로 내는 기본 베팅.', detail: '스택 크기를 "빅블라인드 몇 개(BB)"로 표현합니다. 예: 20BB = 빅블라인드 20개.' },
      { term: '앤티 (Ante)', short: '매 핸드 추가로 걷는 참가비 성격의 칩.', detail: '요즘은 빅블라인드 한 명이 테이블 몫을 한 번에 내는 "BB 앤티"가 흔합니다.' },
      { term: '이펙티브 스택', short: '맞붙은 두 사람 중 더 적은 칩.', detail: '실제로 걸 수 있는 최대 칩이라 이 값이 기준이 됩니다.' },
      { term: '넛 (Nuts)', short: '그 보드에서 나올 수 있는 최강 패.', detail: '"넛 우위" = 내 레인지에 최강 패가 상대보다 많다는 뜻.' },
    ],
  },
  {
    title: '전략 · 액션',
    terms: [
      { term: 'RFI (레이즈 처음 들어가기)', short: '앞에서 아무도 안 들어왔을 때 내가 처음으로 레이즈.', detail: 'Raise First In. 프리플랍 오픈 레이즈를 말합니다.' },
      { term: '3벳 (쓰리벳)', short: '레이즈에 다시 레이즈(리레이즈).', detail: '누군가 오픈(1벳=BB, 2벳=레이즈)했을 때 다시 올리면 3벳입니다.' },
      { term: '셔브 (Shove)', short: '올인.', detail: '가진 칩을 전부 베팅하는 것.' },
      { term: '푸시 / 폴드', short: '푸시=올인, 폴드=죽기.', detail: '칩이 적을 땐 "올인 아니면 폴드"가 최적일 때가 많아 이를 푸시/폴드 전략이라 합니다.' },
      { term: '솔버 (Solver)', short: '최적 전략을 계산으로 찾아주는 프로그램.', detail: '이 앱의 포스트플랍 솔버는 몬테카를로(무작위 시뮬레이션) 방식으로 근사합니다.' },
      { term: '내시 (Nash) 균형', short: '상대가 최선을 다해도 내가 손해 안 보는 수학적 정답 전략.', detail: '푸시/폴드 "내시 차트"는 각 스택에서 올인이 정확히 이득/손해인 지점을 계산으로 구한 것.' },
      { term: '칩EV (cEV)', short: '칩 기준 기대 이득.', detail: '상금이 아니라 "칩을 얼마나 딸 수 있나"만 본 값. 토너먼트에선 ICM도 함께 봐야 합니다.' },
    ],
  },
  {
    title: '토너먼트 · ICM',
    terms: [
      { term: 'ICM', short: '내 칩이 실제 상금(돈)으로 얼마인지 환산한 값.', detail: '토너먼트는 1등이 상금을 다 갖는 게 아니라서, 칩 = 돈이 아닙니다. ICM이 이걸 계산해 줍니다.' },
      { term: '버블 (Bubble)', short: '상금권 바로 직전.', detail: '예: 5명 지급인데 6명 남았을 때. 여기서 터지면 아무것도 못 받아 매우 조심하는 구간.' },
      { term: '버블 팩터', short: '버블에서 올인이 얼마나 위험한지 나타내는 배수.', detail: '1이면 칩EV와 같음. 클수록(예: 1.5) "이겨서 얻는 것보다 져서 잃는 게 커서" 타이트하게 쳐야 함.' },
      { term: '리스크 프리미엄', short: 'ICM 때문에 평소보다 더 좋은 패라야 콜/올인할 수 있는 정도.', detail: '예: +8%면 원래 50% 승률이면 콜인데 이제 58%는 돼야 콜.' },
      { term: '딜 (Deal)', short: '파이널에서 남은 사람끼리 상금을 나눠 갖기로 합의.', detail: '두 가지 방식: ICM(공정 분배) / 칩찹(칩 비율 분배).' },
      { term: '칩찹 (Chip chop)', short: '각자 최소 상금을 확보하고, 남는 상금을 칩 비율로 나누기.', detail: '단순하고 빅스택에게 유리. 숏스택은 보통 ICM 분배가 유리합니다.' },
      { term: 'M-비율 / M-존', short: '내 스택으로 블라인드·앤티를 몇 바퀴 버틸 수 있나.', detail: '클수록 여유. 그린(20+)·옐로(10~20)·오렌지(6~10)·레드(1~6)·데드(1미만) 존으로 나눕니다.' },
      { term: '리바이 (Rebuy)', short: '칩을 다 잃었을 때 다시 사서 참가.', detail: '몬스터 게임은 스타트 250만, 리바이 300만 칩.' },
      { term: '레지 마감 (Late reg)', short: '늦게 등록·리바이할 수 있는 마지막 시점.', detail: '몬스터 게임은 10레벨에 마감. 이후로는 리바이 불가.' },
    ],
  },
];

export default function GlossaryPage() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      terms: s.terms.filter(
        (t) =>
          t.term.toLowerCase().includes(query) ||
          t.short.toLowerCase().includes(query) ||
          (t.detail?.toLowerCase().includes(query) ?? false),
      ),
    })).filter((s) => s.terms.length > 0);
  }, [query]);

  return (
    <div className="container">
      <h1>용어 사전</h1>
      <p className="subtitle">
        포커·토너먼트 용어를 쉬운 말로 정리했습니다. 앱을 쓰다 모르는 말이 나오면 여기서 찾아보세요.
      </p>

      <div className="card">
        <label>검색</label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예: ICM, 셔브, 버블…"
        />
      </div>

      {filtered.map((s) => (
        <div key={s.title} className="card">
          <h2>{s.title}</h2>
          <dl style={{ margin: 0 }}>
            {s.terms.map((t) => (
              <div key={t.term} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <dt style={{ fontWeight: 700, marginBottom: 4 }}>{t.term}</dt>
                <dd style={{ margin: 0 }}>
                  {t.short}
                  {t.detail && (
                    <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                      {t.detail}
                    </div>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            &ldquo;{q}&rdquo; 에 맞는 용어가 없습니다.
          </p>
        </div>
      )}
    </div>
  );
}
