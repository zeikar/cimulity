import { describe, it, expect } from 'vitest';
import {
  SERVICE_BODY_HEIGHT_PX,
  serviceStructureBaseColor,
  serviceStructureCubeFaces,
  isServiceStructureType,
} from './serviceStructureGeometry';
import { rectangularUnionTopPolygon } from './cubeGeometry';

const footprint2x2 = (ox = 0, oy = 0) => [
  { x: ox, y: oy },
  { x: ox + 1, y: oy },
  { x: ox, y: oy + 1 },
  { x: ox + 1, y: oy + 1 },
];

describe('isServiceStructureType', () => {
  it('accepts the four civic service types', () => {
    for (const t of ['police_station', 'fire_station', 'hospital', 'school']) {
      expect(isServiceStructureType(t)).toBe(true);
    }
  });

  it('rejects power plants, water towers, parks, and non-structure strings', () => {
    for (const t of ['power_plant', 'water_tower', 'park', 'residential', 'road', '']) {
      expect(isServiceStructureType(t)).toBe(false);
    }
  });
});

describe('serviceStructureBaseColor', () => {
  it('maps each type to its documented, distinct hue', () => {
    expect(serviceStructureBaseColor('police_station')).toBe(0x3568b0);
    expect(serviceStructureBaseColor('fire_station')).toBe(0xc63a2a);
    expect(serviceStructureBaseColor('hospital')).toBe(0xe8eef2);
    expect(serviceStructureBaseColor('school')).toBe(0xe0a52e);
  });

  it('returns four distinct in-range colours', () => {
    const colors = (['police_station', 'fire_station', 'hospital', 'school'] as const).map(
      serviceStructureBaseColor,
    );
    expect(new Set(colors).size).toBe(4);
    for (const c of colors) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe('serviceStructureCubeFaces', () => {
  it('returns a top diamond plus two side walls for a 2×2 footprint', () => {
    const faces = serviceStructureCubeFaces(footprint2x2(), { x: 0, y: 0 });
    expect(faces).not.toBeNull();
    expect(faces!.top).toHaveLength(4);
    expect(faces!.left).toHaveLength(4);
    expect(faces!.right).toHaveLength(4);
  });

  it('lifts the top by SERVICE_BODY_HEIGHT_PX and lands the cube bottom on the tile plane', () => {
    const anchor = { x: 3, y: 2 };
    const fp = footprint2x2(3, 2);
    const faces = serviceStructureCubeFaces(fp, anchor)!;
    const plane = rectangularUnionTopPolygon(fp, anchor)!;

    // top = [N, E, S, W]; the W vertex sits exactly one body-height above the plane W.
    const topW = faces.top[3];
    expect(topW.x).toBe(plane.W.x);
    expect(plane.W.y - topW.y).toBe(SERVICE_BODY_HEIGHT_PX);

    // The side walls descend back to the tile plane (bottom vertices == unlifted W and S).
    expect(faces.left[2]).toEqual(plane.W);
    expect(faces.left[3]).toEqual(plane.S);

    // Each wall is exactly SERVICE_BODY_HEIGHT_PX tall.
    expect(faces.left[2].y - faces.left[1].y).toBe(SERVICE_BODY_HEIGHT_PX);
    expect(faces.right[3].y - faces.right[0].y).toBe(SERVICE_BODY_HEIGHT_PX);
  });

  it('returns null for a degenerate (empty) footprint', () => {
    expect(serviceStructureCubeFaces([], { x: 0, y: 0 })).toBeNull();
  });
});
