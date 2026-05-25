import { TileType } from './Tile';
import { isCanonicalFootprintRect } from './buildingFootprint';
import type { Frontage } from './buildingFootprint';

export type BuildingType = 'residential' | 'commercial' | 'industrial';

export function isBuildingType(s: string): s is BuildingType {
  return s === 'residential' || s === 'commercial' || s === 'industrial';
}

export type Building = {
  id: number;
  type: BuildingType;
  footprint: ReadonlyArray<{ x: number; y: number }>;
  anchor: { x: number; y: number };
  level: number;
  density: 0 | 1 | 2;
  age: number;
  frontage: Frontage;
};

export function tileTypeFromBuildingType(t: BuildingType): TileType {
  switch (t) {
    case 'residential':
      return TileType.ZONE_RESIDENTIAL;
    case 'commercial':
      return TileType.ZONE_COMMERCIAL;
    case 'industrial':
      return TileType.ZONE_INDUSTRIAL;
  }
}

export class BuildingMap {
  private readonly width: number;
  private readonly height: number;
  private buildings: Map<number, Building>;
  private tileOwner: Int32Array;
  private nextId: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buildings = new Map();
    this.tileOwner = new Int32Array(width * height).fill(-1);
    this.nextId = 0;
  }

  private isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private validateFootprint(
    footprint: ReadonlyArray<{ x: number; y: number }>,
    anchor: { x: number; y: number },
  ): boolean {
    // Non-empty
    if (footprint.length === 0) return false;

    // Every cell must be a finite integer and in-bounds
    for (const c of footprint) {
      if (
        !Number.isInteger(c.x) ||
        !Number.isInteger(c.y) ||
        !Number.isFinite(c.x) ||
        !Number.isFinite(c.y)
      ) {
        return false;
      }
      if (!this.isInBounds(c.x, c.y)) return false;
    }

    // No duplicate cells within footprint
    const indices = footprint.map((c) => c.y * this.width + c.x);
    if (new Set(indices).size !== footprint.length) return false;

    // Anchor must be one of the footprint cells
    const anchorInFootprint = footprint.some(
      (c) => c.x === anchor.x && c.y === anchor.y,
    );
    if (!anchorInFootprint) return false;

    // Footprint must be a canonical NW-anchored rectangle, W and H in {1..4}.
    if (!isCanonicalFootprintRect(footprint, anchor)) return false;

    return true;
  }

  private hasOverlap(footprint: ReadonlyArray<{ x: number; y: number }>): boolean {
    for (const c of footprint) {
      if (this.tileOwner[c.y * this.width + c.x] !== -1) return true;
    }
    return false;
  }

  addBuilding(b: Omit<Building, 'id'>): Building | null {
    if (!this.validateFootprint(b.footprint, b.anchor)) return null;
    if (this.hasOverlap(b.footprint)) return null;

    const id = this.nextId++;
    const building: Building = { ...b, id };
    for (const c of b.footprint) {
      this.tileOwner[c.y * this.width + c.x] = id;
    }
    this.buildings.set(id, building);
    return building;
  }

  addExistingBuilding(b: Building): boolean {
    if (
      !Number.isInteger(b.id) ||
      !Number.isFinite(b.id) ||
      b.id < 0
    ) {
      return false;
    }
    if (this.buildings.has(b.id)) return false;
    if (!this.validateFootprint(b.footprint, b.anchor)) return false;
    if (this.hasOverlap(b.footprint)) return false;

    for (const c of b.footprint) {
      this.tileOwner[c.y * this.width + c.x] = b.id;
    }
    this.buildings.set(b.id, b);
    return true;
  }

  removeBuilding(id: number): boolean {
    const b = this.buildings.get(id);
    if (b === undefined) return false;
    for (const c of b.footprint) {
      this.tileOwner[c.y * this.width + c.x] = -1;
    }
    this.buildings.delete(id);
    return true;
  }

  getBuildingAt(x: number, y: number): Building | null {
    if (!this.isInBounds(x, y)) return null;
    const id = this.tileOwner[y * this.width + x];
    if (id === -1) return null;
    return this.buildings.get(id) ?? null;
  }

  getBuilding(id: number): Building | null {
    return this.buildings.get(id) ?? null;
  }

  iterBuildings(): IterableIterator<Building> {
    return this.buildings.values();
  }

  getAllBuildings(): ReadonlyArray<Building> {
    return Array.from(this.buildings.values());
  }

  setNextIdFloor(id: number): void {
    if (!Number.isInteger(id) || !Number.isFinite(id) || id < 0) return;
    this.nextId = Math.max(this.nextId, id + 1);
  }

  clear(): void {
    this.buildings.clear();
    this.tileOwner.fill(-1);
    this.nextId = 0;
  }
}
