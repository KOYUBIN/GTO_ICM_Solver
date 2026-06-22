/**
 * Independent Chip Model (ICM).
 *
 * Computes each player's tournament equity (expected prize money) from their
 * chip stacks and the payout structure, using the standard recursive
 * finish-probability model (Malmuth-Harville).
 *
 * Also provides risk-premium helpers used by the ICM-aware solver: how much
 * equity you need to profitably call/shove relative to a chip-EV baseline.
 */

export interface IcmResult {
  /** Expected prize value ($ or % of prize pool) per player, same order as stacks. */
  equities: number[];
  /** Probability of finishing in each place: finishProb[player][place]. */
  finishProb: number[][];
}

/**
 * Malmuth-Harville ICM. `payouts[i]` is the prize for finishing in place i
 * (0 = first). Players beyond the paid places simply contribute 0.
 */
export function icm(stacks: number[], payouts: number[]): IcmResult {
  const n = stacks.length;
  const places = Math.min(n, payouts.length);
  const finishProb: number[][] = stacks.map(() => new Array(n).fill(0));

  // p1[i] = probability player i finishes first given the active field.
  // We recurse: assign place 0, remove that player, recurse for the rest.
  const indices = stacks.map((_, i) => i);

  function recurse(active: number[], place: number, prob: number) {
    if (place >= places || active.length === 0) return;
    const totalChips = active.reduce((s, i) => s + stacks[i], 0);
    if (totalChips <= 0) {
      // Split remaining probability evenly among ties.
      const share = prob / active.length;
      for (const i of active) finishProb[i][place] += share;
      return;
    }
    for (const i of active) {
      const pFirst = (stacks[i] / totalChips) * prob;
      finishProb[i][place] += pFirst;
      if (place + 1 < places && active.length > 1) {
        recurse(
          active.filter((x) => x !== i),
          place + 1,
          pFirst,
        );
      }
    }
  }

  recurse(indices, 0, 1);

  const equities = stacks.map((_, i) => {
    let eq = 0;
    for (let place = 0; place < places; place++) {
      eq += finishProb[i][place] * (payouts[place] ?? 0);
    }
    return eq;
  });

  return { equities, finishProb };
}

/**
 * ICM risk premium for a hero shove/call.
 *
 * Returns the extra equity (above the chip-EV breakeven) the hero needs for a
 * given all-in to be ICM-neutral. A positive risk premium means tournament
 * survival pressure makes you fold hands that would be a profitable call on
 * a pure chip-EV (cEV) basis.
 *
 * heroIdx: hero's index in stacks/payouts world.
 * amount: chips the hero risks (the effective all-in amount).
 * pot: chips already in the middle that the hero stands to win.
 */
export function riskPremium(
  stacks: number[],
  payouts: number[],
  heroIdx: number,
  villainIdx: number,
  amount: number,
): number {
  const baseEquity = icm(stacks, payouts).equities[heroIdx];

  // ICM equity if hero wins the all-in (gains `amount` from villain).
  const winStacks = stacks.slice();
  winStacks[heroIdx] += amount;
  winStacks[villainIdx] = Math.max(0, winStacks[villainIdx] - amount);
  const winEquity = icm(winStacks, payouts).equities[heroIdx];

  // ICM equity if hero loses the all-in.
  const loseStacks = stacks.slice();
  loseStacks[heroIdx] = Math.max(0, loseStacks[heroIdx] - amount);
  loseStacks[villainIdx] += amount;
  const loseEquity = icm(loseStacks, payouts).equities[heroIdx];

  // Chip-EV breakeven needs 50% (symmetric). The ICM breakeven equity p
  // solves: p*winEquity + (1-p)*loseEquity = baseEquity.
  const denom = winEquity - loseEquity;
  const icmBreakeven = denom !== 0 ? (baseEquity - loseEquity) / denom : 0.5;

  // Risk premium = how much more than the 50% cEV breakeven is required.
  return icmBreakeven - 0.5;
}
