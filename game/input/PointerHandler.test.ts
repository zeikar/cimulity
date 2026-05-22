/**
 * PointerHandler integration test — pins the canvas → world → tile picking path
 * through the elevation-aware inverse.
 *
 * PointerHandler is intentionally NOT in the coverage gate; this test catches
 * wiring regressions between camera.screenToWorld, screenToTileWithTerrain, and
 * the World/Terrain accessors that PointerHandler wires together.
 *
 * DOM is not available in the node test environment, so we stub the canvas with
 * a minimal event-target mock rather than using jsdom (jsdom is not installed).
 */

import { describe, it, expect, vi } from 'vitest';
import { PointerHandler } from './PointerHandler';
import { getWorld } from '../core/worldStore';
import { tileToScreenWithHeight, ISO_CONFIG } from '../render/IsoTransform';
import type { Camera } from '../render/Camera';
import type { ScreenCoord } from '../types/coordinates';

type EventCallback = (e: Event) => void;

/** Minimal event-target stub sufficient for PointerHandler's attach/detach/click. */
function makeStubCanvas(left = 0, top = 0): HTMLCanvasElement {
  const listeners: Map<string, EventCallback[]> = new Map();
  return {
    addEventListener(type: string, cb: EventCallback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(cb);
    },
    removeEventListener(type: string, cb: EventCallback) {
      const arr = listeners.get(type) ?? [];
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    },
    getBoundingClientRect() {
      return { left, top, right: left + 2000, bottom: top + 2000, width: 2000, height: 2000, x: left, y: top };
    },
    dispatchEvent(event: Event) {
      const arr = listeners.get(event.type) ?? [];
      for (const cb of arr) cb(event);
      return true;
    },
  } as unknown as HTMLCanvasElement;
}

/** Identity camera: world coords == canvas coords (no pan/zoom). */
function makeIdentityCamera(): Camera {
  return {
    screenToWorld: (s: ScreenCoord) => ({ x: s.x, y: s.y }),
  } as unknown as Camera;
}

describe('PointerHandler — elevation-aware picking', () => {
  it('cursor at lifted center of elevated tile (5,5,h=2) picks (5,5)', () => {
    const world = getWorld();
    // Raise (5,5) and all 8 neighbors to h=2 so that tileCornerHeights gives all corners
    // at 2 (Math.min(H, neighbors...) = 2), placing the deformed polygon top at
    // tileToScreenWithHeight({5,5}, 2) deterministically — independent of world state.
    for (let ny = 4; ny <= 6; ny++) {
      for (let nx = 4; nx <= 6; nx++) {
        world.getTerrain().unsafeSetElevation(nx, ny, 2);
      }
    }

    const canvas = makeStubCanvas();
    const camera = makeIdentityCamera();

    let clickedTile: { x: number; y: number } | null = null;
    const handler = new PointerHandler(canvas, camera, world, {
      onTileHover: () => {},
      onTileClick: (tile) => { clickedTile = tile; },
    });

    // Compute world-space coords for the lifted center of tile (5,5) at h=2.
    // With identity camera, canvas coords == world coords.
    const liftedTop = tileToScreenWithHeight({ x: 5, y: 5 }, 2);
    const cursorX = liftedTop.x;
    const cursorY = liftedTop.y + ISO_CONFIG.TILE_HEIGHT / 2;

    // Dispatch a synthetic click. clientX/Y equal canvas coords since rect.left/top = 0.
    const clickEvent = { type: 'click', clientX: cursorX, clientY: cursorY } as MouseEvent;
    vi.spyOn(clickEvent, 'clientX', 'get').mockReturnValue(cursorX);
    vi.spyOn(clickEvent, 'clientY', 'get').mockReturnValue(cursorY);
    (canvas as unknown as { dispatchEvent: (e: Event) => void }).dispatchEvent(clickEvent);

    expect(clickedTile).not.toBeNull();
    expect(clickedTile!.x).toBe(5);
    expect(clickedTile!.y).toBe(5);

    handler.detach();
    for (let ny = 4; ny <= 6; ny++) {
      for (let nx = 4; nx <= 6; nx++) {
        world.getTerrain().unsafeSetElevation(nx, ny, 0);
      }
    }
  });
});
