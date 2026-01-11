'use client';

/**
 * Game HUD overlay
 * Displays: Selected tile coords, FPS, Camera position
 */

import type { TileCoord } from '@/game/types/coordinates';
import type { Tool } from '@/game/input/ToolManager';

export interface GameHUDProps {
  selectedTile: TileCoord | null;
  fps: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  currentTool?: Tool;
}

export function GameHUD({
  selectedTile,
  fps,
  cameraX,
  cameraY,
  cameraZoom,
  currentTool,
}: GameHUDProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        padding: '16px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '14px',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 1000,
      }}
    >
      <div>
        <strong>FPS:</strong> {fps}
      </div>
      {currentTool && (
        <div>
          <strong>Tool:</strong> {currentTool.toUpperCase()}
        </div>
      )}
      <div>
        <strong>Selected Tile:</strong>{' '}
        {selectedTile ? `(${selectedTile.x}, ${selectedTile.y})` : 'None'}
      </div>
      <div>
        <strong>Camera:</strong> ({Math.round(cameraX)}, {Math.round(cameraY)}) | Zoom: {cameraZoom.toFixed(2)}
      </div>
      <div style={{ marginTop: '8px', opacity: 0.7, fontSize: '12px' }}>
        R: Road | S: Select | Left-click: Place | Drag: Paint
      </div>
    </div>
  );
}
