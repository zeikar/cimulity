/**
 * Z-index for terrain (DiamondTileVisual + slope-aware picker tie-break).
 *
 * Layered keys: renderHeight (primary — taller tiles always above shorter);
 * then x+y (secondary — back-to-front along the iso forward diagonal);
 * then y (tertiary — south wins among same renderHeight + x+y).
 *
 * Used by DiamondTileVisual.mount/update for draw order AND by
 * screenToTileWithTerrain to break ties when multiple same-elevation
 * polygons contain the cursor (shared-edge adjacency OR the verified
 * non-adjacent area-overlap case from the plan).
 */
export function computeTerrainZIndex(renderHeight: number, x: number, y: number): number {
  return renderHeight * 1_000_000 + (x + y) * 1_000 + y;
}
