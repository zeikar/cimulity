/**
 * Z-index formula for cube building visuals.
 *
 * Extracted from CubeBuildingVisual so it can be coverage-gated
 * without dragging Pixi render glue into the gate.
 *
 *   depth     = max over footprint cells of (cell.x + cell.y)
 *   tiebreakY = max y among cells that achieve that max depth
 *   zIndex    = depth * 1000 + tiebreakY
 *
 * Returns 0 defensively for an empty footprint.
 */
export function computeZIndex(footprint: ReadonlyArray<{ x: number; y: number }>): number {
  if (footprint.length === 0) return 0;

  let maxDepth = -Infinity;
  for (const c of footprint) {
    const d = c.x + c.y;
    if (d > maxDepth) maxDepth = d;
  }
  let tiebreakY = -Infinity;
  for (const c of footprint) {
    if (c.x + c.y === maxDepth && c.y > tiebreakY) tiebreakY = c.y;
  }
  return maxDepth * 1000 + tiebreakY;
}
