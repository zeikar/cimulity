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
import { TileRenderer, isDevelopedLand } from './TileRenderer';
import { VisualRegistry } from './visuals/visualRegistry';
import { World } from '../core/World';
import { TileType, createTile } from '../core/Tile';
import type { TerrainTileVisual, BuildingVisual, TileVisualInput, BuildingVisualInput, MapBounds } from './visuals/TileVisual';
import type { CornerHeights } from './terrain/tileCornerHeights';
import type { TerrainShape } from '../core/terrainSlope';

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

function setTileCorners(world: World, x: number, y: number, h: number): void {
  const terrain = world.getTerrain();
  terrain.unsafeSetVertexHeight(x, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y, h);
  terrain.unsafeSetVertexHeight(x + 1, y + 1, h);
  terrain.unsafeSetVertexHeight(x, y + 1, h);
}

interface UpdateRecord {
  x: number;
  y: number;
  renderHeight: number | undefined;
  cornerHeights: CornerHeights | undefined;
  shape: TerrainShape | undefined;
  mapBounds: MapBounds | undefined;
}

function makeStubTerrainVisual(): TerrainTileVisual & { updates: UpdateRecord[]; mounts: UpdateRecord[] } {
  const updates: UpdateRecord[] = [];
  const mounts: UpdateRecord[] = [];
  const visual: TerrainTileVisual & { updates: UpdateRecord[]; mounts: UpdateRecord[] } = {
    layer: 'terrain' as const,
    updates,
    mounts,
    mount: vi.fn((input: TileVisualInput, parent: Container) => {
      mounts.push({ x: input.x, y: input.y, renderHeight: input.renderHeight, cornerHeights: input.cornerHeights, shape: input.shape, mapBounds: input.mapBounds });
      const obj = makeDisplayObject();
      (parent as ReturnType<typeof makeContainer>).addChild(obj);
      return obj;
    }),
    update: vi.fn((input: TileVisualInput) => {
      updates.push({ x: input.x, y: input.y, renderHeight: input.renderHeight, cornerHeights: input.cornerHeights, shape: input.shape, mapBounds: input.mapBounds });
    }),
    unmount: vi.fn((obj: Container) => { obj.destroy(); }),
  };
  return visual;
}

function makeStubRegistry(terrainVisual: TerrainTileVisual): VisualRegistry {
  const registry = new VisualRegistry();
  const allTypes: TileType[] = [
    TileType.DIRT, TileType.GRASS, TileType.ROAD,
    TileType.ZONE_RESIDENTIAL, TileType.ZONE_COMMERCIAL, TileType.ZONE_INDUSTRIAL,
  ];
  for (const t of allTypes) registry.registerTerrain(t, terrainVisual);

  const stubBuilding: BuildingVisual = {
    layer: 'building' as const,
    mount: vi.fn((_input, parent) => { const o = makeDisplayObject(); (parent as ReturnType<typeof makeContainer>).addChild(o); return o; }),
    update: vi.fn(),
    unmount: vi.fn((o) => o.destroy()),
    getCubeTopScreenY: () => 0,
  };
  const buildingTypes = ['residential', 'commercial', 'industrial'] as const;
  for (const t of buildingTypes) registry.registerBuilding(t, stubBuilding);

  return registry;
}

describe('TileRenderer — structureRect propagation', () => {
  it('passes building.structureRect to the building visual mount call', () => {
    const world = new World(4, 4, { regenerate: false });

    // 1x4 lot at (0,0..3), frontage='S' → structureRect pins to the S edge: y+h = lot.y+lot.h = 4, so y=3, h=1.
    const structureRect = { x: 0, y: 3, w: 1, h: 1 };
    const footprint = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }];
    const anchor = { x: 0, y: 0 };
    world.getMap().getBuildings().addBuilding({
      type: 'residential',
      footprint,
      anchor,
      level: 1,
      density: 0,
      age: 0,
      abandoned: false,
      frontage: 'S',
      structureRect,
    });

    const terrainContainer = makeContainer();
    const buildingContainer = makeContainer();
    const terrainVisual = makeStubTerrainVisual();

    // Build a registry with a stub building visual that captures mount inputs.
    const mountInputs: BuildingVisualInput[] = [];
    const stubBuilding: BuildingVisual = {
      layer: 'building' as const,
      mount: vi.fn((input: BuildingVisualInput, parent: Container) => {
        mountInputs.push(input);
        const o = makeDisplayObject();
        (parent as ReturnType<typeof makeContainer>).addChild(o);
        return o;
      }),
      update: vi.fn(),
      unmount: vi.fn((o) => o.destroy()),
      getCubeTopScreenY: () => 0,
    };
    const registry = new VisualRegistry();
    const allTileTypes: TileType[] = [
      TileType.DIRT, TileType.GRASS, TileType.ROAD,
      TileType.ZONE_RESIDENTIAL, TileType.ZONE_COMMERCIAL, TileType.ZONE_INDUSTRIAL,
    ];
    for (const t of allTileTypes) registry.registerTerrain(t, terrainVisual);
    const buildingTypes = ['residential', 'commercial', 'industrial'] as const;
    for (const t of buildingTypes) registry.registerBuilding(t, stubBuilding);

    const renderer = new TileRenderer(terrainContainer, buildingContainer, registry);
    expect(() => renderer.render(world)).not.toThrow();

    expect(mountInputs).toHaveLength(1);
    expect(mountInputs[0].structureRect).toEqual(structureRect);
  });
});

describe('TileRenderer — terrain revision dirty detection', () => {
  it('re-syncs tiles when terrainRev changes after initial render', () => {
    const world = new World(4, 4, { regenerate: false });
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

    // Mutate tile vertices at (1,1): terrainRev bumps.
    setTileCorners(world, 1, 1, 2);
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

  it('syncTile populates cornerHeights, shape, and mapBounds correctly', () => {
    const world = new World(3, 3, { regenerate: false });
    const terrainContainer = makeContainer();
    const buildingContainer = makeContainer();
    const terrainVisual = makeStubTerrainVisual();
    const registry = makeStubRegistry(terrainVisual);

    const renderer = new TileRenderer(terrainContainer, buildingContainer, registry);

    // First render — mount path.
    renderer.render(world);

    // Mutate center tile vertices to height 2, bumping terrainRev.
    setTileCorners(world, 1, 1, 2);

    // Clear mount records so we focus on update pass.
    terrainVisual.updates.length = 0;

    // Second render — update path (terrainRev changed → full pass).
    renderer.render(world);

    // Center tile (1,1): its four shared vertices were raised to 2.
    const r11 = terrainVisual.updates.find((r) => r.x === 1 && r.y === 1);
    expect(r11).toBeDefined();
    expect(r11!.renderHeight).toBe(2);
    expect(r11!.cornerHeights).toEqual({ topH: 2, rightH: 2, bottomH: 2, leftH: 2 });
    expect(r11!.shape).toBe('flat');
    expect(r11!.mapBounds).toEqual({ width: 3, height: 3 });

    // Corner tile (0,0): all elevations at MIN_LAND_ELEVATION=1 → flat, all corner heights 1.
    const r00 = terrainVisual.updates.find((r) => r.x === 0 && r.y === 0);
    expect(r00).toBeDefined();
    expect(r00!.cornerHeights).toEqual({ topH: 1, rightH: 1, bottomH: 2, leftH: 1 });
    expect(r00!.shape).toBe('flat');
    expect(r00!.mapBounds).toEqual({ width: 3, height: 3 });
  });

  it('does NOT trigger extra full pass when terrainRev is stable across frames', () => {
    const world = new World(4, 4, { regenerate: false });
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

describe('isDevelopedLand', () => {
  it('returns true for zone tile types', () => {
    expect(isDevelopedLand(TileType.ZONE_RESIDENTIAL)).toBe(true);
    expect(isDevelopedLand(TileType.ZONE_COMMERCIAL)).toBe(true);
    expect(isDevelopedLand(TileType.ZONE_INDUSTRIAL)).toBe(true);
  });

  it('returns true for service, utility, and park structure types', () => {
    expect(isDevelopedLand(TileType.POWER_PLANT)).toBe(true);
    expect(isDevelopedLand(TileType.WATER_TOWER)).toBe(true);
    expect(isDevelopedLand(TileType.POLICE_STATION)).toBe(true);
    expect(isDevelopedLand(TileType.FIRE_STATION)).toBe(true);
    expect(isDevelopedLand(TileType.HOSPITAL)).toBe(true);
    expect(isDevelopedLand(TileType.SCHOOL)).toBe(true);
    expect(isDevelopedLand(TileType.PARK)).toBe(true);
  });

  it('returns false for non-built-up tile types', () => {
    expect(isDevelopedLand(TileType.GRASS)).toBe(false);
    expect(isDevelopedLand(TileType.DIRT)).toBe(false);
    expect(isDevelopedLand(TileType.ROAD)).toBe(false);
  });
});

describe('road developedNeighbors wiring', () => {
  // Layout (3×3): center tile (1,1) = ROAD, east tile (2,1) = ZONE_RESIDENTIAL (developed),
  // north tile (1,0) = GRASS (non-developed). Verifies syncTile supplies the correct probe.
  function makeFullInputCapture() {
    const captured: TileVisualInput[] = [];
    const visual: TerrainTileVisual = {
      layer: 'terrain' as const,
      mount: vi.fn((input: TileVisualInput, parent: Container) => {
        captured.push(input);
        const obj = makeDisplayObject();
        (parent as ReturnType<typeof makeContainer>).addChild(obj);
        return obj;
      }),
      update: vi.fn((input: TileVisualInput) => { captured.push(input); }),
      unmount: vi.fn((obj: Container) => { obj.destroy(); }),
    };
    return { visual, captured };
  }

  function makeRegistryForCapture(visual: TerrainTileVisual): VisualRegistry {
    const registry = new VisualRegistry();
    const allTypes: TileType[] = [
      TileType.DIRT, TileType.GRASS, TileType.ROAD,
      TileType.ZONE_RESIDENTIAL, TileType.ZONE_COMMERCIAL, TileType.ZONE_INDUSTRIAL,
      TileType.PARK,
    ];
    for (const t of allTypes) registry.registerTerrain(t, visual);
    const stubBuilding: BuildingVisual = {
      layer: 'building' as const,
      mount: vi.fn((_input, parent) => { const o = makeDisplayObject(); (parent as ReturnType<typeof makeContainer>).addChild(o); return o; }),
      update: vi.fn(),
      unmount: vi.fn((o) => o.destroy()),
      getCubeTopScreenY: () => 0,
    };
    for (const t of ['residential', 'commercial', 'industrial'] as const) registry.registerBuilding(t, stubBuilding);
    return registry;
  }

  it('road tile receives developedNeighbors probe; non-road tile does not', () => {
    const world = new World(3, 3, { regenerate: false });
    // Place a zone tile at (2,1) — developed neighbour east of the road.
    world.getMap().setTile(2, 1, createTile(2, 1, TileType.ZONE_RESIDENTIAL));
    // (1,0) is GRASS by default — non-developed north neighbour.
    // Set (1,1) to ROAD.
    world.getMap().setTile(1, 1, createTile(1, 1, TileType.ROAD));

    const { visual, captured } = makeFullInputCapture();
    const registry = makeRegistryForCapture(visual);
    const renderer = new TileRenderer(makeContainer(), makeContainer(), registry);
    renderer.render(world);

    // Find the road tile input.
    const roadInput = captured.find((inp) => inp.x === 1 && inp.y === 1);
    expect(roadInput).toBeDefined();
    expect(roadInput!.developedNeighbors).toBeDefined();
    // East neighbour (dx=+1, dy=0) is ZONE_RESIDENTIAL → developed = true.
    expect(roadInput!.developedNeighbors!(1, 0)).toBe(true);
    // North neighbour (dx=0, dy=-1) is GRASS → developed = false.
    expect(roadInput!.developedNeighbors!(0, -1)).toBe(false);
    // Out-of-bounds offset → getTile returns null → developed = false.
    expect(roadInput!.developedNeighbors!(-10, -10)).toBe(false);

    // roadNeighbors is also defined for road tiles.
    expect(roadInput!.roadNeighbors).toBeDefined();

    // A non-road tile (e.g. ZONE_RESIDENTIAL at (2,1)) must NOT have developedNeighbors.
    const zoneInput = captured.find((inp) => inp.x === 2 && inp.y === 1);
    expect(zoneInput).toBeDefined();
    expect(zoneInput!.developedNeighbors).toBeUndefined();
    expect(zoneInput!.roadNeighbors).toBeUndefined();
  });
});
