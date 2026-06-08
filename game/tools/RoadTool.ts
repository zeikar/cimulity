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

  if (stepX !== 0 && stepY !== 0) {
    // 45° diagonal: emit an edge-connected zigzag (Y-first staircase).
    // For each diagonal step i, push the diagonal tile then the Y-axis
    // intermediate so every consecutive pair shares an edge.
    const len = steps;
    for (let i = 0; i < len; i++) {
      push(start.x + stepX * i, start.y + stepY * i);
      push(start.x + stepX * i, start.y + stepY * (i + 1));
    }
    push(start.x + stepX * len, start.y + stepY * len);
  } else {
    for (let i = 0; i <= steps; i++) {
      push(start.x + stepX * i, start.y + stepY * i);
    }
  }

  return tiles;
}
