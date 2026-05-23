/**
 * DiamondTileVisual integration tests.
 *
 * Uses vi.mock (hoisted before imports) to spy on tileFillColor so we can
 * confirm that DiamondTileVisual.mount() passes input.tileElevation — not
 * input.renderHeight — into the palette helper.
 */

import { vi } from 'vitest';

// Hoist the mock BEFORE any import that transitively depends on palette.ts so
// the spy is installed before DiamondTileVisual's static binding resolves.
vi.mock('@/game/render/visuals/palette', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/game/render/visuals/palette')>();
  return {
    ...actual,
    tileFillColor: vi.fn(actual.tileFillColor),
  };
});

import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from 'pixi.js';
import { tileFillColor } from '@/game/render/visuals/palette';
import { DiamondTileVisual } from './DiamondTileVisual';
import { TileType } from '@/game/core/Tile';
import { SEA_LEVEL } from '@/game/core/Terrain';

const baseInput = {
  type: TileType.GRASS,
  tileElevation: SEA_LEVEL + 1, // land tile — one step above sea level
  renderHeight: 0,
  level: 0,
  x: 0,
  y: 0,
  cornerHeights: { topH: 0, rightH: 0, bottomH: 0, leftH: 0 },
  shape: 'flat' as const,
  mapBounds: { width: 4, height: 4 },
};

describe('DiamondTileVisual integration — tileFillColor receives tileElevation', () => {
  beforeEach(() => {
    vi.mocked(tileFillColor).mockClear();
  });

  it('passes tileElevation to tileFillColor when renderHeight is 0 (values diverge)', () => {
    const input = { ...baseInput, tileElevation: SEA_LEVEL + 1, renderHeight: 0 };
    DiamondTileVisual.mount(input, new Container());

    expect(tileFillColor).toHaveBeenCalled();
    const calls = vi.mocked(tileFillColor).mock.calls;
    // Every call must use tileElevation, not renderHeight
    for (const [type, level, elevation] of calls) {
      expect(type).toBe(TileType.GRASS);
      expect(level).toBe(0);
      expect(elevation).toBe(SEA_LEVEL + 1);
    }
  });

  it('passes tileElevation (not renderHeight) to tileFillColor when renderHeight differs', () => {
    // renderHeight=5 is purely a render-projected value; palette must still see tileElevation.
    const input = { ...baseInput, tileElevation: SEA_LEVEL + 1, renderHeight: 5 };
    DiamondTileVisual.mount(input, new Container());

    expect(tileFillColor).toHaveBeenCalled();
    const calls = vi.mocked(tileFillColor).mock.calls;
    for (const [type, level, elevation] of calls) {
      expect(type).toBe(TileType.GRASS);
      expect(level).toBe(0);
      // Must be tileElevation, NOT renderHeight (5)
      expect(elevation).toBe(SEA_LEVEL + 1);
      expect(elevation).not.toBe(5);
    }
  });
});
