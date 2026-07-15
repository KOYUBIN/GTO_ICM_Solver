#!/usr/bin/env node
/**
 * Precompute an ICM push/fold quiz set from the engine's ICM shove model.
 *
 * For a handful of realistic MTT/SNG ICM scenarios (stone bubbles, pay jumps,
 * big-field money bubbles, and a deliberate chip-EV-vs-ICM conflict spot) this
 * script scores ~26 hands spanning the shove/fold ICM boundary with:
 *
 *   - icmShoveEv  -> the +ICM-EV action (shove/fold) in prize-pool fractions
 *   - shoveEv     -> the chip-EV of the same shove, in bb, for contrast
 *   - bubbleFactor-> risk/reward asymmetry vs the biggest covering opponent
 *
 * When chip-EV and ICM disagree (e.g. a marginal jam that is +chipEV but the
 * bubble makes it -ICM), the emitted note calls it out in Korean.
 *
 * The model is a directional first-in shove indicator, NOT a solver — see the
 * documented simplifications in src/mtt.ts (icmShoveEv).
 *
 * Usage:
 *   npm run build:engine                 # script imports the BUILT dist
 *   node scripts/gen-quiz-icm.mjs
 *
 * Output: packages/engine/src/generated/quiz-icm.json
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const distIndex = join(engineRoot, 'dist', 'index.js');
const srcJsonPath = join(engineRoot, 'src', 'generated', 'quiz-icm.json');

if (!existsSync(distIndex)) {
  console.error('dist/index.js not found — run `npm run build:engine` first.');
  process.exit(1);
}

const engine = await import(pathToFileURL(distIndex).href);
const { icmShoveEv, bubbleFactor, payoutsFor, shoveEv, parseRange, rangePercent } = engine;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ITERATIONS = 2000;
const MODEL_DESC = 'icmShoveEv first-in model + chip-EV shove contrast';

// djb2 -> a stable non-negative int seed from an id string.
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h & 0x7fffffff;
}
const round = (x, d) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

// ~57 hands spanning the shove/fold ICM boundary: premium anchors that always
// shove, trash anchors that always fold, and a broad spread of borderline
// broadways, small pairs, suited aces/kings, and suited connectors that flip
// with the scenario. (6 scenarios x 57 hands = 342 quiz items.)
const HANDS = [
  // pairs
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
  // suited aces
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A5s', 'A4s', 'A3s', 'A2s',
  // offsuit aces
  'AKo', 'AQo', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o', 'A5o', 'A2o',
  // suited kings
  'KQs', 'KJs', 'KTs', 'K9s',
  // offsuit kings
  'KQo', 'KJo', 'KTo', 'K9o', 'K7o',
  // suited queens / broadways
  'QJs', 'QTs', 'Q9s', 'QJo', 'QTo',
  // suited connectors + a broadway offsuit
  'JTs', 'J9s', 'T9s', '98s', '87s', '76s', 'JTo',
  // trash anchors
  '72o', '82o', '32o',
];

// ---------------------------------------------------------------------------
// Scenarios (Korean). callerRanges list the seats left to act behind the hero,
// in action order, with the range they call the open-shove with. Ranges are
// tightened/loosened by the ICM pressure of the spot.
// ---------------------------------------------------------------------------
const SCENARIOS = [
  {
    key: 'sng-bubble-even',
    scenario: '9인 SNG 버블 · 4인 남음(3인 지급) · 니어이븐 스택',
    payoutName: '9인 SNG (50/30/20)',
    payouts: payoutsFor(9, 'sng-9max'),
    // table order: [CO, BTN, SB(hero), BB]
    stacks: [1500, 1520, 1480, 1500],
    heroIdx: 2,
    heroPos: 'SB',
    blinds: { sb: 75, bb: 150, ante: 15 },
    callerRanges: [
      { idx: 3, range: '22+,A5s+,A9o+,K9s+,KJo+,Q9s+,QJo,JTs,T9s' }, // BB defends vs SB jam (bubble-tightened)
    ],
  },
  {
    key: 'sng-bubble-bigstack',
    scenario: '9인 SNG 버블 · 히어로 빅스택 vs 숏스택 (압박)',
    payoutName: '9인 SNG (50/30/20)',
    payouts: payoutsFor(9, 'sng-9max'),
    // table order: [BTN(hero), CO(folded), SB, BB]
    stacks: [3200, 1400, 800, 600],
    heroIdx: 0,
    heroPos: 'BTN',
    blinds: { sb: 75, bb: 150, ante: 15 },
    callerRanges: [
      { idx: 2, range: '99+,AQs+,AKo' }, // SB short — calls only nut-ish (busting = losing the bubble)
      { idx: 3, range: '88+,AJs+,AQo+' }, // BB short
    ],
  },
  {
    key: 'sng-bubble-short',
    scenario: '9인 SNG 버블 · 히어로 숏스택(4bb) 올인 압박',
    payoutName: '9인 SNG (50/30/20)',
    payouts: payoutsFor(9, 'sng-9max'),
    // table order: [BTN(hero), CO(folded), SB, BB]
    stacks: [650, 2100, 1900, 1950],
    heroIdx: 0,
    heroPos: 'BTN',
    blinds: { sb: 75, bb: 150, ante: 15 },
    callerRanges: [
      { idx: 2, range: '44+,A2s+,A8o+,K9s+,KTo+,Q9s+,QTo+,J9s+,JTo,T9s' }, // SB big stack calls a short jam wide
      { idx: 3, range: '55+,A5s+,A9o+,KTs+,KJo+,QTs+,JTs' }, // BB big stack
    ],
  },
  {
    key: 'mtt-ft-payjump',
    scenario: 'MTT 파이널테이블 · 6인 남음 · 페이점프',
    payoutName: 'MTT FT (탑헤비, 10인 지급)',
    payouts: payoutsFor(60), // mtt-46-100 top-heavy ladder; top 6 places used
    // table order: [UTG, HJ, CO(hero), BTN, SB, BB]
    stacks: [180000, 60000, 90000, 240000, 150000, 120000],
    heroIdx: 2,
    heroPos: 'CO',
    blinds: { sb: 5000, bb: 10000, ante: 1000 },
    callerRanges: [
      { idx: 3, range: '77+,ATs+,AJo+,KQs' }, // BTN big stack (covers) applies/absorbs pressure
      { idx: 4, range: '99+,AJs+,AQo+,KQs' }, // SB
      { idx: 5, range: '88+,ATs+,AJo+,KQo' }, // BB
    ],
  },
  {
    key: 'mtt-money-bubble',
    scenario: 'MTT 머니버블 · 200명 필드 · 27인 지급 (탈락=노머니)',
    payoutName: 'MTT 200명 (27인 지급)',
    payouts: payoutsFor(200), // mtt-101-300 structure (27 paid)
    // table order: [UTG, UTG1, MP, HJ, CO(hero), BTN, SB, BB]
    stacks: [200000, 130000, 90000, 170000, 60000, 240000, 100000, 150000],
    heroIdx: 4,
    heroPos: 'CO',
    blinds: { sb: 5000, bb: 10000, ante: 1000 },
    callerRanges: [
      { idx: 5, range: '99+,AQs+,AKo' }, // BTN — everyone protects the min-cash, calls very tight
      { idx: 6, range: 'TT+,AKs,AKo' }, // SB
      { idx: 7, range: 'TT+,AQs+,AKo' }, // BB
    ],
  },
  {
    key: 'sng-bubble-conflict',
    scenario: 'SNG 버블 · 칩EV vs ICM 충돌 · 히어로 커버당함',
    payoutName: '9인 SNG (50/30/20)',
    payouts: payoutsFor(9, 'sng-9max'),
    // table order: [CO(hero), BTN(big), SB(short), BB(big)] — hero covered by two big stacks
    stacks: [1500, 2700, 900, 2600],
    heroIdx: 0,
    heroPos: 'CO',
    blinds: { sb: 75, bb: 150, ante: 15 },
    callerRanges: [
      { idx: 1, range: '88+,ATs+,AJo+,KQs' }, // BTN big stack calls tight -> lots of fold equity (chipEV likes the jam)
      { idx: 2, range: '77+,ATs+,AJo+,KQs' }, // SB short
      { idx: 3, range: '99+,AJs+,AQo+' }, // BB big stack
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approx aggregate call % (for shoveEv's flat-call model) from the caller ranges. */
function avgCallPercent(callerRanges) {
  const pcts = callerRanges.map((c) => rangePercent(parseRange(c.range)));
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  return Math.max(1, Math.min(75, mean));
}

/** Biggest opponent that covers the hero; falls back to the biggest opponent. */
function biggestCoveringOpponent(stacks, heroIdx) {
  const hero = stacks[heroIdx];
  let coveringIdx = -1;
  let biggestIdx = -1;
  for (let i = 0; i < stacks.length; i++) {
    if (i === heroIdx) continue;
    if (biggestIdx < 0 || stacks[i] > stacks[biggestIdx]) biggestIdx = i;
    if (stacks[i] >= hero && (coveringIdx < 0 || stacks[i] > stacks[coveringIdx])) coveringIdx = i;
  }
  return coveringIdx >= 0 ? coveringIdx : biggestIdx;
}

function makeNote(chipEvBB, decision, bf) {
  const chipSaysShove = chipEvBB > 0;
  const icmSaysShove = decision === 'shove';
  const bfStr = Number.isFinite(bf) ? `버블팩터 ${round(bf, 2)}` : '버블팩터 ∞';
  if (chipSaysShove !== icmSaysShove) {
    // Sign disagreement — highlight the ICM pressure.
    const x = chipSaysShove ? '슈브' : '폴드';
    const y = icmSaysShove ? '슈브' : '폴드';
    return `칩EV로는 ${x}지만 ICM 압박으로 ${y} (${bfStr})`;
  }
  if (icmSaysShove) return `칩EV·ICM 모두 슈브 (${bfStr})`;
  return `칩EV·ICM 모두 폴드 (${bfStr})`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const items = [];
const startedAt = Date.now();

for (const sc of SCENARIOS) {
  const { stacks, payouts, heroIdx, blinds } = sc;
  const heroBB = Math.round(stacks[heroIdx] / blinds.bb);
  const callPercent = avgCallPercent(sc.callerRanges);
  const villainIdx = biggestCoveringOpponent(stacks, heroIdx);

  for (const hand of HANDS) {
    const id = `icm-${sc.key}-${sc.heroPos}-${heroBB}bb-${hand}`;
    const seed = djb2(id);

    const res = icmShoveEv({
      stacks,
      payouts,
      heroIdx,
      heroHand: hand,
      callerRanges: sc.callerRanges,
      sb: blinds.sb,
      bb: blinds.bb,
      ante: blinds.ante,
      iterations: ITERATIONS,
      seed,
    });
    const decision = res.shoveOk ? 'shove' : 'fold';

    const chip = shoveEv(hand, {
      stackBB: heroBB,
      callPercent,
      playersBehind: sc.callerRanges.length,
      iterations: ITERATIONS,
      seed,
    });

    const bf = bubbleFactor(stacks, payouts, heroIdx, villainIdx);

    const item = {
      id,
      scenario: sc.scenario,
      payoutName: sc.payoutName,
      payouts: payouts.map((x) => round(x, 6)),
      stacks: stacks.slice(),
      heroIdx,
      heroPos: sc.heroPos,
      blinds: { sb: blinds.sb, bb: blinds.bb, ante: blinds.ante },
      hand,
      decision,
      evChipShoveBB: round(chip.evShove, 4),
      evIcmShove: round(res.evShoveICM, 6),
      evIcmFold: round(res.evFoldICM, 6),
      deltaIcm: round(res.deltaICM, 6),
      note: makeNote(chip.evShove, decision, bf),
    };
    if (Number.isFinite(bf)) item.bubbleFactor = round(bf, 3);

    items.push(item);
  }
}

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    model: MODEL_DESC,
    count: items.length,
  },
  icm: items,
};

mkdirSync(dirname(srcJsonPath), { recursive: true });
writeFileSync(srcJsonPath, JSON.stringify(out, null, 2) + '\n');

const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `Wrote ${items.length} ICM quiz items (${SCENARIOS.length} scenarios x ${HANDS.length} hands) ` +
    `in ${secs}s -> ${srcJsonPath}`,
);
console.log(`count: ${items.length}`);
