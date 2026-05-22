import { describe, it, expect } from 'vitest';
import { computeTerrainZIndex } from './terrainZIndex';

describe('computeTerrainZIndex', () => {
  it('higher renderHeight → higher zIndex', () => {
    expect(computeTerrainZIndex(1, 0, 0)).toBeGreaterThan(computeTerrainZIndex(0, 99, 99));
  });

  it('same renderHeight, higher (x+y) → higher zIndex', () => {
    expect(computeTerrainZIndex(3, 5, 10)).toBeGreaterThan(computeTerrainZIndex(3, 4, 10));
    expect(computeTerrainZIndex(3, 5, 10)).toBeGreaterThan(computeTerrainZIndex(3, 3, 11));
  });

  it('same renderHeight and (x+y), higher y → higher zIndex', () => {
    // (x+y) = 10 for both
    expect(computeTerrainZIndex(3, 3, 7)).toBeGreaterThan(computeTerrainZIndex(3, 7, 3));
  });

  it('verified same-height area-overlap pair from model commitment: zB > zA', () => {
    const zA = computeTerrainZIndex(8, 5, 5);
    const zB = computeTerrainZIndex(8, 8, 8);
    expect(zA).toBe(8_010_005);
    expect(zB).toBe(8_016_008);
    expect(zB).toBeGreaterThan(zA);
  });
});
