/**
 * Road tool drag-path rule
 *
 * Owns the H/V/45° snap math for road drags. The cursor is snapped to the
 * nearest of three shapes: horizontal, vertical, or a perfect 45° (1:1)
 * diagonal — no arbitrary-angle staircases.
 */

import type { TileCoord } from '../types/coordinates';

export function snapRoadDragPath(
  start: TileCoord,
  end: TileCoord
): TileCoord[] {
  const tiles: TileCoord[] = [];
  const push = (x: number, y: number): void => {
    tiles.push({ x, y });
  };

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  // Snap the end point: dominant horizontal/vertical, else 45° diagonal
  let endX: number, endY: number;
  if (adx > ady * 2) {
    endX = end.x;
    endY = start.y;
  } else if (ady > adx * 2) {
    endX = start.x;
    endY = end.y;
  } else {
    const len = Math.round((adx + ady) / 2);
    endX = start.x + Math.sign(dx) * len;
    endY = start.y + Math.sign(dy) * len;
  }

  const stepX = Math.sign(endX - start.x);
  const stepY = Math.sign(endY - start.y);
  const steps = Math.max(
    Math.abs(endX - start.x),
    Math.abs(endY - start.y)
  );

  for (let i = 0; i <= steps; i++) {
    push(start.x + stepX * i, start.y + stepY * i);
  }

  return tiles;
}
