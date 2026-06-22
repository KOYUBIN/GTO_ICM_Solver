#!/usr/bin/env node
/**
 * Monte-Carlo Lab — 학습용 (educational).
 *
 * 포커 솔버가 내부적으로 쓰는 핵심 알고리즘들을 콘솔에서 직접 관찰하는 도구입니다.
 *
 *   1) 핸드 평가기 동작 확인
 *   2) 몬테카를로 에쿼티의 수렴 (vs 정확 열거) — 큰 수의 법칙 & 표준오차 1/√N
 *   3) ICM (Malmuth-Harville) 기대값
 *   4) MCCFR 리버 솔버의 전략 수렴 (반복 수를 늘리며 균형에 접근)
 *
 * 사용법:
 *   npm run build:engine     # 먼저 엔진을 빌드 (dist 생성)
 *   npm run lab              # 또는: node tools/mc-lab.mjs
 *
 * 알고리즘 배경 (포커 솔버 = CFR 계열):
 *   - Counterfactual Regret Minimization (Zinkevich et al. 2007)
 *   - Monte-Carlo CFR / External Sampling (Lanctot et al. 2009)
 *   - CFR+ (Tammelin 2014) — Cepheus가 헤즈업 리밋 홀덤을 풀 때 사용
 *   에쿼티/롤아웃은 몬테카를로 시뮬레이션, 토너먼트 자산가치는 ICM으로 계산합니다.
 */

import {
  calcEquity,
  exactEquity,
  parseRange,
  rangeToCombos,
  parseCards,
  evaluate7,
  CATEGORY_NAMES,
  categoryOf,
  cardsToString,
  icm,
  solveRiver,
} from '../packages/engine/dist/index.js';

const line = (c = '─') => console.log(c.repeat(64));
const pct = (x) => (x * 100).toFixed(2).padStart(6) + '%';

function section(title) {
  console.log('');
  line('═');
  console.log('  ' + title);
  line('═');
}

/* 1) 핸드 평가기 ------------------------------------------------------------ */
function demoEvaluator() {
  section('1. 핸드 평가기 — 7장 중 베스트 5장');
  const hands = ['AsKsQsJsTs2c3d', 'AsAdAhAc9s9d2c', 'Ah7h5h3h2hKsQd', 'As2c3d4h5s9hKd'];
  for (const h of hands) {
    const cards = parseCards(h);
    const score = evaluate7(cards);
    console.log(`  ${cardsToString(cards)}  →  ${CATEGORY_NAMES[categoryOf(score)]}`);
  }
}

/* 2) 몬테카를로 에쿼티 수렴 ------------------------------------------------- */
function demoEquityConvergence() {
  section('2. 몬테카를로 에쿼티 수렴 — AsKs vs 7h6h (보드 Ah7d2c9s)');
  const board = 'Ah7d2c9s'; // 턴까지 고정 → 정확 열거가 저렴 (남은 카드 44장)
  const truth = exactEquity('AsKs', '7h6h', board);
  console.log(`  정확값(열거 ${truth.combinations}개): 히어로 ${pct(truth.equities[0])}`);
  console.log('');
  console.log('   반복수 |   MC 추정 |   오차(절대) |  이론적 표준오차 1/(2√N)');
  line();
  for (const N of [100, 500, 2000, 10000, 50000, 200000]) {
    const mc = calcEquity([{ cards: 'AsKs' }, { cards: '7h6h' }], {
      board,
      iterations: N,
      seed: 12345,
    });
    const err = Math.abs(mc.equities[0] - truth.equities[0]);
    const se = 1 / (2 * Math.sqrt(N));
    console.log(
      `  ${String(N).padStart(7)} | ${pct(mc.equities[0])} | ${pct(err)}   | ${pct(se)}`,
    );
  }
  console.log('  → 오차는 대략 1/√N 속도로 줄어듭니다 (몬테카를로의 핵심 성질).');
}

/* 3) ICM -------------------------------------------------------------------- */
function demoIcm() {
  section('3. ICM — 칩을 상금 기대값으로');
  const stacks = [5000, 3000, 1500, 500];
  const payouts = [50, 30, 20];
  const { equities } = icm(stacks, payouts);
  const totalChips = stacks.reduce((a, b) => a + b, 0);
  console.log('  스택      칩%      ICM%     (칩%>ICM% 이면 칩가치 압축)');
  line();
  equities.forEach((eq, i) => {
    const chipPct = stacks[i] / totalChips;
    const icmPct = eq / 100;
    console.log(
      `  ${String(stacks[i]).padStart(5)}   ${pct(chipPct)}  ${pct(icmPct)}   ${
        chipPct > icmPct ? '↓ 압축' : '↑ 프리미엄'
      }`,
    );
  });
  console.log('  → 칩 리더의 칩%는 ICM%보다 큽니다: 토너먼트에선 칩의 한계가치가 체감합니다.');
}

/* 4) MCCFR 리버 솔버 수렴 --------------------------------------------------- */
function demoCfrConvergence() {
  section('4. MCCFR 리버 솔버 — 반복을 늘리며 전략 수렴');
  // 양극화 OOP(너트 77 + 에어 65s) vs 블러프캐쳐(KdJd), 보드 KsQd7h2c3s
  const board = 'KsQd7h2c3s';
  const oop = [
    ...rangeToCombos(parseRange('77')).map((x) => x.combo),
    ...rangeToCombos(parseRange('65s')).map((x) => x.combo),
  ];
  const ip = [parseCards('KdJd')];
  console.log('  보드 KsQd7h2c3s · 팟 100 · 베팅 75% · OOP={77 너트, 65s 에어} vs IP=KdJd');
  console.log('');
  console.log('   반복수 |  OOP 베팅% |  IP 콜%(vs벳) |  OOP EV');
  line();
  for (const N of [500, 2000, 8000, 30000, 100000]) {
    const r = solveRiver({ board, oopRange: oop, ipRange: ip, pot: 100, betFraction: 0.75, iterations: N, seed: 7 });
    console.log(
      `  ${String(N).padStart(7)} | ${pct(r.oopBetFreq)}  | ${pct(r.ipCallVsBetFreq)}    | ${r.oopEV.toFixed(2)}`,
    );
  }
  console.log('  → 너트는 100% 밸류 베팅, 에어는 IP를 무차별하게 만드는 빈도로 블러프합니다.');
  console.log('    (반복이 늘수록 빈도가 균형값으로 안정화)');
}

console.log('\n🃏  GTO/ICM Solver — Monte-Carlo Lab (학습용)');
demoEvaluator();
demoEquityConvergence();
demoIcm();
demoCfrConvergence();
console.log('');
line('═');
console.log('  끝. 각 함수는 packages/engine 의 공개 API만 사용합니다.');
line('═');
