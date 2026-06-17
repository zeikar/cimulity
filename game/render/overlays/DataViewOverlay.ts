/**
 * Render-only data-view overlay. Draws colored isometric diamond patches over
 * road tiles (Traffic view) or building footprint cells (Jobs view).
 *
 * Data sources:
 *   Traffic — world.getTrafficMap()
 *   Jobs     — world.getLaborMarket().getFlows() + buildingEmploymentShares()
 *
 * Both getTrafficMap() and getLaborMarket() drain DIRTINESS on read (they
 * recompute when dirty), not data — so calling them every frame is safe and
 * always yields a fresh snapshot without double-computing.
 *
 * Never mutates core; all writes go through Graphics only.
 */

import { Graphics, Container } from 'pixi.js';
import type { World } from '@/game/core/World';
import type { Terrain } from '@/game/core/Terrain';
import { TileType } from '@/game/core/Tile';
import { projectTileCornerScreen } from '../IsoTransform';
import { tileCornerHeights } from '../terrain/tileCornerHeights';
import type { VisibleTileBounds } from '../viewportCulling';
import { isBuildingVisible, iterateVisibleTiles } from '../viewportCulling';
import type { DataView } from '../dataView';
import {
  congestionColor,
  employmentColor,
  buildingEmploymentShares,
  NO_DATA_COLOR,
} from '../dataViewColors';

export class DataViewOverlay {
  private container: Container;
  private activeView: DataView = 'none';
  // Keyed by tile index y*width+x. One Graphics per tile or footprint cell.
  private diamonds: Map<number, Graphics> = new Map();
  // Last-drawn color per key — the steady-state redraw-skip cache.
  // MUST be cleared together with diamonds so a fresh Graphics is created only
  // when the cache no longer holds the key (prevents blank-overlay bug).
  private colorByKey: Map<number, number> = new Map();
  private lastTerrainRev: number = -1;
  // Jobs-view flow cache: avoid recomputing buildingEmploymentShares every frame.
  // getFlows() returns a new array reference only when the labor market recomputes,
  // so reference equality is a reliable dirty signal.
  private lastFlows: ReadonlyArray<import('@/game/core/laborMarket').CommuteFlow> | null = null;
  private cachedShares: Map<number, import('../dataViewColors').BuildingEmploymentEntry> | null = null;

  constructor(container: Container) {
    this.container = container;
  }

  /**
   * Destroys all live diamond Graphics objects and resets every cache field.
   * The SINGLE clear path — called from setActiveView (on view change), the
   * 'none' render path, and destroy(). Keeping it singular ensures diamonds
   * and colorByKey are always in sync.
   */
  private clearDiamonds(): void {
    for (const gfx of this.diamonds.values()) {
      gfx.destroy();
    }
    this.diamonds.clear();
    this.colorByKey.clear();
    this.lastTerrainRev = -1;
    // Invalidate the Jobs-view share cache so the next render recomputes fresh.
    this.lastFlows = null;
    this.cachedShares = null;
  }

  setActiveView(view: DataView): void {
    if (view === this.activeView) return;
    // Clear stale diamonds so Traffic↔Jobs and ↔None never share live keys.
    this.clearDiamonds();
    this.activeView = view;
  }

  render(world: World, visibleBounds?: VisibleTileBounds): void {
    if (this.activeView === 'none') {
      this.clearDiamonds();
      return;
    }

    // Terrain-revision check: when the terrain mutates, all cached polygon
    // coords are stale (corner heights changed), so force a redraw this frame.
    const rev = world.getTerrainRevision();
    const forceRedraw = rev !== this.lastTerrainRev;
    if (forceRedraw) {
      this.lastTerrainRev = rev;
    }

    const map = world.getMap();
    const terrain = world.getTerrain();
    const width = map.getWidth();
    const height = map.getHeight();
    const needed = new Set<number>();

    if (this.activeView === 'traffic') {
      const traffic = world.getTrafficMap();
      const tileBounds = visibleBounds
        ? visibleBounds.terrain
        : { minX: 0, maxX: width, minY: 0, maxY: height };

      for (const { x, y } of iterateVisibleTiles(tileBounds)) {
        const tile = map.getTile(x, y);
        if (!tile || tile.type !== TileType.ROAD) continue;

        const congestion = traffic.getCongestion(x, y);
        // Skip free-flow roads — keeps unloaded roads visually readable.
        if (congestion <= 0) continue;

        const key = y * width + x;
        needed.add(key);

        const color = congestionColor(congestion);
        this.mountOrRedraw(key, x, y, color, terrain, forceRedraw, 0.55);
      }
    } else {
      // Jobs view: tint each building footprint cell by employment share.
      // getFlows() returns a stable array reference until the labor market
      // recomputes (new array on any dirty-trigger). Reference equality is
      // sufficient to skip rebuilding all 4 Maps at frame rate.
      const flows = world.getLaborMarket().getFlows();
      const buildings = map.getBuildings();
      if (flows !== this.lastFlows || this.cachedShares === null) {
        this.cachedShares = buildingEmploymentShares(map, buildings, flows);
        this.lastFlows = flows;
      }
      const shares = this.cachedShares;
      const buildBounds = visibleBounds
        ? visibleBounds.buildings
        : { minX: 0, maxX: width, minY: 0, maxY: height };

      for (const building of buildings.iterBuildings()) {
        if (!isBuildingVisible(building.footprint, buildBounds)) continue;

        const entry = shares.get(building.id);
        const color = entry?.hasData
          ? employmentColor(entry.share)
          : NO_DATA_COLOR;

        for (const cell of building.footprint) {
          const key = cell.y * width + cell.x;
          needed.add(key);
          this.mountOrRedraw(key, cell.x, cell.y, color, terrain, forceRedraw, 0.5);
        }
      }
    }

    // Prune stale entries no longer in this frame's needed set.
    for (const [key, gfx] of this.diamonds) {
      if (!needed.has(key)) {
        gfx.destroy();
        this.diamonds.delete(key);
        this.colorByKey.delete(key);
      }
    }
  }

  /**
   * Mount a new Graphics for `key` if absent, or redraw it if the color changed
   * or a terrain-revision forced a full refresh. Cheap no-op in the steady state.
   */
  private mountOrRedraw(
    key: number,
    x: number,
    y: number,
    color: number,
    terrain: Terrain,
    forceRedraw: boolean,
    alpha: number,
  ): void {
    let gfx = this.diamonds.get(key);
    const needsDraw = !gfx || forceRedraw || this.colorByKey.get(key) !== color;
    if (!needsDraw) return;

    if (!gfx) {
      gfx = new Graphics();
      this.diamonds.set(key, gfx);
      this.container.addChild(gfx);
    }

    const tile = { x, y };
    const c = tileCornerHeights(terrain, x, y);
    const top    = projectTileCornerScreen(tile, 'top',    c.topH);
    const right  = projectTileCornerScreen(tile, 'right',  c.rightH);
    const bottom = projectTileCornerScreen(tile, 'bottom', c.bottomH);
    const left   = projectTileCornerScreen(tile, 'left',   c.leftH);

    gfx.clear();
    gfx.beginPath();
    gfx.moveTo(top.x,    top.y);
    gfx.lineTo(right.x,  right.y);
    gfx.lineTo(bottom.x, bottom.y);
    gfx.lineTo(left.x,   left.y);
    gfx.closePath();
    gfx.fill({ color, alpha });

    this.colorByKey.set(key, color);
  }

  destroy(): void {
    // clearDiamonds destroys all Graphics and resets caches; container is
    // owned by PixiApp and destroyed there.
    this.clearDiamonds();
  }
}
