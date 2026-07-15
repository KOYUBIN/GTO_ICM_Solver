#!/usr/bin/env node
/**
 * Self-simulation data pipeline: preflop RFI ranges from Monte-Carlo chip-EV.
 *
 * For every 6-max open position (UTG/MP/CO/BTN/SB) and MTT stack depth
 * (5/10/15/20/25/30/40/50/70/100 bb) this script scores ALL 169 starting-hand
 * labels with a depth-aware Monte-Carlo chip-EV model. The stored value is
 * EV in big blinds relative to folding; labels with EV > 0 form the derived
 * RFI range (consumed by src/simdata.ts).
 *
 * Depth-aware model (documented, honest):
 *   - <= 15bb ("shove-EV", push/fold): the open is an all-in, scored with the
 *     engine's `shoveEv`. Callers use a position-keyed call % (tighter than a
 *     continue range: UTG 9 / MP 11 / CO 14 / BTN 18 / SB 25) that is widened
 *     for shorter shoves (SHOVE_CALL_MUL) — people call 5bb jams far lighter
 *     than 15bb jams. Fold-through = (1-call%)^playersBehind.
 *   - >= 20bb ("raise-EV"): the open is a small raise, scored with
 *     `openRaiseEv` — raiseTo 2.0bb at 20-25bb, 2.3bb at 30bb+ — into 1.5bb
 *     dead money against a single effective caller.
 *   - continue range (raise-EV only) = top-X% by Chen strength, X keyed by
 *     position (an aggregate of everyone left to act; per-defender X with
 *     fold-through (1-X)^playersBehind). Shallower stacks widen X slightly
 *     and shade realization down to stand in for 3bet-shove-heavy continues.
 *   - equity realization (raise-EV only) = positional base (realizationFor)
 *     x a hand-quality factor from the Chen score: trash realizes far less
 *     of its raw equity than premium hands. This is what separates open vs
 *     fold; it is a calibrated heuristic, NOT a solver output.
 *   - chip EV only: no ICM, no rake, no multiway pots, no 3bet subtree.
 *
 * The per-block model is recorded in the JSON as
 * `blockMeta["POS-STACK"] = 'shove-EV' | 'raise-EV'`.
 *
 * Usage:
 *   npm run build:engine                      # script imports the BUILT dist
 *   npm run gen:preflop -w @gto/engine
 *   node scripts/gen-preflop.mjs --iterations 20000 [--force]
 *
 * Resumable: the output JSON is checkpointed after every position/stack
 * block; on restart, blocks whose config hash matches are reused (use
 * --force to recompute everything).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const distIndex = join(engineRoot, 'dist', 'index.js');
const srcJsonPath = join(engineRoot, 'src', 'generated', 'rfi-sim.json');
const distJsonPath = join(engineRoot, 'dist', 'generated', 'rfi-sim.json');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}
const ITERATIONS = Math.max(100, parseInt(argValue('iterations', '20000'), 10));
const FORCE = argv.includes('--force');

// ---------------------------------------------------------------------------
// Simulation config (all of this feeds the config hash for resumability)
// ---------------------------------------------------------------------------
const POT_BB = 1.5;
const STACKS = [5, 10, 15, 20, 25, 30, 40, 50, 70, 100];
const SEED_BASE = 20260714;

// Depth-aware model split: <= 15bb is an open-shove (push/fold), >= 20bb a
// small open raise. Recorded per block in the JSON (blockMeta).
const SHOVE_MAX_STACK = 15;
const modelFor = (stack) => (stack <= SHOVE_MAX_STACK ? 'shove-EV' : 'raise-EV');

// Raise-EV blocks: 2.0x at 20-25bb (standard short-stack MTT sizing), 2.3x
// above.
const RAISE_TO_BY_STACK = { 20: 2.0, 25: 2.0, 30: 2.3, 40: 2.3, 50: 2.3, 70: 2.3, 100: 2.3 };

// Per position: players left to act, per-defender continue % vs a small raise
// (top-X% of hands; the aggregate fold-through is (1-X)^playersBehind), how
// many non-blind seats are behind (drives the positional realization base),
// and the per-defender call % vs an open-SHOVE (much tighter — calling an
// all-in needs a real hand).
const POSITIONS = {
  UTG: { playersBehind: 5, continuePercent: 17, ipBehind: 3, shoveCallPercent: 9 },
  MP: { playersBehind: 4, continuePercent: 18, ipBehind: 2, shoveCallPercent: 11 },
  CO: { playersBehind: 3, continuePercent: 24, ipBehind: 1, shoveCallPercent: 14 },
  BTN: { playersBehind: 2, continuePercent: 31, ipBehind: 0, shoveCallPercent: 18 },
  SB: { playersBehind: 1, continuePercent: 52, ipBehind: 5, shoveCallPercent: 25 }, // OOP vs BB postflop
};

// Shove-EV blocks: shorter jams get called much wider (risking 5bb to bust a
// 5bb shove is cheap; calling 15bb needs a real hand). The multiplier scales
// the positional shoveCallPercent — calibrated so shove ranges widen
// monotonically as stacks drop yet stay narrower than the 20bb+ raise ranges.
const SHOVE_CALL_MUL = { 5: 2.4, 10: 2.1, 15: 1.5 };

// Raise-EV blocks at shallower depths: continues get more 3bet-shove-heavy.
// The single-caller model approximates that by widening the continue range
// and shading the hero's realization down a touch.
const STACK_ADJ = {
  20: { contMul: 1.1, realAdd: -0.03 },
  25: { contMul: 1.08, realAdd: -0.025 },
  30: { contMul: 1.06, realAdd: -0.02 },
  40: { contMul: 1.05, realAdd: -0.015 },
  50: { contMul: 1.04, realAdd: -0.01 },
  70: { contMul: 1.02, realAdd: -0.005 },
  100: { contMul: 1.0, realAdd: 0 },
};

// Hand-quality realization factor from the Chen score (~-1.5 .. 20):
// premium hands realize (almost) all of their equity, trash realizes little.
const HAND_FACTOR = { base: 0.24, perChen: 0.058, min: 0.3, max: 1.1 };

function handFactor(chen) {
  const f = HAND_FACTOR.base + HAND_FACTOR.perChen * chen;
  return Math.min(HAND_FACTOR.max, Math.max(HAND_FACTOR.min, f));
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

const MODEL_DESC =
  'chip-EV MC: raise-EV vs positional continue range (>=20bb) + push/fold shove-EV (<=15bb)';

const CONFIG_HASH = djb2(
  JSON.stringify({
    POT_BB,
    STACKS,
    SEED_BASE,
    SHOVE_MAX_STACK,
    RAISE_TO_BY_STACK,
    POSITIONS,
    SHOVE_CALL_MUL,
    STACK_ADJ,
    HAND_FACTOR,
    ITERATIONS,
  }),
);

// ---------------------------------------------------------------------------
// Bootstrap: the built dist/index.js itself imports generated/rfi-sim.json,
// so make sure a (possibly stub) copy exists in dist before importing it.
// ---------------------------------------------------------------------------
if (!existsSync(distIndex)) {
  console.error('dist/index.js not found — run `npm run build:engine` first.');
  process.exit(1);
}
const STUB = JSON.stringify(
  {
    meta: {
      generatedAt: '',
      iterationsPerHand: 0,
      model: MODEL_DESC,
      potBB: POT_BB,
      handsEvaluated: 0,
      totalIterations: 0,
      configHash: '',
    },
    blockMeta: {},
    data: {},
  },
  null,
  2,
);
for (const p of [srcJsonPath, distJsonPath]) {
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, STUB + '\n');
  }
}

const engine = await import(pathToFileURL(distIndex).href);
const { allGridLabels, topPercentRange, openRaiseEv, shoveEv, realizationFor, chenScore } = engine;

// ---------------------------------------------------------------------------
// Resume: reuse blocks from a previous run with an identical config.
// ---------------------------------------------------------------------------
let previous = {};
if (!FORCE) {
  try {
    const old = JSON.parse(readFileSync(srcJsonPath, 'utf8'));
    if (old?.meta?.configHash === CONFIG_HASH && old.data) previous = old.data;
  } catch {
    /* stale or corrupt file — regenerate everything */
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const labels = allGridLabels();
const posNames = Object.keys(POSITIONS);
const totalBlocks = posNames.length * STACKS.length;
const data = {};
const blockMeta = {};
const startedAt = Date.now();
let blockNo = 0;
let simulatedHands = 0;

function writeOut() {
  const blocks = Object.keys(data).length;
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      iterationsPerHand: ITERATIONS,
      model: MODEL_DESC,
      potBB: POT_BB,
      handsEvaluated: blocks * labels.length,
      totalIterations: blocks * labels.length * ITERATIONS,
      runtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      configHash: CONFIG_HASH,
      config: {
        positions: POSITIONS,
        raiseToByStack: RAISE_TO_BY_STACK,
        shoveMaxStack: SHOVE_MAX_STACK,
        shoveCallMul: SHOVE_CALL_MUL,
        stackAdjust: STACK_ADJ,
        handFactor: HAND_FACTOR,
        seedBase: SEED_BASE,
      },
    },
    blockMeta,
    data,
  };
  const json = JSON.stringify(out, null, 2) + '\n';
  writeFileSync(srcJsonPath, json);
  mkdirSync(dirname(distJsonPath), { recursive: true });
  writeFileSync(distJsonPath, json); // keep the built engine in sync without a rebuild
}

for (let pi = 0; pi < posNames.length; pi++) {
  const pos = posNames[pi];
  const cfg = POSITIONS[pos];
  for (let si = 0; si < STACKS.length; si++) {
    const stack = STACKS[si];
    const key = `${pos}-${stack}`;
    const model = modelFor(stack);
    blockMeta[key] = model;
    blockNo++;

    if (previous[key] && Object.keys(previous[key]).length === labels.length) {
      data[key] = previous[key];
      console.log(`[${blockNo}/${totalBlocks}] ${key} (${model}): reused previous run (config unchanged)`);
      continue;
    }

    const t0 = Date.now();
    const block = {};
    let open = 0;
    let detail;

    if (model === 'shove-EV') {
      // Push/fold: the "open" is an all-in for the effective stack.
      const callPercent = Math.min(75, cfg.shoveCallPercent * SHOVE_CALL_MUL[stack]);
      for (let li = 0; li < labels.length; li++) {
        const ev = shoveEv(labels[li], {
          stackBB: stack,
          potBB: POT_BB,
          callPercent,
          playersBehind: cfg.playersBehind,
          iterations: ITERATIONS,
          seed: (SEED_BASE + pi * 1_000_000 + si * 10_000 + li) | 0,
        }).evShove;
        block[labels[li]] = Math.round(ev * 10000) / 10000;
        if (ev > 0) open++;
        simulatedHands++;
      }
      detail = `shove, call top-${callPercent.toFixed(1)}%`;
    } else {
      const adj = STACK_ADJ[stack];
      const raiseTo = RAISE_TO_BY_STACK[stack];
      const continuePercent = Math.min(85, cfg.continuePercent * adj.contMul);
      const continueRange = topPercentRange(continuePercent);
      const realBase = realizationFor(cfg.ipBehind);
      for (let li = 0; li < labels.length; li++) {
        const label = labels[li];
        const realization = Math.max(0.2, realBase * handFactor(chenScore(label)) + adj.realAdd);
        const ev = openRaiseEv(label, {
          raiseTo,
          potBB: POT_BB,
          continuePercent,
          continueRange,
          playersBehind: cfg.playersBehind,
          realization,
          iterations: ITERATIONS,
          seed: (SEED_BASE + pi * 1_000_000 + si * 10_000 + li) | 0,
        });
        block[label] = Math.round(ev * 10000) / 10000;
        if (ev > 0) open++;
        simulatedHands++;
      }
      detail = `raise ${raiseTo}x, continue top-${continuePercent.toFixed(1)}%`;
    }

    data[key] = block;
    writeOut(); // checkpoint after every block -> resumable
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[${blockNo}/${totalBlocks}] ${key} (${model}): ${labels.length} hands x ${ITERATIONS} iters ` +
        `in ${secs}s (open ${open}/169, ${detail})`,
    );
  }
}

writeOut();
const totalSecs = ((Date.now() - startedAt) / 1000).toFixed(0);
console.log(
  `\nDone: ${totalBlocks * labels.length} hand evaluations recorded ` +
    `(${simulatedHands} simulated this run, ${totalBlocks * labels.length - simulatedHands} reused), ` +
    `${ITERATIONS.toLocaleString()} MC iterations/hand -> ` +
    `${(totalBlocks * labels.length * ITERATIONS).toLocaleString()} total board rollouts in ${totalSecs}s.`,
);
console.log(`Output: ${srcJsonPath}`);
