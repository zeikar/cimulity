import { describe, it, expect } from 'vitest';
import { isBuildingType, tileTypeFromBuildingType } from './Building';
import { TileType } from './Tile';

describe('isBuildingType', () => {
  it('accepts the three valid building types', () => {
    expect(isBuildingType('residential')).toBe(true);
    expect(isBuildingType('commercial')).toBe(true);
    expect(isBuildingType('industrial')).toBe(true);
  });

  it('rejects non-building-type strings', () => {
    expect(isBuildingType('grass')).toBe(false);
    expect(isBuildingType('')).toBe(false);
    expect(isBuildingType('RESIDENTIAL')).toBe(false);
    expect(isBuildingType('zone_residential')).toBe(false);
  });
});

describe('tileTypeFromBuildingType', () => {
  it('maps residential to ZONE_RESIDENTIAL', () => {
    expect(tileTypeFromBuildingType('residential')).toBe(TileType.ZONE_RESIDENTIAL);
  });

  it('maps commercial to ZONE_COMMERCIAL', () => {
    expect(tileTypeFromBuildingType('commercial')).toBe(TileType.ZONE_COMMERCIAL);
  });

  it('maps industrial to ZONE_INDUSTRIAL', () => {
    expect(tileTypeFromBuildingType('industrial')).toBe(TileType.ZONE_INDUSTRIAL);
  });
});
