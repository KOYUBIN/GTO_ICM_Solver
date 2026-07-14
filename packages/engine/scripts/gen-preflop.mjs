#!/usr/bin/env node
/**
 * Self-simulation data pipeline: preflop RFI ranges from Monte-Carlo chip-EV.
 *
 * For every 6-max open position (UTG/MP/CO/BTN/SB) and stack depth
 * (20/50/100 bb) this script scores ALL 169 starting-hand labels with the
 * engine's `openRaiseEv` — a Monte-Carlo chip-EV model — against a
 * position-keyed continue range (`topPercentRange`). The stored value is
 * EV in big blinds relative to folding; labels with EV > 0 form the derived
 * RFI range (consumed by src/simdata.ts).
 *
 * Model (documented, honest):
 *   - raiseTo 2.3bb into 1.5bb dead money; single effective caller.
 *   - continue range = top-X% by Chen strength, X keyed by position (an
 *     aggregate of everyone left to act; per-defender X with fold-through
 *     (1-X)^playersBehind). Shallower stacks widen X slightly and shade
 *     realization down to stand in for 3bet-shove-heavy continues.
 *   - equity realization = positional base (realizationFor) x a hand-quality
 *     factor from the Chen score: trash realizes far less of its raw equity
 *     than premium hands. This is what separates open vs fold; it is a
 *     calibrated heuristic, NOT a solver output.
 *   - chip EV only: no ICM, no rake, no multiway pots, no 3bet subtree.
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
const RAISE_TO = 2.3;
const POT_BB = 1.5;
const STACKS = [20, 50, 100];
const SEED_BASE = 20260714;

// Per position: players left to act, per-defender continue % (top-X% of
// hands; the aggregate fold-through is (1-X)^playersBehind), and how many
// non-blind seats are behind (drives the positional realization base).
const POSITIONS = {
  UTG: { playersBehind: 5, continuePercent: 17, ipBehind: 3 },
  MP: { playersBehind: 4, continuePercent: 18, ipBehind: 2 },
  CO: { playersBehind: 3, continuePercent: 24, ipBehind: 1 },
  BTN: { playersBehind: 2, continuePercent: 31, ipBehind: 0 },
  SB: { playersBehind: 1, continuePercent: 52, ipBehind: 5 }, // OOP vs BB postflop
};

// Shallower stacks: continues get more 3bet-shove-heavy. The single-caller
// model approximates that by widening the continue range and shading the
// hero's realization down a touch.
const STACK_ADJ = {
  20: { contMul: 1.1, realAdd: -0.03 },
  50: { contMul: 1.04, realAdd: -0.01 },
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

const CONFIG_HASH = djb2(
  JSON.stringify({ RAISE_TO, POT_BB, STACKS, SEED_BASE, POSITIONS, STACK_ADJ, HAND_FACTOR, ITERATIONS }),
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
      model: 'chip-EV MC vs positional continue range',
      raiseTo: RAISE_TO,
      potBB: POT_BB,
      handsEvaluated: 0,
      totalIterations: 0,
      configHash: '',
    },
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
const { allGridLabels, topPercentRange, openRaiseEv, realizationFor, chenScore } = engine;

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
const startedAt = Date.now();
let blockNo = 0;
let simulatedHands = 0;

function writeOut() {
  const blocks = Object.keys(data).length;
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      iterationsPerHand: ITERATIONS,
      model: 'chip-EV MC vs positional continue range',
      raiseTo: RAISE_TO,
      potBB: POT_BB,
      handsEvaluated: blocks * labels.length,
      totalIterations: blocks * labels.length * ITERATIONS,
      runtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      configHash: CONFIG_HASH,
      config: { positions: POSITIONS, stackAdjust: STACK_ADJ, handFactor: HAND_FACTOR, seedBase: SEED_BASE },
    },
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
    blockNo++;

    if (previous[key] && Object.keys(previous[key]).length === labels.length) {
      data[key] = previous[key];
      console.log(`[${blockNo}/${totalBlocks}] ${key}: reused previous run (config unchanged)`);
      continue;
    }

    const adj = STACK_ADJ[stack];
    const continuePercent = Math.min(85, cfg.continuePercent * adj.contMul);
    const continueRange = topPercentRange(continuePercent);
    const realBase = realizationFor(cfg.ipBehind);

    const t0 = Date.now();
    const block = {};
    let open = 0;
    for (let li = 0; li < labels.length; li++) {
      const label = labels[li];
      const realization = Math.max(0.2, realBase * handFactor(chenScore(label)) + adj.realAdd);
      const ev = openRaiseEv(label, {
        raiseTo: RAISE_TO,
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
    data[key] = block;
    writeOut(); // checkpoint after every block -> resumable
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[${blockNo}/${totalBlocks}] ${key}: ${labels.length} hands x ${ITERATIONS} iters in ${secs}s ` +
        `(open ${open}/169, continue top-${continuePercent.toFixed(1)}%)`,
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
