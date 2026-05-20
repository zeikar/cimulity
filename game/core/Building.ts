import { TileType } from './Tile';

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
