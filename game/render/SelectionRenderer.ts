/**
 * Hover and selection highlight renderer
 */

import { Container, Graphics } from 'pixi.js';
import { tileToScreenWithHeight, ISO_CONFIG, projectTileCornerScreen } from './IsoTransform';
import type { TileCoord, ScreenCoord } from '../types/coordinates';
import type { CornerHeights } from './terrain/tileCornerHeights';

const REJECT_COLOR = 0xff3b30;
const MUTED_COLOR = 0x6a6a6a;
const STANDARD_ALPHA = 0.4;
const MUTED_ALPHA = 0.2;
const REJECT_ALPHA = 0.5;

export interface DragPreviewInput {
  standardTiles: TileCoord[];
  rejectedTiles: TileCoord[];
  /** Cells belonging to buildings whose entire footprint will be removed by
   *  this drag (BULLDOZE only). Merged with rejectedTiles into a single
   *  deduped reject-tinted layer at render time. */
  affectedFootprintTiles: TileCoord[];
  muted: boolean;
  standardColor: number;
}

export class SelectionRenderer {
  private container: Container;
  private hoverGraphics: Graphics;
  private selectedGraphics: Graphics;
  private dragPreviewGraphics: Graphics;
  private currentHover: TileCoord | null = null;
  private currentHoverFootprint: ReadonlyArray<TileCoord> | undefined = undefined;
  private lastHoverFootprintSig: string | null = null;
  private currentSelected: TileCoord | null = null;
  private currentDragPreview: DragPreviewInput = {
    standardTiles: [],
    rejectedTiles: [],
    affectedFootprintTiles: [],
    muted: false,
    standardColor: 0x4a4a4a,
  };
  /** Latest height callback injected by refreshIfDirty. Null until first call — falls back to height=0. */
  private cachedGetHeight: ((x: number, y: number) => number) | null = null;
  /** Latest corner-heights callback injected by refreshIfDirty. Null until first call — falls back to flat-diamond outline. */
  private cachedGetCorners: ((x: number, y: number) => CornerHeights) | null = null;
  /** Last terrain revision seen; -1 means never synced. */
  private lastRev: number = -1;

  constructor(container: Container) {
    this.container = container;

    this.hoverGraphics = new Graphics();
    this.selectedGraphics = new Graphics();
    this.dragPreviewGraphics = new Graphics();

    this.container.addChild(this.selectedGraphics);
    this.container.addChild(this.dragPreviewGraphics); // Drag preview below hover
    this.container.addChild(this.hoverGraphics); // Hover on top
  }

  /**
   * Update hover highlight. When footprintCells is provided and non-empty,
   * outlines every cell in the footprint (same style). Falls back to the
   * single-cell outline when undefined or empty.
   */
  setHover(tile: TileCoord | null, footprintCells?: ReadonlyArray<TileCoord>): void {
    const sig = footprintCells && footprintCells.length > 0
      ? [...footprintCells].sort((a, b) => a.y - b.y || a.x - b.x).map((c) => `${c.x},${c.y}`).join(';')
      : null;
    const tileUnchanged = this.coordsEqual(this.currentHover, tile);
    const sigUnchanged = sig === this.lastHoverFootprintSig;
    if (tileUnchanged && sigUnchanged) return;

    this.currentHover = tile;
    this.currentHoverFootprint = footprintCells;
    this.lastHoverFootprintSig = sig;
    this.renderHover();
  }

  /**
   * Update selection highlight
   */
  setSelected(tile: TileCoord | null): void {
    if (this.coordsEqual(this.currentSelected, tile)) return;

    this.currentSelected = tile;
    this.renderSelected();
  }

  /**
   * Update drag preview (show tiles that will be affected). The input
   * partitions tiles into standard vs. rejected; muted=true means the
   * whole batch will be rejected at commit (all-or-nothing tools), so
   * the standard tiles render in a desaturated tint to telegraph that.
   */
  setDragPreview(input: DragPreviewInput): void {
    this.currentDragPreview = input;
    this.renderDragPreview();
  }

  /**
   * Clear drag preview
   */
  clearDragPreview(): void {
    this.currentDragPreview = {
      standardTiles: [],
      rejectedTiles: [],
      affectedFootprintTiles: [],
      muted: false,
      standardColor: 0x4a4a4a,
    };
    this.dragPreviewGraphics.clear();
  }

  /**
   * Unconditionally re-renders all three highlight layers.
   * Bypasses equality guards — use when terrain revision changes.
   */
  forceRedraw(): void {
    this.renderSelected();
    this.renderDragPreview();
    this.renderHover();
  }

  /**
   * Update the cached height callback on every call; redraw only when revision changes.
   * Keeps selection highlights aligned with terrain elevation each frame.
   */
  refreshIfDirty(
    rev: number,
    getHeight: (x: number, y: number) => number,
    getCorners?: (x: number, y: number) => CornerHeights,
  ): void {
    this.cachedGetHeight = getHeight;
    this.cachedGetCorners = getCorners ?? null;
    if (rev !== this.lastRev) {
      this.lastRev = rev;
      this.forceRedraw();
    }
  }

  private cornerPointsFor(tile: TileCoord): ScreenCoord[] {
    const c = this.cachedGetCorners?.(tile.x, tile.y);
    if (c) {
      return [
        projectTileCornerScreen(tile, 'top',    c.topH),
        projectTileCornerScreen(tile, 'right',  c.rightH),
        projectTileCornerScreen(tile, 'bottom', c.bottomH),
        projectTileCornerScreen(tile, 'left',   c.leftH),
      ];
    }
    // Flat fallback: use cachedGetHeight at uniform height.
    const h = this.cachedGetHeight?.(tile.x, tile.y) ?? 0;
    const screen = tileToScreenWithHeight(tile, h);
    const hw = ISO_CONFIG.TILE_WIDTH / 2;
    const hh = ISO_CONFIG.TILE_HEIGHT / 2;
    return [
      { x: screen.x,      y: screen.y },
      { x: screen.x + hw, y: screen.y + hh },
      { x: screen.x,      y: screen.y + ISO_CONFIG.TILE_HEIGHT },
      { x: screen.x - hw, y: screen.y + hh },
    ];
  }

  private renderHover(): void {
    this.hoverGraphics.clear();
    if (!this.currentHover) return;
    const cells =
      this.currentHoverFootprint && this.currentHoverFootprint.length > 0
        ? this.currentHoverFootprint
        : [this.currentHover];
    for (const cell of cells) {
      const pts = this.cornerPointsFor(cell);
      this.drawOutline(this.hoverGraphics, pts, 0xffffff, 0.3);
    }
  }

  private renderSelected(): void {
    this.selectedGraphics.clear();
    if (!this.currentSelected) return;
    const pts = this.cornerPointsFor(this.currentSelected);
    this.drawOutline(this.selectedGraphics, pts, 0xffff00, 0.5);
  }

  private renderDragPreview(): void {
    this.dragPreviewGraphics.clear();
    const { standardTiles, rejectedTiles, affectedFootprintTiles, muted, standardColor } = this.currentDragPreview;
    if (standardTiles.length === 0 && rejectedTiles.length === 0 && affectedFootprintTiles.length === 0) return;

    // Pass 2: build deduped reject union (rejectedTiles ∪ affectedFootprintTiles).
    const rejectUnionMap = new Map<string, TileCoord>();
    for (const t of rejectedTiles) rejectUnionMap.set(`${t.x},${t.y}`, t);
    for (const t of affectedFootprintTiles) rejectUnionMap.set(`${t.x},${t.y}`, t);
    const rejectUnionKeys = new Set(rejectUnionMap.keys());

    // Pass 1: standard tiles, excluding any cell in the reject union.
    const stdColor = muted ? MUTED_COLOR : standardColor;
    const stdAlpha = muted ? MUTED_ALPHA : STANDARD_ALPHA;
    const filteredStandard = standardTiles.filter((t) => !rejectUnionKeys.has(`${t.x},${t.y}`));
    this.drawDragTiles(filteredStandard, stdColor, stdAlpha);

    // Pass 2: reject union drawn exactly once.
    this.drawDragTiles([...rejectUnionMap.values()], REJECT_COLOR, REJECT_ALPHA);
  }

  private drawDragTiles(tiles: TileCoord[], color: number, alpha: number): void {
    for (const tile of tiles) {
      const pts = this.cornerPointsFor(tile);
      this.dragPreviewGraphics.beginPath();
      this.dragPreviewGraphics.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        this.dragPreviewGraphics.lineTo(pts[i].x, pts[i].y);
      }
      this.dragPreviewGraphics.closePath();
      this.dragPreviewGraphics.fill({ color, alpha });
    }
  }

  private drawOutline(graphics: Graphics, points: ScreenCoord[], color: number, alpha: number): void {
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
    graphics.closePath();
    graphics.stroke({ color, width: 2, alpha });
  }

  private coordsEqual(a: TileCoord | null, b: TileCoord | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.x === b.x && a.y === b.y;
  }

  destroy(): void {
    this.hoverGraphics.destroy();
    this.selectedGraphics.destroy();
    this.dragPreviewGraphics.destroy();
  }
}
