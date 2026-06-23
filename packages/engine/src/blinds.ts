/**
 * Blind / chip presets for the multiplayer table.
 *
 * Each preset is a starting stack plus a blind-level schedule (the standard
 * tournament structure: levels rise on a clock). Cash games use a single fixed
 * level and never escalate. The room store picks the current level's blinds; a
 * fully-custom config lets friends dial in their own structure.
 */

export type GameSpeed = 'hyper-turbo' | 'turbo' | 'classic' | 'deepstack' | 'cash';

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
