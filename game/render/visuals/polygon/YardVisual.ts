import { Container, Graphics } from 'pixi.js';
import { projectTileCornerScreen } from '@/game/render/IsoTransform';
import { computeTerrainZIndex } from '@/game/render/terrain/terrainZIndex';
import { baseColor, lerpToWhite } from './cubePalette';
import type { BuildingType } from '@/game/core/Building';
import type { Terrain } from '@/game/core/Terrain';
import { tileCornerHeights } from '@/game/render/terrain/tileCornerHeights';

/**
 * Yard polygon: flat diamond at the cell's render height, fill = building's
 * zone color desaturated 40% toward white, no cube lift. Lives in the
 * terrainContainer so the building's cube (in buildingContainer) sits on top.
 */
export function mountYardCell(
  parent: Container,
  cell: { x: number; y: number },
  type: BuildingType,
  terrain: Terrain,
): Graphics {
  const gfx = new Graphics();
  drawYardDiamond(gfx, cell, type, terrain);
  gfx.zIndex = computeTerrainZIndex(terrain.getRenderHeight(cell.x, cell.y), cell.x, cell.y);
  parent.addChild(gfx);
  return gfx;
}

export function updateYardCell(
  gfx: Graphics,
  cell: { x: number; y: number },
  type: BuildingType,
  terrain: Terrain,
): void {
  gfx.clear();
  drawYardDiamond(gfx, cell, type, terrain);
  gfx.zIndex = computeTerrainZIndex(terrain.getRenderHeight(cell.x, cell.y), cell.x, cell.y);
}

function drawYardDiamond(
  gfx: Graphics,
  cell: { x: number; y: number },
  type: BuildingType,
  terrain: Terrain,
): void {
  // Pixi v8 reliable predicate: cells exist in Terrain — but for yards we
  // always inherit the cell's render height; cornerHeights via tileCornerHeights
  // for shape consistency with DiamondTileVisual.
  const isWater = (x: number, y: number) => x < 0 || y < 0; // yards are never water (lot is flat zone)
  const c = tileCornerHeights(terrain, cell.x, cell.y);
  const top    = projectTileCornerScreen(cell, 'top',    c.topH);
  const right  = projectTileCornerScreen(cell, 'right',  c.rightH);
  const bottom = projectTileCornerScreen(cell, 'bottom', c.bottomH);
  const left   = projectTileCornerScreen(cell, 'left',   c.leftH);

  // Fill: zone color desaturated 40% toward white.
  const color = lerpToWhite(baseColor(type), 0.4);

  gfx.beginPath();
  gfx.moveTo(top.x, top.y);
  gfx.lineTo(right.x, right.y);
  gfx.lineTo(bottom.x, bottom.y);
  gfx.lineTo(left.x, left.y);
  gfx.closePath();
  gfx.fill({ color });
  gfx.stroke({ color: 0x000000, width: 1, alpha: 0.35, alignment: 1 });

  // Suppress unused-param lint for isWater (kept for parity with DiamondTileVisual idiom):
  void isWater;
}
