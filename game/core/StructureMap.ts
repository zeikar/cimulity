/**
 * Player-placed service structures (power plants, water towers, police stations, fire stations, hospitals). SEPARATE from
 * `BuildingMap` (zone-grown buildings). The two registries share the cell-occupancy
 * invariant via `tileOwner` arrays that cannot both be `>= 0` for the same cell —
 * coordination is enforced at the dispatcher/serialization layer.
 */

import { isCanonicalFootprintRect } from './buildingFootprint';

export type StructureType = 'power_plant' | 'water_tower' | 'police_station' | 'fire_station' | 'hospital';

export function isStructureType(s: string): s is StructureType {
  return s === 'power_plant' || s === 'water_tower' || s === 'police_station' || s === 'fire_station' || s === 'hospital';
}

export interface Structure {
  readonly id: number;
  readonly type: StructureType;
  readonly footprint: ReadonlyArray<{ x: number; y: number }>;
  readonly anchor: { x: number; y: number };
}

/** Single source of truth for footprint dimensions per structure type.
 *  Power plants are a broad 2×2 industrial block; water towers are a compact 1×1
 *  tall tank; police stations are a 2×2 service block; fire stations are a 2×2
 *  service block; hospitals are a 2×2 service block. The switch exhaustiveness
 *  check catches any omitted type. */
export function structureFootprintSize(type: StructureType): { w: number; h: number } {
  switch (type) {
    case 'power_plant':
      return { w: 2, h: 2 };
    case 'water_tower':
      return { w: 1, h: 1 };
    case 'police_station':
      return { w: 2, h: 2 };
    case 'fire_station':
      return { w: 2, h: 2 };
    case 'hospital':
      return { w: 2, h: 2 };
  }
}

export class StructureMap {
  private readonly width: number;
  private readonly height: number;
  private structures: Map<number, Structure>;
  private tileOwner: Int32Array;
  private nextId: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.structures = new Map();
    this.tileOwner = new Int32Array(width * height).fill(-1);
    this.nextId = 0;
  }

  private isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private validateFootprint(
    type: StructureType,
    footprint: ReadonlyArray<{ x: number; y: number }>,
    anchor: { x: number; y: number },
  ): boolean {
    if (footprint.length === 0) return false;

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

    const indices = footprint.map((c) => c.y * this.width + c.x);
    if (new Set(indices).size !== footprint.length) return false;

    const anchorInFootprint = footprint.some(
      (c) => c.x === anchor.x && c.y === anchor.y,
    );
    if (!anchorInFootprint) return false;

    if (!isCanonicalFootprintRect(footprint, anchor)) return false;

    const { w, h } = structureFootprintSize(type);
    const minX = anchor.x;
    const minY = anchor.y;
    const maxX = Math.max(...footprint.map((c) => c.x));
    const maxY = Math.max(...footprint.map((c) => c.y));
    const actualW = maxX - minX + 1;
    const actualH = maxY - minY + 1;
    if (actualW !== w || actualH !== h) return false;

    return true;
  }

  private hasOverlap(footprint: ReadonlyArray<{ x: number; y: number }>): boolean {
    for (const c of footprint) {
      if (this.tileOwner[c.y * this.width + c.x] !== -1) return true;
    }
    return false;
  }

  addStructure(s: Omit<Structure, 'id'>): Structure | null {
    if (!isStructureType(s.type)) return null;
    if (!this.validateFootprint(s.type, s.footprint, s.anchor)) return null;
    if (this.hasOverlap(s.footprint)) return null;

    const id = this.nextId++;
    const structure: Structure = { ...s, id };
    for (const c of s.footprint) {
      this.tileOwner[c.y * this.width + c.x] = id;
    }
    this.structures.set(id, structure);
    return structure;
  }

  addExistingStructure(s: Structure): boolean {
    if (
      !Number.isInteger(s.id) ||
      !Number.isFinite(s.id) ||
      s.id < 0
    ) {
      return false;
    }
    if (!isStructureType(s.type)) return false;
    if (this.structures.has(s.id)) return false;
    if (!this.validateFootprint(s.type, s.footprint, s.anchor)) return false;
    if (this.hasOverlap(s.footprint)) return false;

    for (const c of s.footprint) {
      this.tileOwner[c.y * this.width + c.x] = s.id;
    }
    this.structures.set(s.id, s);
    this.nextId = Math.max(this.nextId, s.id + 1);
    return true;
  }

  removeStructure(id: number): boolean {
    const s = this.structures.get(id);
    if (s === undefined) return false;
    for (const c of s.footprint) {
      this.tileOwner[c.y * this.width + c.x] = -1;
    }
    this.structures.delete(id);
    return true;
  }

  getStructureAt(x: number, y: number): Structure | null {
    if (!this.isInBounds(x, y)) return null;
    const id = this.tileOwner[y * this.width + x];
    if (id === -1) return null;
    return this.structures.get(id) ?? null;
  }

  getStructure(id: number): Structure | null {
    return this.structures.get(id) ?? null;
  }

  iterStructures(): IterableIterator<Structure> {
    return this.structures.values();
  }

  getAllStructures(): ReadonlyArray<Structure> {
    return Array.from(this.structures.values());
  }

  setNextIdFloor(id: number): void {
    if (!Number.isInteger(id) || !Number.isFinite(id) || id < 0) return;
    this.nextId = Math.max(this.nextId, id + 1);
  }

  clear(): void {
    this.structures.clear();
    this.tileOwner.fill(-1);
    this.nextId = 0;
  }
}
