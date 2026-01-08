/**
 * Optional grid line renderer for debugging
 */

import { Container, Graphics } from 'pixi.js';
import { tileToScreen } from './IsoTransform';
import type { GameMap } from '../core/Map';

export class GridRenderer {
  private container: Container;
  private graphics: Graphics;

  constructor(container: Container, private map: GameMap) {
    this.container = container;
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  render(): void {
    this.graphics.clear();

    // Draw horizontal grid lines
    for (let y = 0; y <= this.map.getHeight(); y++) {
      const start = tileToScreen({ x: 0, y });
      const end = tileToScreen({ x: this.map.getWidth(), y });

      this.graphics.beginPath();
      this.graphics.moveTo(start.x, start.y);
      this.graphics.lineTo(end.x, end.y);
      this.graphics.stroke({ color: 0x333333, width: 1, alpha: 0.2 });
    }

    // Draw vertical grid lines
    for (let x = 0; x <= this.map.getWidth(); x++) {
      const start = tileToScreen({ x, y: 0 });
      const end = tileToScreen({ x, y: this.map.getHeight() });

      this.graphics.beginPath();
      this.graphics.moveTo(start.x, start.y);
      this.graphics.lineTo(end.x, end.y);
      this.graphics.stroke({ color: 0x333333, width: 1, alpha: 0.2 });
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
