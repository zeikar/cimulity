import { describe, it, expect, vi } from 'vitest';
import { VisualRegistry } from './visualRegistry';
import { TileType } from '@/game/core/Tile';
import { buildPixiAppRegistry } from '@/game/render/TileRenderer';
import type { BuildingType } from '@/game/core/Building';
import type { TerrainTileVisual, BuildingVisual } from './TileVisual';

function makeTerrainVisual(dispose?: () => void): TerrainTileVisual {
  return {
    layer: 'terrain',
    mount: vi.fn(),
    update: vi.fn(),
    unmount: vi.fn(),
    dispose,
  };
}

function makeBuildingVisual(dispose?: () => void): BuildingVisual {
  return {
    layer: 'building',
    mount: vi.fn(),
    update: vi.fn(),
    unmount: vi.fn(),
    dispose,
    getCubeTopScreenY: () => 0,
  };
}

describe('VisualRegistry — terrain', () => {
  it('register/get round-trip', () => {
    const registry = new VisualRegistry();
    const visual = makeTerrainVisual();
    registry.registerTerrain(TileType.GRASS, visual);
    expect(registry.getTerrain(TileType.GRASS)).toBe(visual);
  });

  it('throws on missing terrain type', () => {
    const registry = new VisualRegistry();
    expect(() => registry.getTerrain(TileType.DIRT)).toThrow(
      'Visual not registered for terrain type: dirt'
    );
  });

  it('hasTerrain returns true after register', () => {
    const registry = new VisualRegistry();
    registry.registerTerrain(TileType.DIRT, makeTerrainVisual());
    expect(registry.hasTerrain(TileType.DIRT)).toBe(true);
  });

  it('hasTerrain returns false when not registered', () => {
    const registry = new VisualRegistry();
    expect(registry.hasTerrain(TileType.ROAD)).toBe(false);
  });

  it('overwrite via re-register returns latest visual', () => {
    const registry = new VisualRegistry();
    const first = makeTerrainVisual();
    const second = makeTerrainVisual();
    registry.registerTerrain(TileType.GRASS, first);
    registry.registerTerrain(TileType.GRASS, second);
    expect(registry.getTerrain(TileType.GRASS)).toBe(second);
  });
});

describe('VisualRegistry — building', () => {
  it('register/get round-trip', () => {
    const registry = new VisualRegistry();
    const visual = makeBuildingVisual();
    registry.registerBuilding('residential', visual);
    expect(registry.getBuilding('residential')).toBe(visual);
  });

  it('throws on missing building type', () => {
    const registry = new VisualRegistry();
    expect(() => registry.getBuilding('commercial' as BuildingType)).toThrow(
      'Visual not registered for building type: commercial'
    );
  });

  it('hasBuilding returns true after register', () => {
    const registry = new VisualRegistry();
    registry.registerBuilding('industrial', makeBuildingVisual());
    expect(registry.hasBuilding('industrial')).toBe(true);
  });

  it('hasBuilding returns false when not registered', () => {
    const registry = new VisualRegistry();
    expect(registry.hasBuilding('residential')).toBe(false);
  });
});

describe('VisualRegistry — disposeAll', () => {
  it('calls dispose exactly once on each registered visual', () => {
    const registry = new VisualRegistry();

    const terrainDispose = vi.fn();
    const buildingDispose = vi.fn();

    registry.registerTerrain(TileType.GRASS, makeTerrainVisual(terrainDispose));
    registry.registerTerrain(TileType.DIRT, makeTerrainVisual(terrainDispose));
    registry.registerBuilding('residential', makeBuildingVisual(buildingDispose));

    registry.disposeAll();

    expect(terrainDispose).toHaveBeenCalledTimes(2);
    expect(buildingDispose).toHaveBeenCalledTimes(1);
  });

  it('does not throw when visuals have no dispose method', () => {
    const registry = new VisualRegistry();
    registry.registerTerrain(TileType.ROAD, makeTerrainVisual()); // dispose is undefined
    expect(() => registry.disposeAll()).not.toThrow();
  });

  it('disposeAll on empty registry is a no-op', () => {
    const registry = new VisualRegistry();
    expect(() => registry.disposeAll()).not.toThrow();
  });
});

describe('buildPixiAppRegistry — completeness', () => {
  it('registers a terrain visual for every TileType', () => {
    const registry = buildPixiAppRegistry();
    for (const type of Object.values(TileType)) {
      expect(registry.hasTerrain(type)).toBe(true);
    }
  });
});
