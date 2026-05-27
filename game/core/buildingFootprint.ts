export type Frontage = 'N' | 'S' | 'E' | 'W';

export function isFrontage(v: unknown): v is Frontage {
  return v === 'N' || v === 'S' || v === 'E' || v === 'W';
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Full WxH rect, anchor at NW corner, W,H ∈ {1..4}, no holes/dupes/extras. */
export function isCanonicalFootprintRect(
  footprint: ReadonlyArray<{ x: number; y: number }>,
  anchor: { x: number; y: number },
): boolean {
  if (footprint.length === 0) return false;

  let minX = footprint[0].x;
  let maxX = footprint[0].x;
  let minY = footprint[0].y;
  let maxY = footprint[0].y;

  for (const c of footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  const W = maxX - minX + 1;
  const H = maxY - minY + 1;

  if (W < 1 || W > 4 || H < 1 || H > 4) return false;
  if (anchor.x !== minX || anchor.y !== minY) return false;
  if (footprint.length !== W * H) return false;

  const seen = new Set<string>();
  for (const c of footprint) {
    seen.add(`${c.x},${c.y}`);
  }
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!seen.has(`${x},${y}`)) return false;
    }
  }

  return true;
}

export function lotBboxOf(footprint: ReadonlyArray<{ x: number; y: number }>): Rect {
  let minX = footprint[0].x, minY = footprint[0].y;
  let maxX = footprint[0].x, maxY = footprint[0].y;
  for (const c of footprint) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function isCanonicalRect(rect: Rect): boolean {
  return (
    Number.isInteger(rect.x) && rect.x >= 0 &&
    Number.isInteger(rect.y) && rect.y >= 0 &&
    Number.isInteger(rect.w) && rect.w >= 1 &&
    Number.isInteger(rect.h) && rect.h >= 1
  );
}

export function isStructureRectInLot(
  structureRect: Rect,
  lot: Rect,
  frontage: Frontage,
): boolean {
  if (!isCanonicalRect(structureRect)) return false;

  const sr = structureRect;
  if (sr.x < lot.x || sr.y < lot.y) return false;
  if (sr.x + sr.w > lot.x + lot.w) return false;
  if (sr.y + sr.h > lot.y + lot.h) return false;

  // Frontage-edge pinning + width-axis full-span.
  switch (frontage) {
    case 'N':
      return sr.y === lot.y && sr.x === lot.x && sr.w === lot.w;
    case 'S':
      return sr.y + sr.h === lot.y + lot.h && sr.x === lot.x && sr.w === lot.w;
    case 'W':
      return sr.x === lot.x && sr.y === lot.y && sr.h === lot.h;
    case 'E':
      return sr.x + sr.w === lot.x + lot.w && sr.y === lot.y && sr.h === lot.h;
  }
}
