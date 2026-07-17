/**
 * Blind / chip presets for the multiplayer table.
 *
 * Each preset is a starting stack plus a blind-level schedule (the standard
 * tournament structure: levels rise on a clock). Cash games use a single fixed
 * level and never escalate. The room store picks the current level's blinds; a
 * fully-custom config lets friends dial in their own structure.
 */

export type GameSpeed = 'hyper-turbo' | 'turbo' | 'classic' | 'deepstack' | 'cash' | 'monster';

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface BlindPreset {
  id: GameSpeed | string;
  /** Korean display label. */
  name: string;
  startingStack: number;
  levels: BlindLevel[];
  /** Minutes per level (0 for cash / no clock). */
  levelMinutes: number;
  isCash: boolean;
  /** Optional re-buy stack size (tournaments that allow re-buys). */
  rebuyStack?: number;
  /** Optional late-registration cutoff level (1-based). */
  lateRegLevel?: number;
}

/** Helper: build a level schedule from [sb, bb, ante] triples. */
function levels(rows: [number, number, number][]): BlindLevel[] {
  return rows.map(([smallBlind, bigBlind, ante], i) => ({
    level: i + 1,
    smallBlind,
    bigBlind,
    ante,
  }));
}

export const BLIND_PRESETS: Record<GameSpeed, BlindPreset> = {
  'hyper-turbo': {
    id: 'hyper-turbo',
    name: '하이퍼터보',
    startingStack: 500,
    levelMinutes: 3,
    isCash: false,
    levels: levels([
      [10, 20, 0],
      [15, 30, 0],
      [25, 50, 5],
      [50, 100, 10],
      [75, 150, 15],
      [100, 200, 25],
      [150, 300, 40],
      [200, 400, 50],
    ]),
  },
  turbo: {
    id: 'turbo',
    name: '터보',
    startingStack: 1500,
    levelMinutes: 6,
    isCash: false,
    levels: levels([
      [10, 20, 0],
      [15, 30, 0],
      [20, 40, 0],
      [30, 60, 5],
      [50, 100, 10],
      [75, 150, 15],
      [100, 200, 25],
      [150, 300, 30],
      [200, 400, 50],
      [300, 600, 75],
    ]),
  },
  classic: {
    id: 'classic',
    name: '클래식',
    startingStack: 3000,
    levelMinutes: 12,
    isCash: false,
    levels: levels([
      [25, 50, 0],
      [50, 100, 0],
      [75, 150, 0],
      [100, 200, 25],
      [150, 300, 25],
      [200, 400, 50],
      [300, 600, 75],
      [400, 800, 100],
      [600, 1200, 150],
      [800, 1600, 200],
      [1000, 2000, 300],
    ]),
  },
  deepstack: {
    id: 'deepstack',
    name: '딥스택',
    startingStack: 10000,
    levelMinutes: 20,
    isCash: false,
    levels: levels([
      [50, 100, 0],
      [75, 150, 0],
      [100, 200, 0],
      [150, 300, 25],
      [200, 400, 50],
      [300, 600, 75],
      [400, 800, 100],
      [500, 1000, 100],
      [700, 1400, 200],
      [1000, 2000, 300],
      [1500, 3000, 400],
      [2000, 4000, 500],
    ]),
  },
  cash: {
    id: 'cash',
    name: '캐시',
    startingStack: 200, // 100bb at 1/2
    levelMinutes: 0,
    isCash: true,
    levels: levels([[1, 2, 0]]),
  },
  monster: {
    id: 'monster',
    name: '몬스터 (파이널 나인)',
    // 공식 구조: 스타트 300만 / 리바이 400만 (리바이 2회), 레벨 10분, L10 뒤 레지 마감.
    startingStack: 3_000_000,
    levelMinutes: 10,
    isCash: false,
    rebuyStack: 4_000_000,
    lateRegLevel: 10, // BREAK 2 (Entry Close) — L10까지 등록/리바이
    // BB-sized ante kicks in from level 3 onward. 25-level 파이널 나인 ladder.
    levels: levels([
      [10_000, 20_000, 0],
      [20_000, 40_000, 0],
      [30_000, 60_000, 60_000],
      [40_000, 80_000, 80_000],
      [50_000, 100_000, 100_000],
      [60_000, 120_000, 120_000],
      [80_000, 160_000, 160_000],
      [100_000, 200_000, 200_000],
      [150_000, 300_000, 300_000],
      [200_000, 400_000, 400_000], // L10 — 이후 레지 마감
      [300_000, 600_000, 600_000],
      [400_000, 800_000, 800_000],
      [500_000, 1_000_000, 1_000_000],
      [600_000, 1_200_000, 1_200_000],
      [800_000, 1_600_000, 1_600_000],
      [1_000_000, 2_000_000, 2_000_000],
      [1_500_000, 3_000_000, 3_000_000],
      [2_000_000, 4_000_000, 4_000_000],
      [3_000_000, 6_000_000, 6_000_000],
      [4_000_000, 8_000_000, 8_000_000],
      [5_000_000, 10_000_000, 10_000_000],
      [6_000_000, 12_000_000, 12_000_000],
      [8_000_000, 16_000_000, 16_000_000],
      [10_000_000, 20_000_000, 20_000_000],
      [20_000_000, 40_000_000, 40_000_000],
    ]),
  },
};

export const PRESET_LIST: BlindPreset[] = Object.values(BLIND_PRESETS);

/** Fully-custom structure a host can configure in the "상세 설정" panel. */
export interface CustomConfig {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  levelMinutes: number;
  /** Optional explicit ladder; when omitted a single fixed level is used. */
  customLevels?: BlindLevel[];
}

/** Build a one-off preset from a custom config. */
export function buildCustomPreset(cfg: CustomConfig, name = '커스텀'): BlindPreset {
  const lvls =
    cfg.customLevels && cfg.customLevels.length
      ? cfg.customLevels
      : levels([[cfg.smallBlind, cfg.bigBlind, cfg.ante]]);
  return {
    id: 'custom',
    name,
    startingStack: cfg.startingStack,
    levelMinutes: cfg.levelMinutes,
    isCash: cfg.levelMinutes === 0 && lvls.length === 1,
    levels: lvls,
  };
}

/** Look up a preset by id, falling back to classic. */
export function getPreset(id: string): BlindPreset {
  return (BLIND_PRESETS as Record<string, BlindPreset>)[id] ?? BLIND_PRESETS.classic;
}

/** The blind level at a given index (clamped to the last defined level). */
export function levelAt(preset: BlindPreset, index: number): BlindLevel {
  const i = Math.max(0, Math.min(index, preset.levels.length - 1));
  return preset.levels[i];
}
