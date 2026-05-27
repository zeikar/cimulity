import { seedFor, mulberry32, pickIndex } from '../polygon/buildingSeed';

export type FacadeFace = 'top' | 'left' | 'right';

export type FacadePlacement = {
  moduleId: string;
  x: number;
  y: number;
  face: FacadeFace;
};

export type FacadeFaceSize = { w: number; h: number };

export type FacadeComposerInput = {
  buildingId: number;
  type: 'residential' | 'commercial' | 'industrial';
  level: number;
  density: 0 | 1 | 2;
  footprint: ReadonlyArray<{ x: number; y: number }>;
  anchor: { x: number; y: number };
  frontage: 'N' | 'S' | 'E' | 'W';
};

export type FacadeComposerOutput = {
  placements: ReadonlyArray<FacadePlacement>;
  faceSizes: { top: FacadeFaceSize; left: FacadeFaceSize; right: FacadeFaceSize };
};

// 4-entry tint palettes per BuildingType. Tints multiply with the atlas-baked
// pixels so each palette entry stays near white to keep the art readable.
export const FACADE_TINT_PALETTES: Record<
  'residential' | 'commercial' | 'industrial',
  ReadonlyArray<number>
> = {
  residential: [0xffffff, 0xfff4e8, 0xf0fff0, 0xfff0f8],
  commercial: [0xffffff, 0xf0f8ff, 0xfff8f0, 0xf0fffa],
  industrial: [0xffffff, 0xfff0e0, 0xf0e8d8, 0xe8e8f0],
};

function footprintExtent(footprint: ReadonlyArray<{ x: number; y: number }>): {
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function composeFacade(input: FacadeComposerInput): FacadeComposerOutput {
  const { w: w_cells, h: h_cells } = footprintExtent(input.footprint);

  // T5 owns its own rng stream so adding modules later doesn't shift T4 output.
  const t5Rng = mulberry32(Math.imul(seedFor(input.buildingId), 0x9e3779b1) >>> 0);

  const faceSizes = {
    left: { w: w_cells * 64, h: input.level * 24 },
    right: { w: h_cells * 64, h: input.level * 24 },
    top: { w: w_cells * 64, h: h_cells * 16 },
  };

  const placements: FacadePlacement[] = [];

  // Side faces: draw stochastic wall/window slots in a fixed (left, then right)
  // order. Within each face, iterate floors-outer, cells-inner so the rng draw
  // sequence is stable.
  const sideFaces: Array<{ face: 'left' | 'right'; widthCells: number }> = [
    { face: 'left', widthCells: w_cells },
    { face: 'right', widthCells: h_cells },
  ];

  const wallId = `wall.${input.type}.${input.density}`;
  const windowId = `window.${input.type}.${input.density}`;

  for (const { face, widthCells } of sideFaces) {
    for (let floorIndex = 0; floorIndex < input.level; floorIndex++) {
      for (let cellIndex = 0; cellIndex < widthCells; cellIndex++) {
        const moduleId = t5Rng() < 0.5 ? windowId : wallId;
        placements.push({
          moduleId,
          x: cellIndex * 64,
          y: (input.level - 1 - floorIndex) * 24,
          face,
        });
      }
    }
  }

  // Door overrides the ground-floor centre slot of the visible face matching
  // the frontage. N/W aren't drawn as left/right, so they get no door.
  const doorFace: FacadeFace | null =
    input.frontage === 'S' ? 'left' : input.frontage === 'E' ? 'right' : null;
  if (doorFace !== null) {
    const widthCells = doorFace === 'left' ? w_cells : h_cells;
    const centerCell = Math.floor((widthCells - 1) / 2);
    const doorId = `door.${input.type}`;
    const groundY = (input.level - 1) * 24;
    const idx = placements.findIndex(
      (p) => p.face === doorFace && p.y === groundY && p.x === centerCell * 64,
    );
    if (idx >= 0) {
      placements[idx] = {
        moduleId: doorId,
        x: centerCell * 64,
        y: groundY,
        face: doorFace,
      };
    }
  }

  // Top face: deterministic flat-roof grid, no rng draws.
  const roofId = `roof.flat.${input.type}`;
  for (let iy = 0; iy < h_cells; iy++) {
    for (let ix = 0; ix < w_cells; ix++) {
      placements.push({
        moduleId: roofId,
        x: ix * 64,
        y: iy * 16,
        face: 'top',
      });
    }
  }

  return { placements, faceSizes };
}

export function facadeTintFor(building: {
  id: number;
  type: 'residential' | 'commercial' | 'industrial';
}): number {
  const rng = mulberry32((seedFor(building.id) ^ 0xa341316c) >>> 0);
  const palette = FACADE_TINT_PALETTES[building.type];
  const idx = pickIndex(rng, [1, 1, 1, 1]);
  return palette[idx];
}
