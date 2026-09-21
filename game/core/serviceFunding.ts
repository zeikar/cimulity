/**
 * Share of a month's upkeep actually paid, as an integer per-mille (1000 = paid in full).
 * An integer so the persisted ratio follows the same whole-integer rule as money (see
 * mapSerialization.ts); the HUD shows it as a percentage. The growth pass freezes on
 * anything short of `FUNDING_FULL_PER_MILLE`.
 */

export const FUNDING_FULL_PER_MILLE = 1000;

/**
 * `due <= 0` (nothing to pay) reads fully funded. Floor, not round, so only an exact
 * payment reaches `FUNDING_FULL_PER_MILLE` — which makes `=== FUNDING_FULL_PER_MILLE`
 * the exact "no upkeep unpaid" predicate.
 */
export function fundingPerMille(paid: number, due: number): number {
  if (due <= 0) return FUNDING_FULL_PER_MILLE;
  return Math.floor((paid * FUNDING_FULL_PER_MILLE) / due);
}

/** Integer in [0, FUNDING_FULL_PER_MILLE]; mirrors `World.isValidMoneyAmount`. */
export function isValidFundingPerMille(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= FUNDING_FULL_PER_MILLE;
}
