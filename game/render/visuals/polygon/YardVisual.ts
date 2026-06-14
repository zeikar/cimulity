import { Container, Graphics } from 'pixi.js';
import { projectTileCornerScreen } from '@/game/render/IsoTransform';
import { computeTerrainZIndex } from '@/game/render/terrain/terrainZIndex';
import { baseColor, lerpToWhite } from './cubePalette';
import type { BuildingType } from '@/game/core/Building';
import type { Terrain } from '@/game/core/Terrain';
import { tileCornerHeights } from '@/game/render/terrain/tileCornerHeights';
import { getYardTexture } from './faceTexture';
import { terrainTriFillMatrix } from './terrainTriFillMatrix';
import { planDiamondShading } from './diamondShading';

// Must match DiamondTileVisual.TERRAIN_TEXTURE_PX_PER_CELL so yards tile seamlessly with terrain.
const TERRAIN_TEXTURE_PX_PER_CELL = 16;
function terrainCornerUv(vx: number, vy: number) {
  return { u: vx * TERRAIN_TEXTURE_PX_PER_CELL, v: vy * TERRAIN_TEXTURE_PX_PER_CELL };
}

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

  const tex = getYardTexture(type);

  if (tex !== null) {
    // Seam-safety bleed: fill the full diamond with the fallback colour first so
    // any subpixel gap between the two textured triangles doesn't expose the
    // background — mirrors DiamondTileVisual's base-fill pattern.
    const bleedColor = lerpToWhite(baseColor(type), 0.4);
    gfx.beginPath();
    gfx.moveTo(top.x, top.y);
    gfx.lineTo(right.x, right.y);
    gfx.lineTo(bottom.x, bottom.y);
    gfx.lineTo(left.x, left.y);
    gfx.closePath();
    gfx.fill({ color: bleedColor });

    // Corner UVs from the shared integer grid-vertex coords — same scheme as
    // DiamondTileVisual so yard tiles are seamless with terrain neighbours.
    const uvTop    = terrainCornerUv(cell.x,     cell.y);
    const uvRight  = terrainCornerUv(cell.x + 1, cell.y);
    const uvBottom = terrainCornerUv(cell.x + 1, cell.y + 1);
    const uvLeft   = terrainCornerUv(cell.x,     cell.y + 1);

    // Split on the same diagonal terrain uses so the yard tile boundary aligns
    // with adjacent terrain tiles and neither triangle draws outside a
    // deformed/concave diamond. Mirrored from DiamondTileVisual's shadeTri
    // call sites exactly (tb: bottom/left/top + bottom/right/top;
    // lr: left/top/right + left/bottom/right).
    const plan = planDiamondShading(c);
    if (plan.diagonal === 'tb') {
      gfx.beginPath();
      gfx.moveTo(bottom.x, bottom.y);
      gfx.lineTo(left.x, left.y);
      gfx.lineTo(top.x, top.y);
      gfx.closePath();
      gfx.fill({ texture: tex, matrix: terrainTriFillMatrix(bottom, left, top, uvBottom, uvLeft, uvTop), color: 0xffffff, textureSpace: 'global' });

      gfx.beginPath();
      gfx.moveTo(bottom.x, bottom.y);
      gfx.lineTo(right.x, right.y);
      gfx.lineTo(top.x, top.y);
      gfx.closePath();
      gfx.fill({ texture: tex, matrix: terrainTriFillMatrix(bottom, right, top, uvBottom, uvRight, uvTop), color: 0xffffff, textureSpace: 'global' });
    } else {
      gfx.beginPath();
      gfx.moveTo(left.x, left.y);
      gfx.lineTo(top.x, top.y);
      gfx.lineTo(right.x, right.y);
      gfx.closePath();
      gfx.fill({ texture: tex, matrix: terrainTriFillMatrix(left, top, right, uvLeft, uvTop, uvRight), color: 0xffffff, textureSpace: 'global' });

      gfx.beginPath();
      gfx.moveTo(left.x, left.y);
      gfx.lineTo(bottom.x, bottom.y);
      gfx.lineTo(right.x, right.y);
      gfx.closePath();
      gfx.fill({ texture: tex, matrix: terrainTriFillMatrix(left, bottom, right, uvLeft, uvBottom, uvRight), color: 0xffffff, textureSpace: 'global' });
    }
  } else {
    // Fallback: zone color desaturated 40% toward white (headless / load-failure).
    const color = lerpToWhite(baseColor(type), 0.4);
    gfx.beginPath();
    gfx.moveTo(top.x, top.y);
    gfx.lineTo(right.x, right.y);
    gfx.lineTo(bottom.x, bottom.y);
    gfx.lineTo(left.x, left.y);
    gfx.closePath();
    gfx.fill({ color });
  }

  // Outline the FULL diamond. Build a fresh diamond path before stroking — in the
  // textured branch the current path is the last triangle, not the diamond, so a
  // bare stroke here would trace a triangle (diagonal slash + half-missing border).
  gfx.beginPath();
  gfx.moveTo(top.x, top.y);
  gfx.lineTo(right.x, right.y);
  gfx.lineTo(bottom.x, bottom.y);
  gfx.lineTo(left.x, left.y);
  gfx.closePath();
  gfx.stroke({ color: 0x000000, width: 1, alpha: 0.35, alignment: 1 });

  // Suppress unused-param lint for isWater (kept for parity with DiamondTileVisual idiom):
  void isWater;
}
