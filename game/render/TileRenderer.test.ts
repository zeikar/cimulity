/**
 * TileRenderer unit tests.
 *
 * Pixi is not available in the test environment, so we inject stub visuals
 * and a fake Container into TileRenderer via the optional registry constructor
 * parameter. The stubs record every update/mount call so we can assert that
 * terrain-elevation changes drive a re-sync.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { TileRenderer } from './TileRenderer';
import { VisualRegistry } from './visuals/visualRegistry';
import { World } from '../core/World';
import { TileType } from '../core/Tile';
import type { TerrainTileVisual, BuildingVisual, TileVisualInput } from './visuals/TileVisual';

// Minimal Container stub: TileRenderer only calls addChild / removeChild on the
// parent containers, and inspects nothing on the returned DisplayObjects.
function makeContainer(): Container {
  const children: Container[] = [];
  const c = {
    addChild: vi.fn((child: Container) => { children.push(child); return child; }),
    removeChild: vi.fn((child: Container) => {
      const i = children.indexOf(child);
      if (i !== -1) children.splice(i, 1);
      return child;
    }),
    destroy: vi.fn(),
  } as unknown as Container;
  return c;
}

function makeDisplayObject(): Container {
  return { destroy: vi.fn() } as unknown as Container;
}

interface UpdateRecord { renderHeight: number | undefined }

function makeStubTerrainVisual(): TerrainTileVisual & { updates: UpdateRecord[] } {
  const updates: UpdateRecord[] = [];
  const visual: TerrainTileVisual & { updates: UpdateRecord[] } = {
    layer: 'terrain' as const,
    updates,
    mount: vi.fn((_input: TileVisualInput, parent: Container) => {
      const obj = makeDisplayObject();
      (parent as ReturnType<typeof makeContainer>).addChild(obj);
      return obj;
    }),
    update: vi.fn((input: TileVisualInput) => {
      updates.push({ renderHeight: input.renderHeight });
    }),
    unmount: vi.fn((obj: Container) => { obj.destroy(); }),
  };
  return visual;
}

function makeStubRegistry(terrainVisual: TerrainTileVisual): VisualRegistry {
  const registry = new VisualRegistry();
  const allTypes: TileType[] = [
    TileType.WATER, TileType.DIRT, TileType.GRASS, TileType.ROAD,
    TileType.ZONE_RESIDENTIAL, TileType.ZONE_COMMERCIAL, TileType.ZONE_INDUSTRIAL,
  ];
  for (const t of allTypes) registry.registerTerrain(t, terrainVisual);

  const stubBuilding: BuildingVisual = {
    layer: 'building' as const,
    mount: vi.fn((_input, parent) => { const o = makeDisplayObject(); (parent as ReturnType<typeof makeContainer>).addChild(o); return o; }),
    update: vi.fn(),
    unmount: vi.fn((o) => o.destroy()),
  };
  const buildingTypes = ['residential', 'commercial', 'industrial'] as const;
  for (const t of buildingTypes) registry.registerBuilding(t, stubBuilding);

  return registry;
}

describe('TileRenderer — terrain revision dirty detection', () => {
  it('re-syncs tiles when terrainRev changes after initial render', () => {
    const world = new World(4, 4);
    const terrainContainer = makeContainer();
    const buildingContainer = makeContainer();
    const terrainVisual = makeStubTerrainVisual();
    const registry = makeStubRegistry(terrainVisual);

    const renderer = new TileRenderer(terrainContainer, buildingContainer, registry);

    // First render — fullDirty is true, so all tiles mount.
    renderer.render(world);
    const mountCallCount = (terrainVisual.mount as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(mountCallCount).toBe(16); // 4×4 tiles

    // Clear recorded updates so we can count only the next pass.
    terrainVisual.updates.length = 0;
    (terrainVisual.update as ReturnType<typeof vi.fn>).mockClear();

    // Second render with NO mutation — should NOT trigger a full pass (no update calls for already-mounted tiles).
    renderer.render(world);
    expect((terrainVisual.update as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    // Mutate elevation at (1,1): terrainRev bumps.
    world.getTerrain().unsafeSetElevation(1, 1, 2);
    const revBefore = world.getTerrainRevision();
    expect(revBefore).toBeGreaterThan(0);

    // Third render — terrainDirty must be true → full pass → update called for every tile.
    renderer.render(world);
    const updateCalls = (terrainVisual.update as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(updateCalls).toBe(16); // all tiles re-synced

    // The tile at (1,1) must have received renderHeight = 2.
    const tile11Updates = terrainVisual.updates.filter((r) => r.renderHeight === 2);
    expect(tile11Updates.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT trigger extra full pass when terrainRev is stable across frames', () => {
    const world = new World(4, 4);
    const terrainVisual = makeStubTerrainVisual();
    const renderer = new TileRenderer(
      makeContainer(), makeContainer(), makeStubRegistry(terrainVisual)
    );

    renderer.render(world); // first render (fullDirty)
    (terrainVisual.update as ReturnType<typeof vi.fn>).mockClear();

    renderer.render(world); // second render — no mutation
    renderer.render(world); // third render — no mutation
    expect((terrainVisual.update as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
