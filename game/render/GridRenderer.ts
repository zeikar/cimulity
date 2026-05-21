import { Container, Graphics } from 'pixi.js';
import { tileToScreenWithHeight, ISO_CONFIG } from './IsoTransform';
import type { World } from '../core/World';

export class GridRenderer {
  private graphics: Graphics;
  private lastTerrainRev: number = -1;

  constructor(container: Container, private world: World) {
    this.graphics = new Graphics();
    container.addChild(this.graphics);
  }

  render(): void {
    const currentRev = this.world.getTerrainRevision();
    if (currentRev === this.lastTerrainRev) return;
    this.lastTerrainRev = currentRev;

    this.graphics.clear();
    const map = this.world.getMap();
    const W = map.getWidth();
    const H = map.getHeight();
    const terrain = this.world.getTerrain();
    const hw = ISO_CONFIG.TILE_WIDTH / 2;
    const hh = ISO_CONFIG.TILE_HEIGHT / 2;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const h = terrain.getRenderHeight(x, y);
        const s = tileToScreenWithHeight({ x, y }, h);
        this.graphics.beginPath();
        this.graphics.moveTo(s.x, s.y);
        this.graphics.lineTo(s.x + hw, s.y + hh);
        this.graphics.lineTo(s.x, s.y + ISO_CONFIG.TILE_HEIGHT);
        this.graphics.lineTo(s.x - hw, s.y + hh);
        this.graphics.closePath();
        this.graphics.stroke({ color: 0x000000, width: 1, alpha: 0.35 });
      }
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
