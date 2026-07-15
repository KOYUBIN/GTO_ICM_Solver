#!/usr/bin/env node
/**
 * Precompute a chip-EV preflop QUIZ set (consumed by the quiz UI / data phase).
 *
 * This is a sibling of gen-preflop.mjs: it imports the BUILT engine from
 * ../dist/index.js (so `npm run build:engine` must run first) and mirrors that
 * script's dist-import bootstrap + block checkpointing. Where gen-preflop.mjs
 * scores all 169 labels to derive a range, this script picks only the
 * DECISION-RELEVANT labels for a spot and emits a `ChipEvQuiz` per label.
 *
 * Three lines are covered:
 *   RFI      — hero opens. chip-EV of the open computed here (openRaiseEv, or
 *              shoveEv when the depth is a push/fold depth <= 15bb). Labels are
 *              chosen near the opening-range edge (mixed chart action, or open
 *              EV within a small band of 0), plus fixed anchors (AA/AKs/72o).
 *   vs-RFI   — hero faces an open. gtoMix comes from the GTO chart (raise = a
 *              3bet); no chip-EV (chart-mix based).
 *   vs-3bet  — hero opened and faces a 3bet. gtoMix from the chart (raise = a
 *              4bet); no chip-EV.
 *
 * Output: packages/engine/src/generated/quiz-preflop.json
 *   { meta:{generatedAt,model,count}, chipEv: ChipEvQuiz[] }
 *
 * Deterministic: every Monte-Carlo call is seeded from an FNV-1a hash of the
 * quiz id, so reruns produce identical numbers.
 *
 * Usage:
 *   npm run build:engine
 *   node packages/engine/scripts/gen-quiz-preflop.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const distIndex = join(engineRoot, 'dist', 'index.js');
const outPath = join(engineRoot, 'src', 'generated', 'quiz-preflop.json');

// The built engine imports generated/rfi-sim.json at load time (via simdata);
// make sure a (possibly stub) copy exists in both src and dist before importing
// dist/index.js, exactly like gen-preflop.mjs does.
const rfiSimSrc = join(engineRoot, 'src', 'generated', 'rfi-sim.json');
const rfiSimDist = join(engineRoot, 'dist', 'generated', 'rfi-sim.json');
const RFI_SIM_STUB =
  JSON.stringify(
    {
      meta: { generatedAt: '', iterationsPerHand: 0, model: 'stub', potBB: 1.5, handsEvaluated: 0, totalIterations: 0, configHash: '' },
      blockMeta: {},
      data: {},
    },
    null,
    2,
  ) + '\n';

if (!existsSync(distIndex)) {
  console.error('dist/index.js not found — run `npm run build:engine` first.');
  process.exit(1);
}
for (const p of [rfiSimSrc, rfiSimDist]) {
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, RFI_SIM_STUB);
  }
}

const engine = await import(pathToFileURL(distIndex).href);
const { allGridLabels, topPercentRange, openRaiseEv, shoveEv, getChart, availableVsRfi, availableRfiVs3bet } =
  engine;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MODEL = 'chip-EV MC (openRaiseEv/shoveEv) + GTO chart mix';
const ITERATIONS = 6000;
const RAISE_TO = 2.3;
const EV_BAND = 0.2; // |open EV| <= this (bb) counts as a decision-relevant edge hand
const PER_BLOCK = 30; // ~30 decision-relevant labels per spot
const MAX_ITEMS = 1100; // hard cap on total quiz items
const ANCHORS = ['AA', 'AKs', '72o']; // always included

const SHOVE_MAX_STACK = 15; // RFI at <= this depth is an open-shove (push/fold)

// Per open position: players left to act, per-defender continue % vs a small
// raise (fed to openRaiseEv), and per-defender call % vs an open-shove.
const RFI_POS = {
  UTG: { playersBehind: 5, continuePercent: 17, shoveCallPercent: 9 },
  MP: { playersBehind: 4, continuePercent: 18, shoveCallPercent: 11 },
  CO: { playersBehind: 3, continuePercent: 24, shoveCallPercent: 14 },
  BTN: { playersBehind: 2, continuePercent: 31, shoveCallPercent: 18 },
  SB: { playersBehind: 1, continuePercent: 52, shoveCallPercent: 25 },
};
const RFI_ORDER = ['UTG', 'MP', 'CO', 'BTN', 'SB'];
const RFI_STACKS = [10, 20, 30, 50, 100];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const LABELS = allGridLabels();
const GRID_INDEX = new Map(LABELS.map((l, i) => [l, i]));

/** FNV-1a 32-bit hash -> unsigned int seed. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Math.round(x * 10000) / 10000;

/** {fold,call,raise} for a label from a chart strategy (default = pure fold). */
function mixFor(chart, label) {
  return chart.hands.get(label) ?? { fold: 1, call: 0, raise: 0 };
}

/** argmax over a full mix (ties: raise > call > fold). */
function bestOf(mix) {
  const entries = [
    ['raise', mix.raise ?? 0],
    ['call', mix.call ?? 0],
    ['fold', mix.fold ?? 0],
  ];
  let best = entries[0];
  for (const e of entries) if (e[1] > best[1]) best = e;
  return best[0];
}

const maxAction = (mix) => Math.max(mix.fold ?? 0, mix.call ?? 0, mix.raise ?? 0);

// ---------------------------------------------------------------------------
// Accumulate + checkpoint (mirrors gen-preflop.mjs writeOut-per-block)
// ---------------------------------------------------------------------------
const items = [];
function writeOut() {
  const out = {
    meta: { generatedAt: new Date().toISOString(), model: MODEL, count: items.length },
    chipEv: items,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
}
function room() {
  return MAX_ITEMS - items.length;
}

// ---------------------------------------------------------------------------
// RFI blocks
// ---------------------------------------------------------------------------
function buildRfiBlock(heroPos, stackBB) {
  const cfg = RFI_POS[heroPos];
  const isShove = stackBB <= SHOVE_MAX_STACK;
  const chart = getChart({ gameType: 'cash', stackBB, heroPos, line: 'RFI' });
  const continueRange = isShove ? null : topPercentRange(cfg.continuePercent);

  // Score every label: chart mix + chip-EV of the open (raise EV, or shove EV).
  const scored = LABELS.map((label) => {
    const mix = mixFor(chart, label);
    const seed = fnv1a(`rfi-${heroPos}-${stackBB}-${label}`);
    let ev;
    if (isShove) {
      ev = shoveEv(label, {
        stackBB,
        callPercent: cfg.shoveCallPercent,
        playersBehind: cfg.playersBehind,
        iterations: ITERATIONS,
        seed,
      }).evShove;
    } else {
      ev = openRaiseEv(label, {
        raiseTo: RAISE_TO,
        continueRange,
        continuePercent: cfg.continuePercent,
        playersBehind: cfg.playersBehind,
        iterations: ITERATIONS,
        seed,
      });
    }
    return { label, mix, ev };
  });

  const byLabel = new Map(scored.map((s) => [s.label, s]));

  // Decision-relevant = mixed chart action (nothing >= 0.9) OR open EV near 0.
  const relevant = scored.filter((s) => maxAction(s.mix) < 0.9 || Math.abs(s.ev) <= EV_BAND);

  // Keep the anchors + the labels closest to the open/fold edge, capped.
  const anchorEntries = ANCHORS.map((l) => byLabel.get(l)).filter(Boolean);
  const anchorSet = new Set(ANCHORS);
  const rest = relevant
    .filter((s) => !anchorSet.has(s.label))
    .sort((a, b) => Math.abs(a.ev) - Math.abs(b.ev) || GRID_INDEX.get(a.label) - GRID_INDEX.get(b.label));
  const chosen = [...anchorEntries, ...rest.slice(0, Math.max(0, PER_BLOCK - anchorEntries.length))];

  const out = [];
  for (const s of chosen) {
    const best = bestOf(s.mix);
    out.push({
      id: `rfi-${heroPos}-${stackBB}-${s.label}`,
      line: 'RFI',
      heroPos,
      stackBB,
      hand: s.label,
      actions: ['raise', 'fold'],
      gtoMix: { raise: r3(s.mix.raise ?? 0), fold: r3(s.mix.fold ?? 0) },
      evBB: { raise: r4(s.ev), fold: 0 },
      best,
      isShove,
      note: isShove
        ? `${heroPos} ${stackBB}bb 푸시/폴드 경계 — 올인 EV ${r3(s.ev)}bb (폴드 0)`
        : `${heroPos} ${stackBB}bb 오픈 경계 — 레이즈 EV ${r3(s.ev)}bb (폴드 0)`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// vs-RFI / vs-3bet blocks (chart-mix based, no chip-EV)
// ---------------------------------------------------------------------------
function buildChartBlock(line, heroPos, villainPos, chartLine, idPrefix, noteFn) {
  const chart = getChart({ gameType: 'cash', stackBB: 100, heroPos, villainPos, line: chartLine });

  // Candidates = every label the chart assigns an action to, plus anchors.
  const cand = new Map();
  for (const [label, mix] of chart.hands) cand.set(label, mix);
  for (const a of ANCHORS) if (!cand.has(a)) cand.set(a, mixFor(chart, a));

  // Decision-relevant first (most mixed), then fill toward ~30; anchors kept.
  const anchorSet = new Set(ANCHORS);
  const entries = [...cand.entries()].map(([label, mix]) => ({ label, mix }));
  const anchorEntries = entries.filter((e) => anchorSet.has(e.label));
  const rest = entries
    .filter((e) => !anchorSet.has(e.label))
    .sort((a, b) => maxAction(a.mix) - maxAction(b.mix) || GRID_INDEX.get(a.label) - GRID_INDEX.get(b.label));
  const chosen = [...anchorEntries, ...rest.slice(0, Math.max(0, PER_BLOCK - anchorEntries.length))];

  const out = [];
  for (const { label, mix } of chosen) {
    out.push({
      id: `${idPrefix}-${heroPos}v${villainPos}-100-${label}`,
      line,
      heroPos,
      villainPos,
      stackBB: 100,
      hand: label,
      actions: ['raise', 'call', 'fold'],
      gtoMix: { raise: r3(mix.raise ?? 0), call: r3(mix.call ?? 0), fold: r3(mix.fold ?? 0) },
      best: bestOf(mix),
      note: noteFn(heroPos, villainPos, chart.source),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
let blockNo = 0;

// RFI
for (const heroPos of RFI_ORDER) {
  for (const stackBB of RFI_STACKS) {
    if (room() <= 0) break;
    const block = buildRfiBlock(heroPos, stackBB).slice(0, room());
    items.push(...block);
    writeOut();
    blockNo++;
    console.log(`[${blockNo}] RFI ${heroPos} ${stackBB}bb: +${block.length} (total ${items.length})`);
  }
}

// vs-RFI
for (const [heroPos, villainPos] of availableVsRfi()) {
  if (room() <= 0) break;
  const block = buildChartBlock(
    'vs-RFI',
    heroPos,
    villainPos,
    'vs-RFI',
    'vsrfi',
    (h, v, src) => `${h}, ${v} 오픈에 대응 — 3벳/콜/폴드 (${src} 믹스)`,
  ).slice(0, room());
  items.push(...block);
  writeOut();
  blockNo++;
  console.log(`[${blockNo}] vs-RFI ${heroPos} vs ${villainPos}: +${block.length} (total ${items.length})`);
}

// vs-3bet
for (const { hero, villain } of availableRfiVs3bet()) {
  if (room() <= 0) break;
  const block = buildChartBlock(
    'vs-3bet',
    hero,
    villain,
    'RFI-vs-3bet',
    'vs3bet',
    (h, v, src) => `${h} 오픈 후 ${v} 3벳 대응 — 4벳/콜/폴드 (${src} 믹스)`,
  ).slice(0, room());
  items.push(...block);
  writeOut();
  blockNo++;
  console.log(`[${blockNo}] vs-3bet ${hero} vs ${villain}: +${block.length} (total ${items.length})`);
}

writeOut();
console.log(`\nDone: ${items.length} quiz items -> ${outPath}`);
